/*
 * Lee lo que suena en macOS y envía órdenes de reproducción (play/pausa, siguiente, anterior).
 *
 * MediaRemote es un framework privado y el sistema solo deja usarlo a procesos de Apple. Por eso
 * esta biblioteca no la carga Orbit: la carga `/usr/bin/perl` (que sí tiene permiso) con
 * `media.pl`, y las funciones se ejecutan dentro de ese proceso.
 *
 * El sistema solo da "el reproductor activo", y a veces es uno viejo y en pausa (una pestaña de
 * LinkedIn en un navegador) mientras otra app suena (YouTube en otro). Por eso se miran TODOS los
 * clientes de Now Playing y se elige el que está sonando.
 */
#import <Foundation/Foundation.h>
#import <objc/message.h>
#include <dlfcn.h>
#include <unistd.h>

#pragma clang diagnostic ignored "-Warc-performSelector-leaks"

typedef void (^ClientsBlock)(NSArray *clients);
typedef void (*GetClientsFn)(dispatch_queue_t queue, ClientsBlock block);
typedef id (*GetOriginFn)(void);

static const NSTimeInterval kReplyTimeout = 3.0;
static const useconds_t kPollMicros = 500000;
/* Cuántas lecturas seguidas sin nada hacen falta para decir que ya no suena nada (evita parpadeos). */
static const int kEmptyReadingsToStop = 2;

static NSString *const kTitleKey = @"kMRMediaRemoteNowPlayingInfoTitle";
static NSString *const kArtistKey = @"kMRMediaRemoteNowPlayingInfoArtist";
static NSString *const kDurationKey = @"kMRMediaRemoteNowPlayingInfoDuration";
static NSString *const kElapsedKey = @"kMRMediaRemoteNowPlayingInfoElapsedTime";
static NSString *const kTimestampKey = @"kMRMediaRemoteNowPlayingInfoTimestamp";
static NSString *const kRateKey = @"kMRMediaRemoteNowPlayingInfoPlaybackRate";
/* Una portada más grande que esto (en bytes) no se manda a la interfaz. */
static const NSUInteger kMaxArtworkBytes = 300000;
/* Cuánto se aparta la posición de lo esperado para avisar de que el usuario adelantó o atrasó. */
static const double kSeekThresholdSeconds = 1.5;
/* Cuántas veces se intenta bajar la portada de una canción (a veces tarda en estar lista). */
static const int kArtworkAttempts = 4;

static BOOL wait_for(dispatch_semaphore_t semaphore) {
  return dispatch_semaphore_wait(
             semaphore, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kReplyTimeout * NSEC_PER_SEC))) == 0;
}

static void *media_remote(void) {
  static void *handle;
  if (!handle) {
    handle = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW);
  }
  return handle;
}

static NSString *bundle_of(id client) {
  return [[client performSelector:NSSelectorFromString(@"bundleIdentifier")] description];
}

/* Todos los clientes (apps) que han publicado algo en Now Playing. */
static NSArray *all_clients(void) {
  GetClientsFn get = (GetClientsFn)dlsym(media_remote(), "MRMediaRemoteGetNowPlayingClients");
  if (!get) return @[];
  __block NSArray *result = @[];
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  get(dispatch_get_global_queue(0, 0), ^(NSArray *clients) {
    result = clients ?: @[];
    dispatch_semaphore_signal(done);
  });
  wait_for(done);
  return result;
}

/* El cliente (app) con ese bundle id, o nil. */
static id client_with_bundle(NSString *bundle) {
  for (id client in all_clients()) {
    if ([bundle_of(client) isEqualToString:bundle]) return client;
  }
  return nil;
}

/* La "ruta" de un cliente: dónde vive su reproductor (origen + app + reproductor por defecto). */
static id player_path_for(id client) {
  GetOriginFn get_origin = (GetOriginFn)dlsym(media_remote(), "MRMediaRemoteGetLocalOrigin");
  id player = [NSClassFromString(@"MRPlayer") performSelector:NSSelectorFromString(@"defaultPlayer")];
  if (!get_origin || !player) return nil;

  id (*init_path)(id, SEL, id, id, id) = (void *)objc_msgSend;
  return init_path([NSClassFromString(@"MRPlayerPath") alloc],
                   NSSelectorFromString(@"initWithOrigin:client:player:"), get_origin(), client, player);
}

/* Una petición de Now Playing dirigida a un cliente concreto. */
static id request_for(id client) {
  id path = player_path_for(client);
  if (!path) return nil;
  id (*init_request)(id, SEL, id) = (void *)objc_msgSend;
  return init_request([NSClassFromString(@"MRNowPlayingRequest") alloc],
                      NSSelectorFromString(@"initWithPlayerPath:"), path);
}

/* Segundos reproducidos ahora: lo medido y, si suena, lo que ha avanzado desde entonces. */
static NSNumber *position_now(NSDictionary *info, BOOL playing, NSNumber *duration) {
  NSNumber *elapsed = info[kElapsedKey];
  if (![elapsed isKindOfClass:[NSNumber class]]) return nil;
  double position = elapsed.doubleValue;
  NSDate *measured_at = info[kTimestampKey];
  NSNumber *rate = info[kRateKey];
  if (playing && [measured_at isKindOfClass:[NSDate class]]) {
    double speed = [rate isKindOfClass:[NSNumber class]] && rate.doubleValue > 0 ? rate.doubleValue : 1.0;
    position += [[NSDate date] timeIntervalSinceDate:measured_at] * speed;
  }
  if (duration) position = MIN(position, duration.doubleValue);
  return @(MAX(position, 0.0));
}

/* { clientObject, client (bundle id), title, artist, playing, duration?, position? } de un cliente, o nil. */
static NSDictionary *read_client(id client) {
  id request = request_for(client);
  if (!request) return nil;
  dispatch_queue_t queue = dispatch_get_global_queue(0, 0);

  __block NSDictionary *info = nil;
  dispatch_semaphore_t got_info = dispatch_semaphore_create(0);
  void (*request_info)(id, SEL, dispatch_queue_t, void (^)(id, id)) = (void *)objc_msgSend;
  request_info(request, NSSelectorFromString(@"requestNowPlayingInfoOnQueue:completion:"), queue,
               ^(id reply, id error) {
                 if ([reply isKindOfClass:[NSDictionary class]]) info = reply;
                 dispatch_semaphore_signal(got_info);
               });
  NSString *title = wait_for(got_info) ? info[kTitleKey] : nil;
  if (![title isKindOfClass:[NSString class]] || title.length == 0) return nil;
  NSString *artist = info[kArtistKey];

  __block BOOL playing = NO;
  dispatch_semaphore_t got_playing = dispatch_semaphore_create(0);
  void (*request_playing)(id, SEL, dispatch_queue_t, void (^)(BOOL, id)) = (void *)objc_msgSend;
  request_playing(request, NSSelectorFromString(@"requestIsPlayingOnQueue:completion:"), queue,
                  ^(BOOL is_playing, id error) {
                    playing = is_playing;
                    dispatch_semaphore_signal(got_playing);
                  });
  wait_for(got_playing);

  /* Un directo o una duración desconocida llegan como 0 o sin valor: no hay barra de progreso. */
  NSNumber *duration = info[kDurationKey];
  duration = [duration isKindOfClass:[NSNumber class]] && duration.doubleValue > 0 ? duration : nil;

  NSMutableDictionary *reading = [@{
    @"clientObject" : client,
    @"client" : bundle_of(client),
    @"title" : title,
    @"artist" : [artist isKindOfClass:[NSString class]] ? artist : @"",
    @"playing" : @(playing),
  } mutableCopy];
  if (duration) reading[@"duration"] = duration;
  NSNumber *position = position_now(info, playing, duration);
  if (position && duration) reading[@"position"] = position;
  return reading;
}

/* La portada del reproductor como `data:image/...;base64,...`, o nil si no hay o es muy grande. */
static NSString *artwork_data_url(id client) {
  id request = request_for(client);
  if (!request) return nil;
  __block NSData *bytes = nil;
  dispatch_semaphore_t got = dispatch_semaphore_create(0);
  void (*request_artwork)(id, SEL, dispatch_queue_t, void (^)(id, id)) = (void *)objc_msgSend;
  request_artwork(request, NSSelectorFromString(@"requestNowPlayingItemArtworkOnQueue:completion:"),
                  dispatch_get_global_queue(0, 0), ^(id artwork, id error) {
                    id data = artwork ? [artwork performSelector:NSSelectorFromString(@"imageData")] : nil;
                    if ([data isKindOfClass:[NSData class]]) bytes = data;
                    dispatch_semaphore_signal(got);
                  });
  if (!wait_for(got) || bytes.length < 4 || bytes.length > kMaxArtworkBytes) return nil;

  const unsigned char *magic = bytes.bytes;
  const char *mime = NULL;
  if (magic[0] == 0xFF && magic[1] == 0xD8) mime = "image/jpeg";
  else if (magic[0] == 0x89 && magic[1] == 0x50) mime = "image/png";
  if (!mime) return nil;
  return [NSString stringWithFormat:@"data:%s;base64,%@", mime, [bytes base64EncodedStringWithOptions:0]];
}

/*
 * Lo que debe mostrar Orbit: lo que está sonando (si hay varios, el que ya se mostraba y si no el
 * primero) y, si ya no suena nada, ese mismo reproductor en pausa. Un reproductor viejo en pausa
 * que no se mostraba antes (la pestaña de LinkedIn) no cuenta.
 */
static NSDictionary *pick_current(NSString *last_client) {
  NSDictionary *first_playing = nil, *last_shown = nil;
  for (id client in all_clients()) {
    NSDictionary *reading = read_client(client);
    if (!reading) continue;
    BOOL is_last = [reading[@"client"] isEqualToString:last_client ?: @""];
    if ([reading[@"playing"] boolValue]) {
      if (is_last) return reading;
      if (!first_playing) first_playing = reading;
    } else if (is_last) {
      last_shown = reading;
    }
  }
  return first_playing ?: last_shown;
}

/* La línea JSON de lo que suena (`null` si nada). `artwork` y `position` son opcionales. */
static NSString *json_line(NSDictionary *current, NSString *artwork, BOOL with_position) {
  if (!current) return @"null";
  NSMutableDictionary *wire = [@{
    @"title" : current[@"title"],
    @"artist" : [current[@"artist"] length] ? current[@"artist"] : [NSNull null],
    @"playing" : current[@"playing"],
    @"client" : current[@"client"],
    @"duration" : current[@"duration"] ?: [NSNull null],
    @"artwork" : artwork ?: [NSNull null],
  } mutableCopy];
  if (with_position) wire[@"position"] = current[@"position"] ?: [NSNull null];
  NSData *json = [NSJSONSerialization dataWithJSONObject:wire options:0 error:nil];
  return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] ?: @"null";
}

/* Las funciones que llama perl (XSUB): no usan sus argumentos; los datos van por variables de entorno. */

/*
 * Escribe una línea JSON cada vez que cambia lo que suena (`null` si no suena nada) o el usuario
 * adelanta o atrasa la canción, hasta que Orbit (ORBIT_PARENT_PID) deja de existir. La posición
 * solo se manda en esos momentos: la interfaz la va calculando sola mientras suena.
 */
void orbit_media_watch(void *interpreter, void *cv) {
  pid_t parent = (pid_t)atoi(getenv("ORBIT_PARENT_PID") ?: "0");
  NSString *last_identity = nil, *last_client = nil, *last_title = nil, *last_artist = nil;
  NSString *artwork = nil, *artwork_key = nil;
  int empty_readings = 0, artwork_attempts = 0;
  double emitted_position = 0;
  NSDate *emitted_at = nil;

  while (parent != 0 && getppid() == parent) {
    @autoreleasepool {
      NSMutableDictionary *current = [pick_current(last_client) mutableCopy];
      if (current) {
        empty_readings = 0;
        /* A veces el sistema responde sin el artista: se conserva el de la lectura anterior. */
        if ([current[@"artist"] length] == 0 && [current[@"title"] isEqualToString:last_title ?: @""]) {
          current[@"artist"] = last_artist ?: @"";
        }
        last_client = current[@"client"];
        last_title = current[@"title"];
        last_artist = current[@"artist"];

        /* La portada se baja una vez por canción (a veces a la segunda o tercera está lista). */
        NSString *key = [NSString stringWithFormat:@"%@|%@|%@", last_client, last_title, current[@"duration"]];
        if (![key isEqualToString:artwork_key]) {
          artwork_key = key;
          artwork = nil;
          artwork_attempts = 0;
        }
        if (!artwork && artwork_attempts < kArtworkAttempts) {
          artwork_attempts++;
          artwork = artwork_data_url(current[@"clientObject"]);
        }
      } else {
        empty_readings++;
      }

      BOOL stopped = !current && empty_readings >= kEmptyReadingsToStop;
      if (current || stopped) {
        NSString *identity = json_line(current, artwork, NO);
        BOOL changed = ![identity isEqualToString:last_identity];

        /* ¿Adelantó o atrasó? La posición se aparta de lo que tocaba si siguiera sonando igual. */
        BOOL jumped = NO;
        if (!changed && current[@"position"] && emitted_at) {
          double expected = emitted_position;
          if ([current[@"playing"] boolValue]) expected += -[emitted_at timeIntervalSinceNow];
          jumped = fabs([current[@"position"] doubleValue] - expected) > kSeekThresholdSeconds;
        }

        if (changed || jumped) {
          last_identity = identity;
          emitted_at = [NSDate date];
          emitted_position = [current[@"position"] doubleValue];
          fprintf(stdout, "%s\n", json_line(current, artwork, YES).UTF8String);
          fflush(stdout);
        }
        if (stopped) last_client = nil;
      }
    }
    usleep(kPollMicros);
  }
}

/*
 * Envía la orden de ORBIT_MEDIA_COMMAND (número de MRCommand) al reproductor de la app
 * ORBIT_MEDIA_CLIENT (la que Orbit está mostrando) y no al "activo" del sistema, que puede ser otro.
 */
void orbit_media_send(void *interpreter, void *cv) {
  const char *command = getenv("ORBIT_MEDIA_COMMAND");
  const char *bundle = getenv("ORBIT_MEDIA_CLIENT");
  if (!command || !bundle) {
    fprintf(stderr, "faltan datos de la orden\n");
    exit(1);
  }
  @autoreleasepool {
    id client = client_with_bundle([NSString stringWithUTF8String:bundle]);
    id path = client ? player_path_for(client) : nil;
    id (*init_destination)(id, SEL, id) = (void *)objc_msgSend;
    id destination = path ? init_destination([NSClassFromString(@"MRDestination") alloc],
                                             NSSelectorFromString(@"initWithPlayerPath:"), path)
                          : nil;
    if (!destination) {
      fprintf(stderr, "el reproductor ya no está disponible\n");
      exit(2);
    }

    dispatch_semaphore_t sent = dispatch_semaphore_create(0);
    void (*send_to)(id, SEL, unsigned int, id, id, id, void (^)(id)) = (void *)objc_msgSend;
    send_to(NSClassFromString(@"MRNowPlayingController"),
            NSSelectorFromString(@"sendCommand:toDestination:options:appOptions:withCompletion:"),
            (unsigned int)atoi(command), destination, nil, nil, ^(id reply) {
              dispatch_semaphore_signal(sent);
            });
    if (!wait_for(sent)) {
      fprintf(stderr, "el reproductor no respondió\n");
      exit(3);
    }
  }
}

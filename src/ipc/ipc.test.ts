import { afterEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { emitLocal, onEvent } from '@/ipc/events';
import type { SttModel } from '@/types';

afterEach(async () => {
  await commands.stopListening(); // deja la simulación parada entre tests
  vi.useRealTimers();
});

describe('commandErrorCode', () => {
  it('lee el código de un error de Rust', () => {
    expect(commandErrorCode({ code: 'audio.noOutputDevice', message: 'x' })).toBe(
      'audio.noOutputDevice',
    );
  });

  it('devuelve null si no hay código', () => {
    expect(commandErrorCode(new Error('x'))).toBeNull();
    expect(commandErrorCode('texto')).toBeNull();
    expect(commandErrorCode(null)).toBeNull();
    expect(commandErrorCode({ code: 42 })).toBeNull();
  });
});

describe('eventos en el navegador (sin Tauri)', () => {
  it('entrega los eventos emitidos a quien se suscribió', async () => {
    const received: number[] = [];
    await onEvent('audio:level', (level) => received.push(level));
    emitLocal('audio:level', 0.3);
    emitLocal('audio:level', 0.9);
    expect(received).toEqual([0.3, 0.9]);
  });

  it('al desuscribirse deja de recibir', async () => {
    const received: number[] = [];
    const off = await onEvent('audio:level', (level) => received.push(level));
    emitLocal('audio:level', 0.1);
    off();
    emitLocal('audio:level', 0.2);
    expect(received).toEqual([0.1]);
  });

  it('cada evento solo llega a sus suscriptores', async () => {
    const states: string[] = [];
    const levels: number[] = [];
    await onEvent('pipeline:state', (state) => states.push(state));
    await onEvent('audio:level', (level) => levels.push(level));
    emitLocal('pipeline:state', 'listening');
    expect(states).toEqual(['listening']);
    expect(levels).toEqual([]);
  });
});

describe('simulación de la escucha en el navegador', () => {
  it('empezar emite "listening" y volúmenes entre 0 y 1; parar emite 0 e "idle"', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const levels: number[] = [];
    await onEvent('pipeline:state', (state) => states.push(state));
    await onEvent('audio:level', (level) => levels.push(level));

    await commands.startListening();
    expect(states).toEqual(['listening']);
    expect(await commands.isListening()).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(levels.length).toBeGreaterThan(20); // ~30 por segundo
    expect(levels.every((level) => level >= 0 && level <= 1)).toBe(true);
    expect(new Set(levels).size).toBeGreaterThan(5); // el volumen cambia: hay ondas

    await commands.stopListening();
    expect(states).toEqual(['listening', 'idle']);
    expect(levels.at(-1)).toBe(0);
    expect(await commands.isListening()).toBe(false);
  });

  it('empezar dos veces no duplica la simulación', async () => {
    vi.useFakeTimers();
    const levels: number[] = [];
    await onEvent('audio:level', (level) => levels.push(level));

    await commands.startListening();
    await commands.startListening();
    vi.advanceTimersByTime(1000);

    expect(levels.length).toBeLessThan(40); // ~30, no ~60
  });
});

describe('modelos de transcripción en el navegador (simulado)', () => {
  const entry = async (model: SttModel) =>
    (await commands.sttModelStatus()).models.find((e) => e.model === model);

  it('ofrece los cuatro modelos, sin descargar, con small en uso', async () => {
    const status = await commands.sttModelStatus();
    expect(status.models.map((e) => e.model)).toEqual(['base', 'small', 'medium', 'turbo']);
    expect(status.models.every((e) => e.state === 'missing')).toBe(true);
    expect(status.active).toBe('small');
  });

  it('descargar avanza por pasos, deja el modelo en uso y borrar lo deja sin descargar', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const off = await onEvent('stt:model', (status) =>
      states.push(status.models.find((e) => e.model === 'base')?.state ?? ''),
    );

    await commands.sttModelDownload('base');
    expect((await entry('base'))?.state).toBe('downloading');

    await vi.advanceTimersByTimeAsync(10_000);
    const done = await entry('base');
    expect(done?.state).toBe('ready');
    expect(done?.downloaded).toBe(done?.total);
    expect((await commands.sttModelStatus()).active).toBe('base');
    expect(states[0]).toBe('downloading');
    expect(states.at(-1)).toBe('ready');

    await commands.sttModelRemove('base');
    expect((await entry('base'))?.state).toBe('missing');
    off();
  });

  it('se baja de uno en uno', async () => {
    vi.useFakeTimers();
    await commands.sttModelDownload('medium');
    await expect(commands.sttModelDownload('turbo')).rejects.toMatchObject({
      code: 'stt.model.busy',
    });
    await expect(commands.sttModelRemove('medium')).rejects.toMatchObject({
      code: 'stt.model.busy',
    });
    await commands.sttModelCancel();
  });

  it('cancelar a mitad deja el modelo sin descargar', async () => {
    vi.useFakeTimers();
    await commands.sttModelDownload('turbo');
    await vi.advanceTimersByTimeAsync(500);
    await commands.sttModelCancel();
    await vi.advanceTimersByTimeAsync(10_000);

    const turbo = await entry('turbo');
    expect(turbo?.state).toBe('missing');
    expect(turbo?.downloaded).toBe(0);
  });

  it('solo se puede usar un modelo ya descargado', async () => {
    vi.useFakeTimers();
    await expect(commands.sttModelUse('medium')).rejects.toMatchObject({
      code: 'stt.model.notReady',
    });

    await commands.sttModelDownload('base');
    await vi.advanceTimersByTimeAsync(10_000);
    await commands.sttModelDownload('small');
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await commands.sttModelStatus()).active).toBe('small');

    const status = await commands.sttModelUse('base');
    expect(status.active).toBe('base');
    await commands.sttModelRemove('base');
    await commands.sttModelRemove('small');
  });

  it('el idioma elegido vuelve en los ajustes y los atajos se listan', async () => {
    expect((await commands.setSttLanguage('en')).sttLanguage).toBe('en');
    const shortcuts = await commands.getShortcuts();
    expect(shortcuts.map((shortcut) => shortcut.action)).toEqual([
      'toggleQuestion',
      'toggleIsland',
    ]);
  });
});

describe('atajos, inicio con la sesión, guía y carpeta del modelo en el navegador (simulado)', () => {
  it('cambiar un atajo valida como Rust: pide un modificador y no repite el de otra acción', async () => {
    await expect(commands.setShortcut('toggleIsland', 'H')).rejects.toMatchObject({
      code: 'shortcut.needsModifier',
    });
    await expect(
      commands.setShortcut('toggleIsland', 'Shift+CommandOrControl+Space'),
    ).rejects.toMatchObject({ code: 'shortcut.duplicate' });

    const changed = await commands.setShortcut('toggleIsland', 'Alt+K');
    expect(changed.find((s) => s.action === 'toggleIsland')?.keys).toBe('Alt+K');
    expect((await commands.getShortcuts()).find((s) => s.action === 'toggleIsland')?.keys).toBe(
      'Alt+K',
    );

    const restored = await commands.resetShortcut('toggleIsland');
    expect(restored.find((s) => s.action === 'toggleIsland')?.keys).toBe(
      'CommandOrControl+Shift+H',
    );
  });

  it('el inicio con la sesión se enciende y se apaga', async () => {
    expect(await commands.getAutostart()).toBe(false);
    expect(await commands.setAutostart(true)).toBe(true);
    expect(await commands.getAutostart()).toBe(true);
    expect(await commands.setAutostart(false)).toBe(false);
  });

  it('la guía de primer arranque se marca como vista y se puede volver a activar', async () => {
    expect((await commands.getIslandSettings()).onboardingDone).toBe(false);
    expect((await commands.setOnboardingDone(true)).onboardingDone).toBe(true);
    expect((await commands.getIslandSettings()).onboardingDone).toBe(true);
    await commands.setOnboardingDone(false);
    expect((await commands.getIslandSettings()).onboardingDone).toBe(false);
  });

  it('la carpeta del modelo se cambia y se devuelve a la de la app', async () => {
    const changed = await commands.sttModelChooseDir('Elige');
    expect(changed).toMatchObject({ customDir: true, dir: '/Volumes/Externo/Orbit' });
    expect((await commands.sttModelStatus()).customDir).toBe(true);

    const reset = await commands.sttModelResetDir();
    expect(reset.customDir).toBe(false);
    expect(reset.dir).toContain('dev.orbit.island');
  });
});

describe('pantalla encendida en el navegador (simulado)', () => {
  it('empieza desactivada y "siempre" la deja activa hasta apagarla', async () => {
    const events: boolean[] = [];
    const off = await onEvent('awake:changed', (status) => events.push(status.active));

    expect(await commands.keepAwakeStatus()).toEqual({
      setting: { mode: 'off' },
      active: false,
      error: null,
    });

    const on = await commands.keepAwakeSet({ mode: 'always' });
    expect(on).toMatchObject({ setting: { mode: 'always' }, active: true });
    expect((await commands.keepAwakeStatus()).active).toBe(true);

    await commands.keepAwakeSet({ mode: 'off' });
    expect((await commands.keepAwakeStatus()).active).toBe(false);
    expect(events).toEqual([true, false]);
    off();
  });

  it('un tiempo se apaga solo al vencer y lo avisa', async () => {
    vi.useFakeTimers();
    const modes: string[] = [];
    const off = await onEvent('awake:changed', (status) => modes.push(status.setting.mode));

    await commands.keepAwakeSet({ mode: 'until', endsAt: Date.now() + 5_000 });
    expect((await commands.keepAwakeStatus()).active).toBe(true);

    await vi.advanceTimersByTimeAsync(6_000);

    const status = await commands.keepAwakeStatus();
    expect(status.active).toBe(false);
    expect(status.setting).toEqual({ mode: 'off' });
    expect(modes).toEqual(['until', 'off']);
    off();
  });

  it('un tiempo que ya venció no se activa', async () => {
    const status = await commands.keepAwakeSet({ mode: 'until', endsAt: Date.now() - 1 });
    expect(status.active).toBe(false);
    await commands.keepAwakeSet({ mode: 'off' });
  });

  it('un horario que pasa por la hora actual está activo y uno que no, no', async () => {
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const around = await commands.keepAwakeSet({
      mode: 'schedule',
      start: (minute + 1439) % 1440,
      end: (minute + 1) % 1440,
    });
    expect(around.active).toBe(true);

    const elsewhere = await commands.keepAwakeSet({
      mode: 'schedule',
      start: (minute + 60) % 1440,
      end: (minute + 120) % 1440,
    });
    expect(elsewhere.active).toBe(false);
    await commands.keepAwakeSet({ mode: 'off' });
  });

  it('un horario con las dos horas iguales o fuera del día se rechaza', async () => {
    for (const [start, end] of [
      [600, 600],
      [0, 1440],
      [-5, 60],
    ] as const) {
      await expect(commands.keepAwakeSet({ mode: 'schedule', start, end })).rejects.toMatchObject({
        code: 'awake.invalidSchedule',
      });
    }
  });
});

describe('acciones de IA del portapapeles en el navegador (simulado)', () => {
  it('devuelve un resultado de muestra del texto pedido', async () => {
    vi.useFakeTimers();
    const pending = commands.clipboardAi(4, 'translate', 'es');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toContain('https://orbit.example/docs/getting-started');
  });
});

describe('cámara en el navegador (simulado)', () => {
  it('copiar, guardar y abrir los ajustes responden sin hacer nada de verdad', async () => {
    await expect(commands.copyCameraPhoto('AAAA')).resolves.toBeUndefined();
    await expect(commands.saveCameraPhoto('AAAA')).resolves.toBe('Orbit-simulada.png');
    await expect(commands.openCameraSettings()).resolves.toBeUndefined();
  });
});

describe('salida de sonido en el navegador (simulado)', () => {
  it('lista tres salidas de muestra y cambiar la predeterminada la mueve', async () => {
    const before = await commands.soundOutputList();
    expect(before.map((device) => device.id)).toEqual(['altavoces', 'audifonos', 'monitor']);
    expect(before.filter((device) => device.isDefault).map((device) => device.id)).toEqual([
      'altavoces',
    ]);

    const after = await commands.soundOutputSet('audifonos');
    expect(after.filter((device) => device.isDefault).map((device) => device.id)).toEqual([
      'audifonos',
    ]);
    expect((await commands.soundOutputList()).find((device) => device.isDefault)?.id).toBe(
      'audifonos',
    );
    await commands.soundOutputSet('altavoces');
  });

  it('una salida que no existe se rechaza', async () => {
    await expect(commands.soundOutputSet('nada')).rejects.toMatchObject({
      code: 'soundOutput.notFound',
    });
  });
});

describe('fondo de pantalla en el navegador (simulado)', () => {
  it('empieza apagado, con dos monitores de muestra y cuatro fondos en la carpeta', async () => {
    const status = await commands.wallpaperStatus();
    expect(status).toMatchObject({
      enabled: false,
      file: null,
      sound: false,
      volume: 60,
      perScreen: false,
      performance: 'any',
    });
    expect(status.screens.map((screen) => screen.key)).toEqual([
      'Pantalla integrada',
      'Monitor externo',
    ]);
    const items = await commands.wallpaperList();
    expect(items.map((item) => item.file)).toEqual([
      'atardecer.png',
      'bosque.jpg',
      'olas.mp4',
      'lluvia.mp4',
    ]);
    expect(items.map((item) => item.kind)).toEqual(['image', 'image', 'video', 'video']);
    expect(items.map((item) => item.hasAudio)).toEqual([null, null, true, false]);
  });

  it('elegir un fondo lo enciende y avisa; pausar y cambiar el modo también avisan', async () => {
    const received: boolean[] = [];
    const off = await onEvent('wallpaper:changed', (status) => received.push(status.manualPause));

    const chosen = await commands.wallpaperSelect('olas.mp4');
    expect(chosen).toMatchObject({ enabled: true, file: 'olas.mp4' });
    expect(chosen.screens.map((screen) => screen.kind)).toEqual(['video', 'video']);
    expect(chosen.screens.map((screen) => screen.paused)).toEqual([false, false]);

    expect((await commands.wallpaperSetPaused(true)).manualPause).toBe(true);
    expect((await commands.wallpaperSetPerformance('large')).performance).toBe('large');
    expect((await commands.wallpaperSetEnabled(false)).enabled).toBe(false);
    expect(received).toEqual([false, true, true, true]);
    off();
  });

  it('el sonido solo cuenta en videos con audio y suena en un solo monitor', async () => {
    await commands.wallpaperSelect('olas.mp4');
    const loud = await commands.wallpaperSetSound(true);
    expect(loud.sound).toBe(true);
    // El mismo video en los dos monitores: se oye una sola vez.
    expect(loud.screens.map((screen) => screen.audible)).toEqual([true, false]);

    // Un video sin audio no suena aunque se pida sonido.
    const mute = await commands.wallpaperSelect('lluvia.mp4');
    expect(mute.screens.map((screen) => [screen.hasAudio, screen.audible])).toEqual([
      [false, false],
      [false, false],
    ]);

    expect((await commands.wallpaperSetVolume(35)).volume).toBe(35);
    expect((await commands.wallpaperSetVolume(250)).volume).toBe(100);
    await commands.wallpaperSetSound(false);
  });

  it('con un fondo por monitor, cada uno lleva el suyo y su propio sonido', async () => {
    await commands.wallpaperSelect('olas.mp4');
    const split = await commands.wallpaperSetPerScreen(true);
    expect(split.perScreen).toBe(true);

    const second = await commands.wallpaperSelect('atardecer.png', 'Monitor externo');
    expect(second.file).toBe('olas.mp4');
    expect(second.screens.map((screen) => screen.file)).toEqual(['olas.mp4', 'atardecer.png']);

    const heard = await commands.wallpaperSetSound(true, 'Pantalla integrada');
    expect(heard.sound).toBe(false);
    expect(heard.screens.map((screen) => [screen.sound, screen.audible])).toEqual([
      [true, true],
      [false, false],
    ]);

    // Con el mismo fondo en todos, el monitor se ignora.
    await commands.wallpaperSetPerScreen(false);
    const shared = await commands.wallpaperSelect('bosque.jpg', 'Monitor externo');
    expect(shared.screens.map((screen) => screen.file)).toEqual(['bosque.jpg', 'bosque.jpg']);
    await commands.wallpaperSetSound(false);
  });

  it('un archivo que no está en la carpeta se rechaza', async () => {
    await expect(commands.wallpaperSelect('nada.png')).rejects.toMatchObject({
      code: 'wallpaper.notFound',
    });
  });

  it('abrir la carpeta y añadir archivos responden sin hacer nada de verdad', async () => {
    await expect(commands.wallpaperOpenFolder()).resolves.toBeUndefined();
    expect(await commands.wallpaperAddFiles('Elige')).toHaveLength(4);
  });

  it('fuera de Tauri la dirección de un archivo es la ruta tal cual y no hay etiqueta de ventana', () => {
    expect(commands.fileUrl('/x/a.png')).toBe('/x/a.png');
    expect(commands.currentWindowLabel()).toBeNull();
  });

  it('pedir reproducir el video no hace nada fuera de Tauri', async () => {
    await expect(commands.wallpaperPlay()).resolves.toBeUndefined();
  });
});

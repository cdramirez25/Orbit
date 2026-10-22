<div align="center">

<img src="assets/app-icon.png" alt="Orbit" width="256" />

# Orbit

**Una isla dinámica modular para macOS y Windows.**

[English](../README.md) · **Español**

</div>

> **Estado:** en desarrollo temprano (v0.1.0). La isla ya muestra el clima, un historial del portapapeles y la música
> que suena; transcribe el audio del sistema en tu computadora (Whisper local) y responde preguntas con la IA que
> elijas (Claude, ChatGPT, Groq, Gemini, Ollama o Docker), con contexto e historial por sesión. Ya hay atajos globales y un
> icono en la bandeja. El empaquetado todavía no está listo. Consulta la [hoja de ruta](#hoja-de-ruta).

---

## ¿Qué es Orbit?

Orbit es una isla dinámica para tu escritorio: una pastilla negra en la parte de arriba de la pantalla que crece y
se encoge para mostrarte, en el momento, lo que necesitas ver. Es una plataforma hecha de módulos: cada módulo es un
pequeño plugin que toma la isla cuando tiene algo que mostrar, y la isla decide cuál va primero.

Hoy trae cuatro módulos:

- **Prompter (IA):** pensado para videollamadas (Meet, Zoom, Teams…). Orbit escucha lo que dicen los demás, lo
  transcribe en vivo y, cuando pulsas **Grabar audio** (o un atajo) y luego **Terminar y responder**, te muestra la
  respuesta en la isla, como un teleprompter. También puedes escribir la pregunta, o dejar que una sesión conteste sola
  las preguntas que oiga. Solo oye el audio que sale por tus bocinas o audífonos; tu micrófono nunca se captura.
- **Música:** lo que suena, con su portada y controles, y una barra de progreso donde puedes hacer clic o arrastrar
  para adelantar o atrasar.
- **Clima:** el clima actual y el pronóstico de hoy de tu zona.
- **Portapapeles:** el historial de lo que copias durante la sesión.

Alrededor de ellos hay una ventana de ajustes, un icono en la bandeja y atajos globales del teclado.

## Qué hay hoy

| Área               | Estado                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ventana de la isla | Transparente, sin bordes, siempre encima y sin robar foco. En macOS es un `NSPanel`.                                                                                                                                                                                                                                                                                                                                            |
| Máquina de estados | `hidden`, `idle`, `compact`, `expanded` y `alert`, con transiciones probadas (Vitest).                                                                                                                                                                                                                                                                                                                                          |
| Animación          | Morfeo de ancho, alto y radio con springs de `motion/react`; contenido que aparece/desaparece escalonado.                                                                                                                                                                                                                                                                                                                       |
| Notch              | Detección en macOS (estilo `attached`) y modo `floating` para Mac sin notch y Windows.                                                                                                                                                                                                                                                                                                                                          |
| Click-through      | La ventana ignora el mouse salvo cuando el puntero está sobre la isla.                                                                                                                                                                                                                                                                                                                                                          |
| Módulos            | Interfaz `OrbitModule` + registro con arbitraje por prioridad y selector entre los módulos residentes.                                                                                                                                                                                                                                                                                                                          |
| Ajustes            | Una ventana nativa con barra lateral (Isla, Sesiones, Audio, IA, General). En desarrollo se abre al iniciar; puedes cerrarla y volver a abrirla con el engranaje de la tarjeta o con el icono de la bandeja.                                                                                                                                                                                                                    |
| Música             | Lo que suena en tu computadora (Spotify, Música, YouTube o cualquier pestaña del navegador) con su portada, una barra de progreso donde puedes hacer clic o arrastrar para adelantar o atrasar, y botones de anterior, play/pausa y siguiente. En macOS usa una API privada del sistema, así que puede dejar de funcionar tras una actualización.                                                                               |
| Clima              | Clima actual y pronóstico de hoy de tu zona, siempre a un clic en la isla (Open-Meteo, sin clave de API).                                                                                                                                                                                                                                                                                                                       |
| Portapapeles       | Historial de los textos e imágenes que copias durante la sesión: volver a copiar, borrar uno o borrar todo. Vive solo en memoria.                                                                                                                                                                                                                                                                                               |
| UI                 | Primitivos accesibles (`Button`, `IconButton`, `Toggle`, `Tab`, `Card`) con `cursor: pointer` global. Todos los iconos son de [Lucide](https://lucide.dev); sin emojis.                                                                                                                                                                                                                                                         |
| Idiomas            | Español e inglés (`src/i18n/locales/`).                                                                                                                                                                                                                                                                                                                                                                                         |
| Audio del sistema  | Permiso de captura (macOS), captura real (ScreenCaptureKit en macOS, WASAPI loopback en Windows), conversión a 16 kHz mono y volumen que mueve las ondas de la isla.                                                                                                                                                                                                                                                            |
| Transcripción      | [Whisper](https://github.com/ggml-org/whisper.cpp) local (modelo `small` multilingüe, GPU con Metal en macOS) con el texto en vivo en la isla. Idioma: automático, español o inglés. El modelo (≈ 488 MB) se descarga desde Ajustes → Audio, con progreso, cancelar, reanudación automática y verificación de integridad; también se puede borrar desde ahí y guardar en la carpeta que elijas (por ejemplo, un disco externo). |
| Proveedores de IA  | Claude, ChatGPT, Groq, Gemini, Ollama (local) y Docker Model Runner (local). Guarda y prueba cada uno, elige su modelo de la lista que ofrece el propio proveedor y escoge el que se usa. Las respuestas llegan en streaming y se ven con negritas, cursivas, código y listas.                                                                                                                                                  |
| Sesiones           | Cada sesión tiene su propio prompt (cómo debe actuar la IA), todo el historial de preguntas y respuestas como contexto, una IA propia opcional y un interruptor "contestar sola". Se pregunta grabando audio o escribiendo en la isla.                                                                                                                                                                                          |
| Atajos             | Globales, funcionan con cualquier app al frente: `Cmd/Ctrl+Shift+Espacio` graba audio y lo envía a la IA, y `Cmd/Ctrl+Shift+H` muestra u oculta la isla. Puedes cambiar cualquiera en Ajustes → General (pulsando la nueva combinación) y restablecerlo al de por defecto.                                                                                                                                                      |
| Bandeja            | Un icono en la barra de menú (macOS) o en el área de notificaciones (Windows) para mostrar u ocultar la isla, abrir Ajustes o salir.                                                                                                                                                                                                                                                                                            |
| Inicio             | Un interruptor opcional en Ajustes → General para abrir Orbit solo al iniciar sesión (un LaunchAgent en macOS, las apps de inicio en Windows).                                                                                                                                                                                                                                                                                  |
| Primer arranque    | Una ventana guiada que se abre sola la primera vez: permiso de audio (macOS), modelo de voz, tu IA y los atajos. Cada paso se puede saltar, y se puede volver a ver desde Ajustes → General.                                                                                                                                                                                                                                    |

## Stack

| Capa                | Tecnología                                                |
| ------------------- | --------------------------------------------------------- |
| Shell de escritorio | [Tauri 2](https://tauri.app) (Rust)                       |
| Frontend            | React 19 + TypeScript + Vite (sin meta-framework)         |
| Animación           | [Motion](https://motion.dev) (`motion/react`)             |
| Iconos              | [Lucide](https://lucide.dev) (`lucide-react`)             |
| Estado              | Zustand                                                   |
| Estilos             | Tailwind CSS 4 (utilidades) + variables CSS               |
| Tests               | Vitest + Testing Library (frontend) · `cargo test` (Rust) |
| Transcripción       | `whisper-rs` (whisper.cpp), local, sin red                |
| Almacenamiento      | SQLite (`rusqlite`): claves de IA, config y sesiones      |
| Gestor de paquetes  | `pnpm`                                                    |

**Plataformas:** macOS 13+ (desarrollo principal) y Windows 10 2004+ / 11. Linux está fuera de alcance.

## Primeros pasos

### Requisitos

- [Node.js](https://nodejs.org) (LTS reciente) y [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) estable
- Los [prerrequisitos de Tauri 2](https://tauri.app/start/prerequisites/) para tu sistema
  (Xcode Command Line Tools en macOS; WebView2 y Build Tools de C++ en Windows)

### Instalar y ejecutar

```bash
pnpm install
```

```bash
pnpm tauri dev
```

`pnpm tauri dev` abre la app completa (ventana nativa + demo de la isla). Si solo quieres trabajar en el frontend,
`pnpm dev` lo sirve en <http://localhost:1420/island.html>.

### Primer uso

La primera vez que se abre Orbit, una guía te lleva por estos pasos (puedes saltarla y hacerlos después desde Ajustes, o volver a verla desde Ajustes → General):

1. **Ajustes → Audio:** descarga el modelo de voz (una sola vez) y, si siempre hablan el mismo idioma, elígelo.
2. **Ajustes → IA:** elige un proveedor y escribe su clave (o la dirección de uno local); los modelos que ofrece
   aparecen enseguida para que elijas uno de la lista. Luego pulsa Guardar, Probar y Usar.
3. **Ajustes → Sesiones:** crea una sesión y, si quieres, dale un prompt y una IA propia.
4. En la isla, abre la tarjeta de IA y pulsa **Grabar audio** (o `Cmd/Ctrl+Shift+Espacio`) mientras suena la pregunta,
   y luego **Terminar y responder**. También puedes escribir la pregunta en el campo de abajo.

> En macOS, para capturar el audio del sistema hay que conceder el permiso de **Grabación de pantalla**
> (Ajustes del Sistema → Privacidad y seguridad). La sección «Audio del sistema» de la ventana de ajustes muestra el estado del
> permiso y te lleva a Ajustes. Con `pnpm tauri dev`, macOS le da el permiso a la terminal (o a la app) desde la que
> lanzas Orbit, no a Orbit.

### Comandos útiles

| Comando                                                     | Para qué                    |
| ----------------------------------------------------------- | --------------------------- |
| `pnpm test`                                                 | Tests del frontend (Vitest) |
| `pnpm lint`                                                 | ESLint                      |
| `pnpm typecheck`                                            | `tsc --noEmit`              |
| `pnpm format` / `pnpm format:check`                         | Prettier                    |
| `cd src-tauri && cargo test`                                | Tests de Rust               |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Clippy sin avisos           |

## Arquitectura

Orbit sigue una **arquitectura hexagonal (Ports & Adapters)**: el núcleo no conoce los proveedores de IA, las APIs
del sistema operativo ni la UI.

```
 Adaptadores de entrada            Núcleo                    Adaptadores de salida
 (comandos Tauri, atajos,   ──►  pipeline/ · modules/  ──►  (Whisper local, Claude, ChatGPT, Groq, Gemini,
  tray, eventos al frontend)     solo conocen traits         Ollama, Docker, ScreenCaptureKit, WASAPI,
                                                             SQLite, JSON de ajustes)
```

Reglas clave:

- `pipeline/` y `modules/` dependen **solo de traits** (`AudioSource`, `SttEngine`, `LlmClient`, `ModelSource`,
  `EventSink`, `WeatherProvider`, `ClipboardPort`).
- Las implementaciones concretas se instancian **únicamente** en el _composition root_ (`lib.rs` + `app_state.rs`).
- Los adaptadores nunca se conocen entre sí. Cambiar de proveedor o de sistema operativo es elegir otro adaptador.
- Los comandos de Tauri son finos: validan, llaman al núcleo y devuelven. Sin lógica de negocio.
- En el frontend, los componentes **nunca** llaman a `invoke()`: pasan por stores y hooks, y solo `src/ipc/` habla
  con Rust.

### El pipeline del Prompter

```
Audio del sistema → remuestreo (16 kHz mono) → segmentador (pausas) → Whisper local (borrador + final)
   → pregunta (grabada con el botón/atajo, escrita o detectada) → LLM en streaming → isla (expanded)
```

Whisper no transcribe en streaming, así que el texto en vivo es un borrador que se repite sobre la frase en curso y se
cierra en cada pausa. La pregunta sale del audio grabado entre **Grabar audio** y **Terminar y responder**, de lo que
escribes o, en una sesión con «contestar sola» encendido, de cualquier frase que parezca una pregunta (signo `?` o un
interrogativo en español/inglés). La IA recibe el prompt de la sesión y el historial de esa sesión (si se hace
demasiado largo, se descartan los turnos más antiguos).

### Estructura del repositorio

```
Orbit/
├── docs/
│   ├── README.es.md     # README en español
│   └── assets/          # logo e imágenes
├── island.html          # Entrada de la ventana de la isla
├── settings.html        # Entrada de la ventana de ajustes
├── src/                 # Frontend (React + TSX)
│   ├── windows/         #   puntos de entrada, uno por ventana (island/ y settings/)
│   ├── components/      #   ui/ (primitivos) e island/ (Island, NotchShape, IslandContent, ModuleSwitcher)
│   ├── modules/         #   módulos de la isla (plugins): registry.ts, prompter/ (IA), weather/, clipboard/, music/ y demo/
│   ├── features/        #   contenido de la ventana de ajustes (settings/)
│   ├── stores/          #   estado global con Zustand (island, settings, audio, transcript, answer, sessions, model…)
│   ├── hooks/           #   useHitTest, useIslandDrag, useReducedMotion, useNow…
│   ├── ipc/             #   única capa que habla con Rust (commands, events, errors)
│   ├── lib/
│   │   ├── island/      #     máquina de estados y constantes de animación
│   │   ├── audio/       #     volumen del audio del sistema como MotionValue y mensajes de error
│   │   ├── markdown.ts  #     parser de markdown seguro para las respuestas (sin HTML)
│   │   ├── weather/     #     códigos del clima a tipos de condición
│   │   └── utils/       #     utilidades puras (cn, time)
│   ├── i18n/            #   textos en español e inglés
│   ├── styles/          #   base.css: tokens y regla global de cursor
│   ├── test/            #   configuración de Vitest
│   └── types/           #   tipos compartidos
└── src-tauri/           # Backend (Rust)
    ├── tauri.conf.json
    ├── capabilities/
    └── src/
        ├── lib.rs       #   composition root: aquí se eligen los adaptadores
        ├── app_state.rs #   estado compartido
        ├── events.rs    #   eventos de dominio y puerto EventSink
        ├── commands/    #   comandos de Tauri (finos): ai, audio, clipboard, desktop, island, media, pipeline, sessions, stt y weather
        ├── shortcuts.rs #   atajos globales configurables (adaptador de entrada)
        ├── tray.rs      #   icono de la barra de menú / área de notificaciones (adaptador de entrada)
        ├── db/          #   base de datos local SQLite (migraciones)
        ├── ai/          #   proveedores, clientes HTTP, prompter (respuestas) y almacén en SQLite
        ├── sessions/    #   sesiones: prompt, historial y contexto
        ├── stt/         #   puerto SttEngine, segmentador, transcriptor, Whisper local, descarga del modelo y su carpeta
        ├── window/      #   ventanas de la isla y de ajustes, posicionamiento, notch y platform/ (macOS y Windows)
        ├── audio/       #   puerto AudioSource, remuestreo, nivel de volumen, permiso y WAV de depuración
        │   └── platform/ #    ScreenCaptureKit (macOS) y WASAPI loopback (Windows)
        ├── pipeline/    #   orquestador: audio del sistema → volumen → eventos
        ├── weather/     #   puertos de ubicación y pronóstico, caché, localizador por IP y adaptador de Open-Meteo
        ├── clipboard/   #   puerto del portapapeles, historial en memoria, monitor y adaptador del sistema
        ├── media/       #   puerto de la música, monitor de lo que suena y adaptadores en platform/ (macOS: perl + MediaRemote; Windows: GSMTC)
        └── settings/    #   configuración persistida
```

## Privacidad y uso de red

- **Clima:** tu ubicación aproximada (a nivel de ciudad) se obtiene a partir de tu dirección IP con
  [ipwho.is](https://ipwho.is) y el pronóstico viene de [Open-Meteo](https://open-meteo.com). Ambos servicios reciben
  tu dirección IP; no se envía nada más. La ubicación no se guarda. La API gratuita de Open-Meteo es para uso no
  comercial y sus datos tienen licencia CC BY 4.0.
- **Música:** el título, el artista y la portada de lo que suena se leen del sistema y solo se muestran en la isla; nunca se guardan ni se escriben en logs.
- **Historial del portapapeles:** solo vive en memoria y desaparece al cerrar Orbit. Lo que los gestores de contraseñas
  marcan como oculto nunca se registra, y nada de lo que copias se escribe en logs ni se envía a ningún lado.
- **Audio del sistema:** solo lo que sale por tus bocinas o audífonos; tu micrófono nunca se captura.
- **Transcripción:** se hace en tu computadora con Whisper; el audio no se envía a ningún lado ni se guarda. El único uso
  de red es la descarga del modelo desde [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp), que recibe tu
  dirección IP.
- **IA:** el texto de la pregunta, el prompt de la sesión y el historial de la sesión se envían al proveedor que
  elegiste (Claude, ChatGPT, Groq o Gemini). Con Ollama o Docker todo se queda en tu computadora. No se envía nada más.
- **Claves y sesiones:** se guardan en una base de datos SQLite local (`orbit.db`, en la carpeta de configuración de la
  app), legible solo por tu usuario; nada se escribe en el repositorio ni en logs.
- **Atajos:** Orbit solo registra las dos combinaciones de arriba; no lee nada más de lo que escribes.

## Hoja de ruta

Orbit empezó como un Prompter de un solo propósito (escuchar, detectar una pregunta y responder) y ahora es una isla
modular, así que la hoja de ruta se organiza por metas y no por las fases originales (el plan técnico de esas fases
sigue en [`docs/SPEC.md`](SPEC.md)).

| Meta                      | Qué cubre                                                                                                                                                                                                                                          | Estado   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| La plataforma de la isla  | Ventana que nunca roba el foco, máquina de estados, animaciones, notch, click-through, registro de módulos con prioridades, español e inglés, primitivos de UI accesibles, ocultar de la pantalla compartida                                       | Hecha    |
| Módulos residentes        | Clima, historial del portapapeles y música (con avance y retroceso)                                                                                                                                                                                | Hecha    |
| Escuchar y transcribir    | Captura del audio del sistema (macOS y Windows), Whisper local con texto en vivo, descargar y borrar el modelo de voz desde Ajustes, idioma de la transcripción. Planeado: más modelos de voz (más rápidos y más precisos) y más idiomas           | Hecha    |
| IA y Prompter             | Claude, ChatGPT, Groq, Gemini, Ollama y Docker; el modelo se elige de la lista que ofrece cada proveedor; sesiones con su propio prompt, historial e IA; preguntas grabadas o escritas; respuestas con markdown; claves en un archivo SQLite local | Hecha    |
| Experiencia de escritorio | Hecho: ventana de ajustes, icono en la bandeja, atajos globales configurables, iniciar con la sesión, primer arranque guiado, elegir la carpeta del modelo de voz                                                                                  | Hecha    |
| Confianza y calidad       | Hecho: tests en todas las capas, Rust sin avisos (`clippy`). Pendiente: pruebas con Claude, ChatGPT, Ollama y Docker reales (hasta ahora solo se probaron en vivo las respuestas de Groq y la lista y los errores de Gemini) y en un Windows real  | En curso |
| Distribución              | `.dmg` e instalador de Windows publicados en GitHub Releases, `brew` (tap propio) y `winget`/Scoop, todo gratis y sin cuenta de Apple Developer                                                                                                    | Planeada |
| Más módulos y ecosistema  | Una guía para escribir tu propio módulo (`docs/ARCHITECTURE.md`) y módulos nuevos sobre el registro                                                                                                                                                | Planeada |

Conviene saber: las claves de API se guardan en SQLite y no en el llavero del sistema, así que nunca piden permiso del
llavero; el módulo de música usa una API privada del sistema en macOS y puede dejar de funcionar tras una
actualización; y el código específico de Windows (atajos, bandeja, música, audio del sistema) está comprobado solo al
compilar: todavía no se ha ejecutado en una máquina Windows real.

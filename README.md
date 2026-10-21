<div align="center">

<img src="docs/assets/app-icon.png" alt="Orbit" width="256" />

# Orbit

**A modular dynamic island for macOS and Windows.**

**English** · [Español](docs/README.es.md)

</div>

> **Status:** early development (v0.1.0). The island already shows the weather of your area and a clipboard history,
> and captures system audio (the waves follow the real volume); transcription and the Prompter are not ready yet.
> See the [roadmap](#roadmap).

---

## What is Orbit?

Orbit is a dynamic island for your desktop: a black pill at the top of the screen that grows and shrinks to show you,
right when you need it, what matters. It is built around modules, so what it shows depends on the active module.

The first one is **Prompter**, designed for video calls (Meet, Zoom, Teams…). Orbit listens to what the other people
say, detects when someone asks a question, and shows you the answer in the island, like a teleprompter. It only hears
the audio that comes out of your speakers or headphones; your microphone is never captured.

## What exists today

| Area          | Status                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island window | Transparent, borderless, always on top, and it never steals focus. On macOS it is an `NSPanel`.                                                                             |
| State machine | `hidden`, `idle`, `compact`, `expanded` and `alert`, with tested transitions (Vitest).                                                                                      |
| Animation     | Width, height and radius morphing with `motion/react` springs; content that fades in and out in a staggered way.                                                            |
| Notch         | Detection on macOS (`attached` style) and a `floating` mode for Macs without a notch and for Windows.                                                                       |
| Click-through | The window ignores the mouse except when the pointer is over the island.                                                                                                    |
| Modules       | `OrbitModule` interface + a registry with priority arbitration and a switcher between resident modules.                                                                     |
| Weather       | Current weather and today's forecast for your area, always one click away in the island (Open-Meteo, no API key).                                                           |
| Clipboard     | History of the text and images you copy during the session, with copy again, delete one and clear all. It lives in memory only.                                             |
| UI            | Accessible primitives (`Button`, `IconButton`, `Toggle`, `Tab`, `Card`) with a global `cursor: pointer`. All icons come from [Lucide](https://lucide.dev); no emojis.       |
| Languages     | Spanish and English (`src/i18n/locales/`).                                                                                                                                  |
| System audio  | Capture permission (macOS), real capture (ScreenCaptureKit on macOS, WASAPI loopback on Windows), conversion to 16 kHz mono, and the volume that drives the island's waves. |

## Stack

| Layer           | Technology                                                |
| --------------- | --------------------------------------------------------- |
| Desktop shell   | [Tauri 2](https://tauri.app) (Rust)                       |
| Frontend        | React 19 + TypeScript + Vite (no meta-framework)          |
| Animation       | [Motion](https://motion.dev) (`motion/react`)             |
| Icons           | [Lucide](https://lucide.dev) (`lucide-react`)             |
| State           | Zustand                                                   |
| Styling         | Tailwind CSS 4 (utilities) + CSS variables                |
| Tests           | Vitest + Testing Library (frontend) · `cargo test` (Rust) |
| Async Rust      | `tokio` (arrives with streaming STT, Phase 3)             |
| Package manager | `pnpm`                                                    |

**Platforms:** macOS 13+ (main development target) and Windows 10 2004+ / 11. Linux is out of scope.

## Getting started

### Requirements

- [Node.js](https://nodejs.org) (recent LTS) and [pnpm](https://pnpm.io)
- Stable [Rust](https://rustup.rs)
- The [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your system
  (Xcode Command Line Tools on macOS; WebView2 and the C++ Build Tools on Windows)

### Install and run

```bash
pnpm install
```

```bash
pnpm tauri dev
```

`pnpm tauri dev` opens the full app (native window + island demo). If you only want to work on the frontend,
`pnpm dev` serves it at <http://localhost:1420/island.html>.

> On macOS, capturing system audio requires granting the **Screen Recording** permission
> (System Settings → Privacy & Security). The "System audio" row of the demo panel shows the permission status and
> takes you to Settings. With `pnpm tauri dev`, macOS grants the permission to the terminal (or app) you launch Orbit
> from, not to Orbit itself.

### Useful commands

| Command                                                     | Purpose                 |
| ----------------------------------------------------------- | ----------------------- |
| `pnpm test`                                                 | Frontend tests (Vitest) |
| `pnpm lint`                                                 | ESLint                  |
| `pnpm typecheck`                                            | `tsc --noEmit`          |
| `pnpm format` / `pnpm format:check`                         | Prettier                |
| `cd src-tauri && cargo test`                                | Rust tests              |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Clippy with no warnings |

## Architecture

Orbit follows a **hexagonal architecture (Ports & Adapters)**: the core knows nothing about AI providers, operating
system APIs or the UI.

```
 Input adapters                    Core                      Output adapters
 (Tauri commands, shortcuts, ──►  pipeline/ · modules/  ──►  (Deepgram, local Whisper, Anthropic,
  tray, events to the frontend)   only know traits           OpenAI-compatible, ScreenCaptureKit,
                                                             WASAPI, keychain, JSON settings)
```

Key rules:

- `pipeline/` and `modules/` depend **only on traits** (`AudioSource`, `SttEngine`, `LlmProvider`, `EventSink`,
  `WeatherProvider`, `ClipboardPort`).
- Concrete implementations are instantiated **only** in the _composition root_ (`lib.rs` + `app_state.rs`).
- Adapters never know about each other. Switching provider or operating system means picking another adapter.
- Tauri commands are thin: they validate, call the core and return. No business logic.
- In the frontend, components **never** call `invoke()`: they go through stores and hooks, and only `src/ipc/` talks
  to Rust.

### The Prompter pipeline (target)

```
System audio → resampling (16 kHz mono) → VAD → streaming STT
   → question detector (+ ~30 s buffer) → streaming LLM → island (expanded)
```

The question detector fires on an end of utterance or a ~600–800 ms silence **and** a heuristic (a `?` sign,
Spanish/English interrogatives, or a list of options). There will also be a manual shortcut (`answer_now`).

### Repository structure

```
Orbit/
├── docs/
│   ├── README.es.md     # Spanish README
│   └── assets/          # logo and images
├── island.html          # Entry point of the island window
├── settings.html        # Entry point of the settings window
├── src/                 # Frontend (React + TSX)
│   ├── windows/         #   entry points, one per window (island/ and settings/)
│   ├── components/      #   ui/ (primitives) and island/ (Island, NotchShape, IslandContent, ModuleSwitcher)
│   ├── modules/         #   island modules (plugins): registry.ts, demo/, weather/ and clipboard/
│   ├── features/        #   settings screens (settings/)
│   ├── stores/          #   global state with Zustand (island, settings, audio, weather, clipboard)
│   ├── hooks/           #   useHitTest, useIslandDrag, useReducedMotion, useNow…
│   ├── ipc/             #   the only layer that talks to Rust (commands, events, errors)
│   ├── lib/
│   │   ├── island/      #     state machine and animation constants
│   │   ├── audio/       #     system audio volume as a MotionValue
│   │   ├── weather/     #     weather codes to condition types
│   │   └── utils/       #     pure utilities (cn, time)
│   ├── i18n/            #   Spanish and English texts
│   ├── styles/          #   base.css: tokens and the global cursor rule
│   ├── test/            #   Vitest setup
│   └── types/           #   shared types
└── src-tauri/           # Backend (Rust)
    ├── tauri.conf.json
    ├── capabilities/
    └── src/
        ├── lib.rs       #   composition root: adapters are chosen here
        ├── app_state.rs #   shared state
        ├── events.rs    #   domain events and the EventSink port
        ├── commands/    #   thin Tauri commands: audio, clipboard, island, pipeline and weather
        ├── window/      #   window, positioning, notch and platform/ (macOS and Windows)
        ├── audio/       #   AudioSource port, resampling, volume level, permission and debug WAV
        │   └── platform/ #    ScreenCaptureKit (macOS) and WASAPI loopback (Windows)
        ├── pipeline/    #   orchestrator: system audio → volume → events
        ├── weather/     #   location and forecast ports, cache, IP locator and Open-Meteo adapter
        ├── clipboard/   #   clipboard port, in-memory history, monitor and system adapter
        └── settings/    #   persisted configuration
```

## Privacy and network use

- **Weather:** your approximate location (city level) is looked up from your IP address with
  [ipwho.is](https://ipwho.is), and the forecast comes from [Open-Meteo](https://open-meteo.com). Both services receive
  your IP address; nothing else is sent. The location is not saved. Open-Meteo's free API is for non-commercial use
  and its data is licensed CC BY 4.0.
- **Clipboard history:** it only lives in memory and is gone when Orbit quits. Contents that password managers mark as
  concealed are never recorded, and nothing you copy is logged or sent anywhere.
- **System audio:** only what comes out of your speakers or headphones; your microphone is never captured.

## Roadmap

| Phase | Contents                                                                   | Status      |
| ----- | -------------------------------------------------------------------------- | ----------- |
| 0     | Scaffolding: Tauri 2 + React + Vite + Tailwind, lint, `@/` alias           | Done        |
| 1     | The island: window, state machine, animations, notch, click-through, i18n  | Done        |
| 2     | System audio capture (macOS and Windows), resampling and level meter       | In progress |
| 3     | Streaming transcription (Deepgram) and a local engine with `whisper-rs`    | Pending     |
| 4     | LLM clients (Anthropic and OpenAI-compatible), question detector, Prompter | Pending     |
| 5     | Settings, keychain, global shortcuts, tray, onboarding and consent         | Pending     |
| 6     | Polish, packaging (`.dmg`, `.msi`/`.exe`) and module documentation         | Pending     |

Along the way two resident modules were added ahead of the Prompter: the weather and the clipboard history.

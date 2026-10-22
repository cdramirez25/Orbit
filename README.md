<div align="center">

<img src="docs/assets/app-icon.png" alt="Orbit" width="256" />

# Orbit

**A modular dynamic island for macOS and Windows.**

**English** · [Español](docs/README.es.md)

</div>

> **Status:** early development (v0.1.0). The island already shows the weather, a clipboard history and the music
> that is playing; it transcribes the system audio on your computer (local Whisper) and answers questions with the AI
> you choose (Claude, ChatGPT, Groq, Gemini, Ollama or Docker), with a context and history per session. Global shortcuts and a
> tray icon are in. Packaging is not ready yet. See the [roadmap](#roadmap).

---

## What is Orbit?

Orbit is a dynamic island for your desktop: a black pill at the top of the screen that grows and shrinks to show you,
right when you need it, what matters. It is a platform built around modules: each module is a small plugin that takes
over the island when it has something to show, and the island decides which one goes first.

Today it comes with four modules:

- **Prompter (AI):** designed for video calls (Meet, Zoom, Teams…). Orbit listens to what the other people say,
  transcribes it live, and when you press **Record audio** (or a shortcut) and then **Finish and answer**, it shows you
  the answer in the island, like a teleprompter. You can also type the question, or let a session answer the questions
  it hears by itself. It only hears the audio that comes out of your speakers or headphones; your microphone is never
  captured.
- **Music:** what is playing, with its cover and controls, and a progress bar you can click or drag to seek.
- **Weather:** the current weather and today's forecast for your area.
- **Clipboard:** the history of what you copy during the session.

Around them there is a settings window, a tray icon and global keyboard shortcuts.

## What exists today

| Area          | Status                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island window | Transparent, borderless, always on top, and it never steals focus. On macOS it is an `NSPanel`.                                                                                                                                                                                                                                                                                                                         |
| State machine | `hidden`, `idle`, `compact`, `expanded` and `alert`, with tested transitions (Vitest).                                                                                                                                                                                                                                                                                                                                  |
| Animation     | Width, height and radius morphing with `motion/react` springs; content that fades in and out in a staggered way.                                                                                                                                                                                                                                                                                                        |
| Notch         | Detection on macOS (`attached` style) and a `floating` mode for Macs without a notch and for Windows.                                                                                                                                                                                                                                                                                                                   |
| Click-through | The window ignores the mouse except when the pointer is over the island.                                                                                                                                                                                                                                                                                                                                                |
| Modules       | `OrbitModule` interface + a registry with priority arbitration and a switcher between resident modules.                                                                                                                                                                                                                                                                                                                 |
| Settings      | A native window with a sidebar (Island, Sessions, Audio, AI, General). It opens on startup in development; you can close it and reopen it from the gear in the island card or from the tray icon.                                                                                                                                                                                                                       |
| Music         | What is playing on your computer (Spotify, Music, YouTube or any other tab in your browser) with its cover, a progress bar you can click or drag to seek, and previous, play/pause and next buttons. On macOS it uses a private system API, so it may stop working after an update.                                                                                                                                     |
| Weather       | Current weather and today's forecast for your area, always one click away in the island (Open-Meteo, no API key).                                                                                                                                                                                                                                                                                                       |
| Clipboard     | History of the text and images you copy during the session, with copy again, delete one and clear all. It lives in memory only.                                                                                                                                                                                                                                                                                         |
| UI            | Accessible primitives (`Button`, `IconButton`, `Toggle`, `Tab`, `Card`) with a global `cursor: pointer`. All icons come from [Lucide](https://lucide.dev); no emojis.                                                                                                                                                                                                                                                   |
| Languages     | Spanish and English (`src/i18n/locales/`).                                                                                                                                                                                                                                                                                                                                                                              |
| System audio  | Capture permission (macOS), real capture (ScreenCaptureKit on macOS, WASAPI loopback on Windows), conversion to 16 kHz mono, and the volume that drives the island's waves.                                                                                                                                                                                                                                             |
| Transcription | Local [Whisper](https://github.com/ggml-org/whisper.cpp) (`small` multilingual model, GPU with Metal on macOS) with live text in the island. Language: automatic, Spanish or English. The model (≈ 488 MB) is downloaded from Settings → Audio, with progress, cancel, automatic resume and an integrity check; it can be deleted from there too, and saved in a folder of your choice (for example an external drive). |
| AI providers  | Claude, ChatGPT, Groq, Gemini, Ollama (local) and Docker Model Runner (local). Save and test each one, pick its model from the list the provider itself offers, and choose the one in use. Answers stream in and render bold, italic, code and lists.                                                                                                                                                                   |
| Sessions      | Each session has its own prompt (how the AI should act), the whole history of questions and answers as context, an optional AI of its own, and an "answer by itself" switch. Ask by recording audio or by typing in the island.                                                                                                                                                                                         |
| Shortcuts     | Global, they work with any app in front: `Cmd/Ctrl+Shift+Space` records audio and sends it to the AI, and `Cmd/Ctrl+Shift+H` shows or hides the island. You can change either one in Settings → General (pressing the new combination) and reset it to its default.                                                                                                                                                     |
| Tray          | An icon in the menu bar (macOS) or the notification area (Windows) to show or hide the island, open Settings or quit.                                                                                                                                                                                                                                                                                                   |
| Startup       | An optional switch in Settings → General to open Orbit by itself when you log in (a LaunchAgent on macOS, the startup apps on Windows).                                                                                                                                                                                                                                                                                 |
| First run     | A guided window that opens by itself the first time: audio permission (macOS), voice model, your AI and the shortcuts. Every step can be skipped, and you can see it again from Settings → General.                                                                                                                                                                                                                     |

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
| Transcription   | `whisper-rs` (whisper.cpp), local, no network             |
| Local storage   | SQLite (`rusqlite`) for AI keys, config and sessions      |
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

### First use

The first time Orbit opens, a guide walks you through these steps (you can skip it and do them later from Settings, or see it again from Settings → General):

1. **Settings → Audio:** download the voice model (once) and, if you always speak the same language, pick it.
2. **Settings → AI:** choose a provider and type its key (or the address of a local one); the models it offers
   appear right away so you can pick one from the list. Then press Save, Test and Use.
3. **Settings → Sessions:** create a session and, if you want, give it a prompt and an AI of its own.
4. In the island, open the AI card and press **Record audio** (or `Cmd/Ctrl+Shift+Space`) while the question plays,
   then **Finish and answer**. You can also type the question in the field below.

> On macOS, capturing system audio requires granting the **Screen Recording** permission
> (System Settings → Privacy & Security). The "System audio" section of the settings window shows the permission status and
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
 (Tauri commands, shortcuts, ──►  pipeline/ · modules/  ──►  (local Whisper, Claude, ChatGPT, Groq, Gemini,
  tray, events to the frontend)   only know traits           Ollama, Docker, ScreenCaptureKit, WASAPI,
                                                             SQLite, JSON settings)
```

Key rules:

- `pipeline/` and `modules/` depend **only on traits** (`AudioSource`, `SttEngine`, `LlmClient`, `ModelSource`,
  `EventSink`, `WeatherProvider`, `ClipboardPort`).
- Concrete implementations are instantiated **only** in the _composition root_ (`lib.rs` + `app_state.rs`).
- Adapters never know about each other. Switching provider or operating system means picking another adapter.
- Tauri commands are thin: they validate, call the core and return. No business logic.
- In the frontend, components **never** call `invoke()`: they go through stores and hooks, and only `src/ipc/` talks
  to Rust.

### The Prompter pipeline

```
System audio → resampling (16 kHz mono) → segmenter (pauses) → local Whisper (draft + final)
   → question (recorded with the button/shortcut, typed, or detected) → streaming LLM → island (expanded)
```

Whisper does not stream, so the live text is a draft that is repeated over the phrase in progress and closed at each
pause. The question comes from the audio recorded between **Record audio** and **Finish and answer**, from what you
type, or, in a session with "answer by itself" on, from any phrase that looks like a question (a `?` sign or a
Spanish/English interrogative). The AI receives the session prompt and the history of that session (the oldest turns
are dropped when it gets too long).

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
│   ├── modules/         #   island modules (plugins): registry.ts, prompter/ (AI), weather/, clipboard/, music/ and demo/
│   ├── features/        #   settings window content (settings/)
│   ├── stores/          #   global state with Zustand (island, settings, audio, transcript, answer, sessions, model…)
│   ├── hooks/           #   useHitTest, useIslandDrag, useReducedMotion, useNow…
│   ├── ipc/             #   the only layer that talks to Rust (commands, events, errors)
│   ├── lib/
│   │   ├── island/      #     state machine and animation constants
│   │   ├── audio/       #     system audio volume as a MotionValue and error messages
│   │   ├── markdown.ts  #     safe markdown parser for the answers (no HTML)
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
        ├── commands/    #   thin Tauri commands: ai, audio, clipboard, desktop, island, media, pipeline, sessions, stt and weather
        ├── shortcuts.rs #   configurable global shortcuts (input adapter)
        ├── tray.rs      #   menu bar / notification area icon (input adapter)
        ├── db/          #   local SQLite database (migrations)
        ├── ai/          #   providers, HTTP clients, prompter (answers) and SQLite store
        ├── sessions/    #   sessions: prompt, history and context
        ├── stt/         #   SttEngine port, segmenter, transcriber, local Whisper, the model download and its folder
        ├── window/      #   island and settings windows, positioning, notch and platform/ (macOS and Windows)
        ├── audio/       #   AudioSource port, resampling, volume level, permission and debug WAV
        │   └── platform/ #    ScreenCaptureKit (macOS) and WASAPI loopback (Windows)
        ├── pipeline/    #   orchestrator: system audio → volume → events
        ├── weather/     #   location and forecast ports, cache, IP locator and Open-Meteo adapter
        ├── clipboard/   #   clipboard port, in-memory history, monitor and system adapter
        ├── media/       #   music port, now-playing monitor and platform/ adapters (macOS: perl + MediaRemote; Windows: GSMTC)
        └── settings/    #   persisted configuration
```

## Privacy and network use

- **Weather:** your approximate location (city level) is looked up from your IP address with
  [ipwho.is](https://ipwho.is), and the forecast comes from [Open-Meteo](https://open-meteo.com). Both services receive
  your IP address; nothing else is sent. The location is not saved. Open-Meteo's free API is for non-commercial use
  and its data is licensed CC BY 4.0.
- **Music:** the title, artist and cover of what is playing are read from the system and shown only in the island; they are never saved or logged.
- **Clipboard history:** it only lives in memory and is gone when Orbit quits. Contents that password managers mark as
  concealed are never recorded, and nothing you copy is logged or sent anywhere.
- **System audio:** only what comes out of your speakers or headphones; your microphone is never captured.
- **Transcription:** it runs on your computer with Whisper; the audio is never sent anywhere and is not saved. The only
  network use is downloading the model from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp), which
  receives your IP address.
- **AI:** the text of the question, the session prompt and the session history are sent to the provider you picked
  (Claude, ChatGPT, Groq or Gemini). With Ollama or Docker everything stays on your computer. Nothing else is sent.
- **Keys and sessions:** they are stored in a local SQLite database (`orbit.db`, in the app's config folder), readable
  only by your user; nothing is written to the repository or to logs.
- **Shortcuts:** Orbit only registers the two combinations above; it does not read anything else you type.

## Roadmap

Orbit started as a single-purpose Prompter (listen, detect a question, answer) and is now a modular island, so the
roadmap is organised by goals instead of by the original phases (the technical plan of those phases is still in
[`docs/SPEC.md`](docs/SPEC.md)).

| Goal                        | What it covers                                                                                                                                                                                                                        | Status      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| The island platform         | Window that never steals focus, state machine, animations, notch, click-through, module registry with priorities, Spanish and English, accessible UI primitives, hide from screen share                                               | Done        |
| Resident modules            | Weather, clipboard history and music (with seek)                                                                                                                                                                                      | Done        |
| Listen and transcribe       | System audio capture (macOS and Windows), local Whisper with live text, download and delete the voice model from Settings, transcription language. Planned: more voice models (faster and more accurate) and more languages           | Done        |
| AI and Prompter             | Claude, ChatGPT, Groq, Gemini, Ollama and Docker; the model is chosen from the list each provider offers; sessions with their own prompt, history and AI; recorded or typed questions; markdown answers; keys in a local SQLite file  | Done        |
| Everyday desktop experience | Done: settings window, tray icon, configurable global shortcuts, launch at login, guided first run, choose the voice model folder                                                                                                     | Done        |
| Trust and quality           | Done: tests in every layer, Rust without warnings (`clippy`). Pending: runs with real Claude, ChatGPT, Ollama and Docker (so far only Groq answers and Gemini's list and error path were checked live), and on a real Windows machine | In progress |
| Distribution                | `.dmg` and Windows installer published in GitHub Releases, `brew` (own tap) and `winget`/Scoop, all free and without an Apple Developer account                                                                                       | Planned     |
| More modules and ecosystem  | A guide to write your own module (`docs/ARCHITECTURE.md`) and new modules on top of the registry                                                                                                                                      | Planned     |

Good to know: API keys are stored in SQLite instead of the system keychain, so they never trigger keychain prompts; the
music module uses a private system API on macOS and may stop working after an update; and the Windows-specific code
(shortcuts, tray, music, system audio) is compile-checked but has not been run on a real Windows machine yet.

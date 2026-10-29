# Contributing to Orbit

[Leer en español](docs/CONTRIBUTING.es.md)

Thanks for wanting to help. Orbit is a dynamic island for macOS and Windows built with Tauri 2 and React, and it is
easy to extend because every feature is a module. This guide explains how to get a change merged without surprises.

## The one rule: pull requests go to `develop`

| Branch    | What it is                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- |
| `develop` | Where all the work lands. It is the default branch: **open every pull request against it.**     |
| `main`    | Released code only. The maintainer updates it by merging `develop` when a version is published. |

If you open a pull request against `main` by mistake, a workflow ([`pr-target`](.github/workflows/pr-target.yml))
moves it to `develop` for you and leaves a comment. Nothing is lost, but it is easier to start from `develop`.

## Before you start

- **Small fix** (a typo, a bug with an obvious cause): open the pull request directly.
- **Bigger change** (a new module, a new dependency, a change to the architecture, a new network call): open an issue
  first and describe what you want to do, so nobody spends a weekend on something that does not fit.
- Look for an existing issue before opening a new one.

## Set up

You need [Node.js](https://nodejs.org) (recent LTS), [pnpm](https://pnpm.io), stable [Rust](https://rustup.rs) and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your system (Xcode Command Line Tools on macOS;
WebView2 and the C++ Build Tools on Windows). Building the local voice model also needs `cmake`.

```bash
git clone https://github.com/<your-user>/Orbit.git
cd Orbit
git remote add upstream https://github.com/cdramirez25/Orbit.git
git checkout -b feat/my-change upstream/develop
pnpm install
```

| Command          | What for                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| `pnpm tauri dev` | The full app (native window, island, settings)                                        |
| `pnpm dev`       | Only the frontend, at <http://localhost:1420/island.html>, with simulated system data |

## The workflow

1. Fork the repository (or, if you have write access, create a branch).
2. Create a branch **from the latest `develop`**. Name it `feat/...`, `fix/...`, `docs/...`, `refactor/...`,
   `test/...` or `chore/...`.
3. Make the change, with tests (see below).
4. Run every check in the next section. They must all pass.
5. Open a pull request against `develop` and fill in the template.
6. Answer the review. Push new commits to the same branch; do not open a new pull request.

Pull requests are squash-merged, so **the title of the pull request is what stays in the history**. Write it, and your
commits, as [Conventional Commits](https://www.conventionalcommits.org): `type(scope): what it does`, in the imperative
and in English. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. Examples:
`feat(system): add a System module with battery, CPU, memory and network`,
`fix(wallpaper): keep the video paused while a full-screen window is open`.

Keep a pull request to **one thing**. Two unrelated fixes are two pull requests.

## Checks that must pass

Run these before you push. If you touched only the frontend or only Rust, run that half.

| Command                                                     | Purpose                           |
| ----------------------------------------------------------- | --------------------------------- |
| `pnpm test`                                                 | Frontend tests (Vitest)           |
| `pnpm lint`                                                 | ESLint                            |
| `pnpm typecheck`                                            | `tsc --noEmit`                    |
| `pnpm format:check`                                         | Prettier (`pnpm format` fixes it) |
| `cd src-tauri && cargo fmt --check`                         | Rust formatting                   |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Clippy with no warnings           |
| `cd src-tauri && cargo test`                                | Rust tests                        |

## Tests

- Every change that alters behavior comes with a test that fails without it. A test that cannot fail is not a test.
- Name tests after the behavior (`a_counter_that_goes_back_is_not_a_negative_speed`), not after the function.
- Rust: the core is tested with fake adapters (no network, no devices, no real clock). Tests that need your real
  hardware or system permissions are marked `#[ignore]` and say how to run them.
- Some things can only be checked by hand: macOS permissions (Screen Recording, Camera), Windows behavior, a real video
  call. If your change touches one, say in the pull request what you tried and on which system. If you could not try
  it on Windows or macOS, say that too: it is fine, and it tells the reviewer where to look.

## Code rules

These are checked in review. Following them is the difference between a quick merge and a long review.

**Architecture**

- The backend is hexagonal. `pipeline/` and the services in each module only know **traits** (ports). The concrete
  adapters (the ones that talk to the system, the network or a device) are created in one place: `src-tauri/src/lib.rs`.
- Code that is specific to an operating system lives only under `#[cfg(target_os = "...")]` and in a `platform/` folder.
- Tauri commands are thin: validate, call the service, return. No business logic in them.
- UI components never call `invoke()` and never import `@/ipc/`. They read from stores and hooks; stores talk to
  `src/ipc/commands.ts`, which also has a simulation for the browser (`pnpm dev`).

**Frontend**

- TypeScript is strict: no `any`. Components are functional.
- Imports always use `@/` (never `../`). Types shared by two files live in `src/types/`.
- **Every piece of visible or accessible text** (buttons, `aria-label`, `title`, sample content) goes in
  `src/i18n/locales/es.ts` **and** `en.ts` with the same keys, and is read with `useT()`. No hard-coded strings in
  components.
- **Icons only from [`lucide-react`](https://lucide.dev). No emojis anywhere** (UI, texts, code, comments, READMEs), and no
  hand-drawn SVG icons. A test enforces it.
- Anything clickable uses the primitives in `src/components/ui/` (or `role="button"`) and shows `cursor: pointer`.
- Animation constants live only in `src/lib/island/island.motion.ts`. Animate only `transform`, `opacity` and the
  container size, with `MotionValue`s (no `useState` per frame).

**Rust**

- Errors with `thiserror`; logs with `tracing`. **Never log audio, transcriptions or API keys.**
- No `unwrap()` outside tests. Clippy must be clean.

**Dependencies and licenses**

- New dependencies must be MIT, Apache-2.0 or BSD. Ask first before adding any other license.
- Do not copy code from AGPL or GPL projects, however useful it looks.

**Privacy**

- Orbit only talks to the network where the README says it does. A change that adds a new request, or sends anything
  new, needs an issue first. API keys stay in the local database.

Comments and documentation in the repository are mostly in Spanish. English is fine in contributions: keep the language
of the file you are editing.

## Adding a module

Every island feature is a module. Take [`src/modules/system/`](src/modules/system) (and its Rust side,
`src-tauri/src/system_stats/`) as a recent, complete example.

1. **Frontend:** create `src/modules/<name>/` with `index.ts` (an `OrbitModule`: `id`, `labelKey`, `icon`, `priority`,
   `ambient`, `Compact`, `Expanded`), `Compact.tsx` and `Expanded.tsx`. Register it in `src/windows/island/main.tsx`.
2. **State:** a store in `src/stores/<name>.store.ts` that talks to `src/ipc/commands.ts`. Add the command there, with a
   believable simulation for when there is no Tauri.
3. **Backend, if it needs the system:** a folder in `src-tauri/src/<name>/` with the types, a **port** (trait), a service
   with the logic, and the adapter (OS-specific parts in `platform/`). Then the thin command in `commands/`, the service
   in `app_state.rs`, and the adapter choice in `lib.rs`.
4. **Text:** every string in `es.ts` and `en.ts`.
5. **Tests** for the pure logic, the store and the components, plus fake-adapter tests for the Rust service.
6. **Docs:** add the module to the feature list and the table in `README.md` and `docs/README.es.md`.

## Documentation

If your change adds or alters something a user can see, update **both** `README.md` (English) and `docs/README.es.md`
(Spanish), and `docs/CONTRIBUTING.es.md` if you change this guide.

## Pull request checklist

The template asks for the same things:

- [ ] The pull request targets `develop`.
- [ ] It does one thing, and the title follows Conventional Commits.
- [ ] Tests are added or updated, and all the checks above pass.
- [ ] New text is in both `es.ts` and `en.ts`; icons come from `lucide-react`; no emojis.
- [ ] README and `docs/README.es.md` are updated if users can see the change.
- [ ] I said what I tested by hand and on which system.
- [ ] New dependencies are MIT, Apache-2.0 or BSD.

## Releases

Maintainers only: see [`docs/RELEASING.md`](docs/RELEASING.md).

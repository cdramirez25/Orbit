<!-- Open this pull request against `develop`. Pull requests against `main` are moved to `develop` automatically. -->

## What does this change?

<!-- One thing per pull request. The title must follow Conventional Commits: type(scope): what it does -->

## How did you test it?

<!-- Commands you ran, and what you tried by hand and on which system (macOS / Windows). Say so if you could not try one. -->

## Checklist

- [ ] The pull request targets `develop`
- [ ] It does one thing, and the title follows Conventional Commits
- [ ] Tests added or updated; `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` pass
- [ ] Rust (if touched): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` pass
- [ ] New text is in both `es.ts` and `en.ts`; icons come from `lucide-react`; no emojis
- [ ] `README.md` and `docs/README.es.md` updated if users can see the change
- [ ] New dependencies are MIT, Apache-2.0 or BSD

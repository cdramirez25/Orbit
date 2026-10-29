# Contribuir a Orbit

[Read in English](../CONTRIBUTING.md)

Gracias por querer ayudar. Orbit es una isla dinámica para macOS y Windows hecha con Tauri 2 y React, y es fácil de
ampliar porque cada función es un módulo. Esta guía explica cómo lograr que un cambio se acepte sin sorpresas.

## La regla principal: los pull requests van a `develop`

| Rama      | Qué es                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `develop` | Donde llega todo el trabajo. Es la rama por defecto: **abre todos tus pull requests contra ella.**                    |
| `main`    | Solo código ya publicado. La persona que mantiene el proyecto la actualiza uniendo `develop` al publicar una versión. |

Si abres un pull request contra `main` por error, un workflow ([`pr-target`](../.github/workflows/pr-target.yml)) lo
pasa a `develop` por ti y deja un comentario. No se pierde nada, pero es más fácil partir de `develop`.

## Antes de empezar

- **Arreglo pequeño** (una errata, un bug con causa evidente): abre el pull request directamente.
- **Cambio grande** (un módulo nuevo, una dependencia nueva, un cambio de arquitectura, una nueva llamada a la red):
  abre primero un issue y cuenta qué quieres hacer, para que nadie invierta un fin de semana en algo que no encaja.
- Busca si ya existe un issue antes de abrir uno nuevo.

## Preparar el entorno

Necesitas [Node.js](https://nodejs.org) (LTS reciente), [pnpm](https://pnpm.io), [Rust](https://rustup.rs) estable y los
[requisitos de Tauri 2](https://tauri.app/start/prerequisites/) de tu sistema (Xcode Command Line Tools en macOS;
WebView2 y las C++ Build Tools en Windows). Compilar el modelo de voz local también necesita `cmake`.

```bash
git clone https://github.com/<tu-usuario>/Orbit.git
cd Orbit
git remote add upstream https://github.com/cdramirez25/Orbit.git
git checkout -b feat/mi-cambio upstream/develop
pnpm install
```

| Comando          | Para qué                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `pnpm tauri dev` | La app completa (ventana nativa, isla, ajustes)                                           |
| `pnpm dev`       | Solo el frontend, en <http://localhost:1420/island.html>, con datos del sistema simulados |

## El flujo

1. Haz un fork del repositorio (o, si tienes permiso de escritura, crea una rama).
2. Crea una rama **desde el `develop` más reciente**. Llámala `feat/...`, `fix/...`, `docs/...`, `refactor/...`,
   `test/...` o `chore/...`.
3. Haz el cambio, con sus pruebas (mira más abajo).
4. Ejecuta todas las comprobaciones de la sección siguiente. Todas deben pasar.
5. Abre un pull request contra `develop` y rellena la plantilla.
6. Responde a la revisión. Sube los commits nuevos a la misma rama; no abras otro pull request.

Los pull requests se unen con squash, así que **el título del pull request es lo que queda en el historial**. Escríbelo, y
también tus commits, como [Conventional Commits](https://www.conventionalcommits.org): `tipo(ámbito): qué hace`, en
imperativo y en inglés. Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. Ejemplos:
`feat(system): add a System module with battery, CPU, memory and network`,
`fix(wallpaper): keep the video paused while a full-screen window is open`.

Un pull request hace **una sola cosa**. Dos arreglos sin relación son dos pull requests.

## Comprobaciones que deben pasar

Ejecútalas antes de subir. Si solo tocaste el frontend o solo Rust, ejecuta esa mitad.

| Comando                                                     | Para qué                            |
| ----------------------------------------------------------- | ----------------------------------- |
| `pnpm test`                                                 | Pruebas del frontend (Vitest)       |
| `pnpm lint`                                                 | ESLint                              |
| `pnpm typecheck`                                            | `tsc --noEmit`                      |
| `pnpm format:check`                                         | Prettier (`pnpm format` lo arregla) |
| `cd src-tauri && cargo fmt --check`                         | Formato de Rust                     |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Clippy sin avisos                   |
| `cd src-tauri && cargo test`                                | Pruebas de Rust                     |

## Pruebas

- Todo cambio que altere el comportamiento lleva una prueba que falla sin él. Una prueba que no puede fallar no sirve.
- Pon a las pruebas el nombre del comportamiento (`a_counter_that_goes_back_is_not_a_negative_speed`), no el de la función.
- Rust: el núcleo se prueba con adaptadores falsos (sin red, sin dispositivos, sin reloj real). Las pruebas que necesitan
  tu hardware real o permisos del sistema llevan `#[ignore]` y explican cómo ejecutarlas.
- Algunas cosas solo se comprueban a mano: permisos de macOS (Grabación de pantalla, Cámara), el comportamiento en
  Windows, una videollamada real. Si tu cambio toca alguna, di en el pull request qué probaste y en qué sistema. Si no
  pudiste probarlo en Windows o macOS, dilo también: no pasa nada, y le dice a quien revisa dónde mirar.

## Reglas del código

Se revisan en el pull request. Cumplirlas es la diferencia entre una unión rápida y una revisión larga.

**Arquitectura**

- El backend es hexagonal. `pipeline/` y los servicios de cada módulo solo conocen **traits** (puertos). Los
  adaptadores concretos (los que hablan con el sistema, la red o un dispositivo) se crean en un único sitio:
  `src-tauri/src/lib.rs`.
- El código específico de un sistema operativo va solo bajo `#[cfg(target_os = "...")]` y en una carpeta `platform/`.
- Los comandos de Tauri son finos: validan, llaman al servicio y devuelven. Sin lógica de negocio.
- Los componentes de la interfaz nunca llaman a `invoke()` ni importan `@/ipc/`. Leen de stores y hooks; los stores
  hablan con `src/ipc/commands.ts`, que también tiene una simulación para el navegador (`pnpm dev`).

**Frontend**

- TypeScript estricto: sin `any`. Componentes funcionales.
- Los imports siempre llevan `@/` (nunca `../`). Los tipos que usan dos archivos viven en `src/types/`.
- **Todo texto visible o accesible** (botones, `aria-label`, `title`, contenido de ejemplo) va en
  `src/i18n/locales/es.ts` **y** `en.ts` con las mismas claves, y se lee con `useT()`. Nada de textos fijos en los
  componentes.
- **Iconos solo de [`lucide-react`](https://lucide.dev). Nada de emojis en ningún sitio** (interfaz, textos, código,
  comentarios, READMEs) ni iconos SVG dibujados a mano. Una prueba lo vigila.
- Todo lo clicable usa los primitivos de `src/components/ui/` (o `role="button"`) y muestra `cursor: pointer`.
- Las constantes de animación viven solo en `src/lib/island/island.motion.ts`. Anima solo `transform`, `opacity` y el
  tamaño del contenedor, con `MotionValue`s (nada de `useState` por fotograma).

**Rust**

- Errores con `thiserror`; logs con `tracing`. **Nunca registres audio, transcripciones ni claves de API.**
- Sin `unwrap()` fuera de las pruebas. Clippy limpio.

**Dependencias y licencias**

- Las dependencias nuevas deben ser MIT, Apache-2.0 o BSD. Pregunta antes de añadir cualquier otra licencia.
- No copies código de proyectos AGPL o GPL, por útil que parezca.

**Privacidad**

- Orbit solo habla con la red donde el README dice que lo hace. Un cambio que añada una petición nueva, o que envíe algo
  nuevo, necesita un issue antes. Las claves de API se quedan en la base de datos local.

Los comentarios y la documentación del repositorio están sobre todo en español. En las contribuciones se acepta inglés:
mantén el idioma del archivo que estás editando.

## Añadir un módulo

Cada función de la isla es un módulo. Toma [`src/modules/system/`](../src/modules/system) (y su parte de Rust,
`src-tauri/src/system_stats/`) como un ejemplo reciente y completo.

1. **Frontend:** crea `src/modules/<nombre>/` con `index.ts` (un `OrbitModule`: `id`, `labelKey`, `icon`, `priority`,
   `ambient`, `Compact`, `Expanded`), `Compact.tsx` y `Expanded.tsx`. Regístralo en `src/windows/island/main.tsx`.
2. **Estado:** un store en `src/stores/<nombre>.store.ts` que hable con `src/ipc/commands.ts`. Añade ahí el comando, con
   una simulación creíble para cuando no hay Tauri.
3. **Backend, si necesita el sistema:** una carpeta `src-tauri/src/<nombre>/` con los tipos, un **puerto** (trait), un
   servicio con la lógica y el adaptador (lo específico de cada sistema, en `platform/`). Después, el comando fino en
   `commands/`, el servicio en `app_state.rs` y la elección del adaptador en `lib.rs`.
4. **Texto:** cada cadena en `es.ts` y `en.ts`.
5. **Pruebas** de la lógica pura, el store y los componentes, y del servicio de Rust con adaptadores falsos.
6. **Documentación:** añade el módulo a la lista de funciones y a la tabla de `README.md` y `docs/README.es.md`.

## Documentación

Si tu cambio añade o altera algo que ve el usuario, actualiza **los dos**: `README.md` (inglés) y `docs/README.es.md`
(español), y `CONTRIBUTING.md` si cambias esta guía.

## Lista para el pull request

La plantilla pide lo mismo:

- [ ] El pull request apunta a `develop`.
- [ ] Hace una sola cosa y el título sigue Conventional Commits.
- [ ] Hay pruebas nuevas o actualizadas y pasan todas las comprobaciones de arriba.
- [ ] El texto nuevo está en `es.ts` y `en.ts`; los iconos son de `lucide-react`; no hay emojis.
- [ ] El README y `docs/README.es.md` están al día si el usuario ve el cambio.
- [ ] Dije qué probé a mano y en qué sistema.
- [ ] Las dependencias nuevas son MIT, Apache-2.0 o BSD.

## Publicar versiones

Solo para quien mantiene el proyecto: mira [`docs/RELEASING.md`](RELEASING.md).

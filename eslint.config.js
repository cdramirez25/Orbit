import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Imports relativos que suben de nivel: prohibidos (usar el alias "@/"). Los de "./" se permiten.
const noParentImports = {
  regex: '^\\.\\./',
  message: 'Usa el alias "@/" en lugar de rutas relativas que suben de nivel ("../").',
};

// Solo `src/ipc/` puede hablar con Tauri (§4.1.1).
const noTauriImports = {
  group: ['@tauri-apps/*'],
  message: 'Solo `src/ipc/` puede importar de `@tauri-apps/api`.',
};

// Los componentes de presentación leen de stores/hooks, nunca de `ipc/` (§4.0).
const noIpcInComponents = {
  group: ['@/ipc', '@/ipc/*'],
  message: 'Los componentes no llaman a `@/ipc/` directamente: usa un store o un hook.',
};

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules', 'src-tauri/target', 'src-tauri/gen']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended, // incluye no-explicit-any
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [noParentImports, noTauriImports] }],
    },
  },

  // `src/ipc/` es la única capa que importa de Tauri.
  {
    files: ['src/ipc/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noParentImports] }],
    },
  },

  // Componentes React: presentación pura.
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [noParentImports, noTauriImports, noIpcInComponents] },
      ],
    },
  },

  // Archivos de configuración (Node).
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Debe ir al final: desactiva reglas de estilo que chocan con Prettier.
  prettier,
]);

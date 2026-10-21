/// <reference types="vitest/config" />
import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Alias "@" → src/. Debe coincidir con tsconfig.json ("paths") y eslint.config.js.
  // Vitest hereda esta configuración, así que los tests también resuelven "@/".
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },

  // Evita que Vite oculte los errores de Rust.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },

  // Una entrada HTML por ventana de Tauri.
  build: {
    rollupOptions: {
      input: {
        island: path.resolve(import.meta.dirname, 'island.html'),
        settings: path.resolve(import.meta.dirname, 'settings.html'),
      },
    },
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

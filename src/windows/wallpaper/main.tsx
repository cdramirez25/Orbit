import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { useWallpaperStore } from '@/stores/wallpaper.store';
import { App } from '@/windows/wallpaper/App';

// Ventana de fondo (una por monitor, detrás de los iconos del escritorio): solo dibuja lo elegido y
// obedece las pausas que manda Rust.
void useWallpaperStore.getState().bind();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

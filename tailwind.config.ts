import type { Config } from 'tailwindcss';

// Tailwind 4 es "CSS first": los tokens viven como variables CSS en src/styles/base.css.
// Este archivo solo los expone como utilidades (se carga con `@config` desde base.css).
export default {
  content: ['./island.html', './settings.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        island: 'var(--island-bg)',
        'island-border': 'var(--island-border)',
        ink: 'var(--ink)',
        'ink-dim': 'var(--ink-dim)',
        'ink-faint': 'var(--ink-faint)',
        accent: 'var(--accent)',
        danger: 'var(--danger)',
      },
    },
  },
} satisfies Config;

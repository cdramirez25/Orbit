import { afterEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { emitLocal, onEvent } from '@/ipc/events';

afterEach(async () => {
  await commands.stopListening(); // deja la simulación parada entre tests
  vi.useRealTimers();
});

describe('commandErrorCode', () => {
  it('lee el código de un error de Rust', () => {
    expect(commandErrorCode({ code: 'audio.noOutputDevice', message: 'x' })).toBe(
      'audio.noOutputDevice',
    );
  });

  it('devuelve null si no hay código', () => {
    expect(commandErrorCode(new Error('x'))).toBeNull();
    expect(commandErrorCode('texto')).toBeNull();
    expect(commandErrorCode(null)).toBeNull();
    expect(commandErrorCode({ code: 42 })).toBeNull();
  });
});

describe('eventos en el navegador (sin Tauri)', () => {
  it('entrega los eventos emitidos a quien se suscribió', async () => {
    const received: number[] = [];
    await onEvent('audio:level', (level) => received.push(level));
    emitLocal('audio:level', 0.3);
    emitLocal('audio:level', 0.9);
    expect(received).toEqual([0.3, 0.9]);
  });

  it('al desuscribirse deja de recibir', async () => {
    const received: number[] = [];
    const off = await onEvent('audio:level', (level) => received.push(level));
    emitLocal('audio:level', 0.1);
    off();
    emitLocal('audio:level', 0.2);
    expect(received).toEqual([0.1]);
  });

  it('cada evento solo llega a sus suscriptores', async () => {
    const states: string[] = [];
    const levels: number[] = [];
    await onEvent('pipeline:state', (state) => states.push(state));
    await onEvent('audio:level', (level) => levels.push(level));
    emitLocal('pipeline:state', 'listening');
    expect(states).toEqual(['listening']);
    expect(levels).toEqual([]);
  });
});

describe('simulación de la escucha en el navegador', () => {
  it('empezar emite "listening" y volúmenes entre 0 y 1; parar emite 0 e "idle"', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const levels: number[] = [];
    await onEvent('pipeline:state', (state) => states.push(state));
    await onEvent('audio:level', (level) => levels.push(level));

    await commands.startListening();
    expect(states).toEqual(['listening']);
    expect(await commands.isListening()).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(levels.length).toBeGreaterThan(20); // ~30 por segundo
    expect(levels.every((level) => level >= 0 && level <= 1)).toBe(true);
    expect(new Set(levels).size).toBeGreaterThan(5); // el volumen cambia: hay ondas

    await commands.stopListening();
    expect(states).toEqual(['listening', 'idle']);
    expect(levels.at(-1)).toBe(0);
    expect(await commands.isListening()).toBe(false);
  });

  it('empezar dos veces no duplica la simulación', async () => {
    vi.useFakeTimers();
    const levels: number[] = [];
    await onEvent('audio:level', (level) => levels.push(level));

    await commands.startListening();
    await commands.startListening();
    vi.advanceTimersByTime(1000);

    expect(levels.length).toBeLessThan(40); // ~30, no ~60
  });
});

describe('modelo de transcripción en el navegador (simulado)', () => {
  it('descargar avanza por pasos hasta quedar descargado, y borrar lo deja sin descargar', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const off = await onEvent('stt:model', (status) => states.push(status.state));

    expect((await commands.sttModelStatus()).state).toBe('missing');
    await commands.sttModelDownload();
    expect((await commands.sttModelStatus()).state).toBe('downloading');

    await vi.advanceTimersByTimeAsync(10_000);
    const done = await commands.sttModelStatus();
    expect(done.state).toBe('ready');
    expect(done.downloaded).toBe(done.total);
    expect(states[0]).toBe('downloading');
    expect(states.at(-1)).toBe('ready');

    await commands.sttModelRemove();
    expect((await commands.sttModelStatus()).state).toBe('missing');
    off();
  });

  it('cancelar a mitad deja el modelo sin descargar', async () => {
    vi.useFakeTimers();
    await commands.sttModelDownload();
    await vi.advanceTimersByTimeAsync(500);
    await commands.sttModelCancel();
    await vi.advanceTimersByTimeAsync(10_000);

    const status = await commands.sttModelStatus();
    expect(status.state).toBe('missing');
    expect(status.downloaded).toBe(0);
  });

  it('el idioma elegido vuelve en los ajustes y los atajos se listan', async () => {
    expect((await commands.setSttLanguage('en')).sttLanguage).toBe('en');
    const shortcuts = await commands.getShortcuts();
    expect(shortcuts.map((shortcut) => shortcut.action)).toEqual([
      'toggleQuestion',
      'toggleIsland',
    ]);
  });
});

describe('atajos, inicio con la sesión, guía y carpeta del modelo en el navegador (simulado)', () => {
  it('cambiar un atajo valida como Rust: pide un modificador y no repite el de otra acción', async () => {
    await expect(commands.setShortcut('toggleIsland', 'H')).rejects.toMatchObject({
      code: 'shortcut.needsModifier',
    });
    await expect(
      commands.setShortcut('toggleIsland', 'Shift+CommandOrControl+Space'),
    ).rejects.toMatchObject({ code: 'shortcut.duplicate' });

    const changed = await commands.setShortcut('toggleIsland', 'Alt+K');
    expect(changed.find((s) => s.action === 'toggleIsland')?.keys).toBe('Alt+K');
    expect((await commands.getShortcuts()).find((s) => s.action === 'toggleIsland')?.keys).toBe(
      'Alt+K',
    );

    const restored = await commands.resetShortcut('toggleIsland');
    expect(restored.find((s) => s.action === 'toggleIsland')?.keys).toBe(
      'CommandOrControl+Shift+H',
    );
  });

  it('el inicio con la sesión se enciende y se apaga', async () => {
    expect(await commands.getAutostart()).toBe(false);
    expect(await commands.setAutostart(true)).toBe(true);
    expect(await commands.getAutostart()).toBe(true);
    expect(await commands.setAutostart(false)).toBe(false);
  });

  it('la guía de primer arranque se marca como vista y se puede volver a activar', async () => {
    expect((await commands.getIslandSettings()).onboardingDone).toBe(false);
    expect((await commands.setOnboardingDone(true)).onboardingDone).toBe(true);
    expect((await commands.getIslandSettings()).onboardingDone).toBe(true);
    await commands.setOnboardingDone(false);
    expect((await commands.getIslandSettings()).onboardingDone).toBe(false);
  });

  it('la carpeta del modelo se cambia y se devuelve a la de la app', async () => {
    const changed = await commands.sttModelChooseDir('Elige');
    expect(changed).toMatchObject({ customDir: true, dir: '/Volumes/Externo/Orbit' });
    expect((await commands.sttModelStatus()).customDir).toBe(true);

    const reset = await commands.sttModelResetDir();
    expect(reset.customDir).toBe(false);
    expect(reset.dir).toContain('dev.orbit.island');
  });
});

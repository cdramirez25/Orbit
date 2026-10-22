import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { ShortcutInfo } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getShortcuts: vi.fn(),
    setShortcut: vi.fn(),
    resetShortcut: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const list = (island = 'CommandOrControl+Shift+H'): ShortcutInfo[] => [
  {
    action: 'toggleQuestion',
    keys: 'CommandOrControl+Shift+Space',
    defaultKeys: 'CommandOrControl+Shift+Space',
    registered: true,
  },
  {
    action: 'toggleIsland',
    keys: island,
    defaultKeys: 'CommandOrControl+Shift+H',
    registered: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useShortcutStore.setState({ shortcuts: [], error: null });
});

describe('store de atajos', () => {
  it('load guarda la lista y, si falla, la deja como estaba', async () => {
    mocked.getShortcuts.mockResolvedValue(list());
    await useShortcutStore.getState().load();
    expect(useShortcutStore.getState().shortcuts).toHaveLength(2);

    mocked.getShortcuts.mockRejectedValue(new Error('x'));
    await useShortcutStore.getState().load();
    expect(useShortcutStore.getState().shortcuts).toHaveLength(2);
  });

  it('change manda la combinación y guarda la lista que devuelve Rust', async () => {
    mocked.setShortcut.mockResolvedValue(list('Alt+K'));
    const ok = await useShortcutStore.getState().change('toggleIsland', 'Alt+K');

    expect(ok).toBe(true);
    expect(mocked.setShortcut).toHaveBeenCalledWith('toggleIsland', 'Alt+K');
    expect(useShortcutStore.getState().shortcuts[1]?.keys).toBe('Alt+K');
    expect(useShortcutStore.getState().error).toBeNull();
  });

  it('change rechazado guarda qué atajo falló y por qué, y no cambia la lista', async () => {
    useShortcutStore.setState({ shortcuts: list() });
    mocked.setShortcut.mockRejectedValue({ code: 'shortcut.unavailable', message: 'x' });

    const ok = await useShortcutStore.getState().change('toggleIsland', 'Alt+K');

    expect(ok).toBe(false);
    expect(useShortcutStore.getState().error).toEqual({
      action: 'toggleIsland',
      code: 'shortcut.unavailable',
    });
    expect(useShortcutStore.getState().shortcuts[1]?.keys).toBe('CommandOrControl+Shift+H');
  });

  it('un error sin código queda como desconocido y un intento nuevo lo borra', async () => {
    mocked.setShortcut.mockRejectedValueOnce(new Error('x'));
    await useShortcutStore.getState().change('toggleIsland', 'Alt+K');
    expect(useShortcutStore.getState().error?.code).toBe('unknown');

    mocked.setShortcut.mockResolvedValue(list('Alt+K'));
    await useShortcutStore.getState().change('toggleIsland', 'Alt+K');
    expect(useShortcutStore.getState().error).toBeNull();
  });

  it('reset pide el atajo por defecto y clearError quita el aviso', async () => {
    mocked.resetShortcut.mockResolvedValue(list());
    await useShortcutStore.getState().reset('toggleIsland');
    expect(mocked.resetShortcut).toHaveBeenCalledWith('toggleIsland');

    useShortcutStore.setState({ error: { action: 'toggleIsland', code: 'x' } });
    useShortcutStore.getState().clearError();
    expect(useShortcutStore.getState().error).toBeNull();
  });
});

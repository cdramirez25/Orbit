import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SNAPSHOT } from '@/lib/island/island.machine';
import { bindDemoToIsland, DEMO_MODULE_ID, useDemoStore } from '@/modules/demo/demo.store';
import { clipboardModule } from '@/modules/clipboard';
import { demoModule } from '@/modules/demo';
import { bindRegistryToIsland, selectActiveModule, useRegistryStore } from '@/modules/registry';
import { weatherModule } from '@/modules/weather';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getWeather: vi.fn().mockRejectedValue(new Error('offline')),
    getClipboardHistory: vi.fn().mockResolvedValue([]),
  },
}));

let unbind: Array<() => void> = [];

beforeEach(() => {
  unbind.forEach((off) => off());
  vi.useFakeTimers();
  useIslandStore.setState({ snapshot: INITIAL_SNAPSHOT, alert: null, expandedSize: 'normal' });
  useAudioStore.setState({ listening: false });
  useDemoStore.setState({ answer: null, streaming: false });
  useRegistryStore.setState({ modules: {}, activities: [], selectedId: null });

  const registry = useRegistryStore.getState();
  registry.register(demoModule);
  registry.register(weatherModule);
  registry.register(clipboardModule);
  unbind = [bindRegistryToIsland(), bindDemoToIsland()];
  registry.startActivity(weatherModule.id);
  registry.startActivity(clipboardModule.id);
});

const active = () => selectActiveModule(useRegistryStore.getState())?.id;

describe('la respuesta simulada y los módulos de siempre', () => {
  it('arranca mostrando el primer módulo residente en compacto', () => {
    expect(useIslandStore.getState().snapshot.state).toBe('compact');
    expect(active()).toBe(weatherModule.id);
  });

  it('simular ocupa la isla con la demostración', () => {
    useDemoStore.getState().streamAnswer();
    expect(useIslandStore.getState().snapshot.state).toBe('expanded');
    expect(active()).toBe(DEMO_MODULE_ID);
    vi.clearAllTimers();
  });

  it('al cerrar la tarjeta vuelven el clima, el portapapeles y la música', () => {
    useDemoStore.getState().streamAnswer();
    vi.advanceTimersByTime(10_000);

    useIslandStore.getState().send({ type: 'COLLAPSE' });

    expect(useIslandStore.getState().snapshot.state).toBe('compact');
    expect(useRegistryStore.getState().activities).not.toContain(DEMO_MODULE_ID);
    expect(active()).toBe(weatherModule.id);
  });

  it('un aviso sobre la tarjeta no la cierra', () => {
    useDemoStore.getState().streamAnswer();
    useIslandStore.getState().showAlert({ title: 'Aviso' }, 100);
    expect(useRegistryStore.getState().activities).toContain(DEMO_MODULE_ID);
    vi.advanceTimersByTime(200);
    expect(active()).toBe(DEMO_MODULE_ID);
    vi.clearAllTimers();
  });

  it('si se está escuchando, la demostración (las ondas) se queda', () => {
    useDemoStore.getState().streamAnswer();
    useAudioStore.setState({ listening: true });
    useIslandStore.getState().send({ type: 'COLLAPSE' });
    expect(useRegistryStore.getState().activities).toContain(DEMO_MODULE_ID);
    vi.clearAllTimers();
  });

  it('se puede volver a simular después de cerrar', () => {
    useDemoStore.getState().streamAnswer();
    vi.advanceTimersByTime(10_000);
    useIslandStore.getState().send({ type: 'COLLAPSE' });

    useDemoStore.getState().streamAnswer();
    expect(active()).toBe(DEMO_MODULE_ID);
    vi.advanceTimersByTime(10_000);
    useIslandStore.getState().send({ type: 'COLLAPSE' });
    expect(active()).toBe(weatherModule.id);
  });
});

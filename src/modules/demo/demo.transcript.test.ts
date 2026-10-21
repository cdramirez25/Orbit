import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SNAPSHOT } from '@/lib/island/island.machine';
import {
  bindListeningToIsland,
  bindTranscriptToIsland,
  useDemoStore,
} from '@/modules/demo/demo.store';
import { demoModule } from '@/modules/demo';
import { bindRegistryToIsland, useRegistryStore } from '@/modules/registry';
import { weatherModule } from '@/modules/weather';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';
import { useTranscriptStore } from '@/stores/transcript.store';

vi.mock('@/ipc/commands', () => ({
  commands: { getWeather: vi.fn().mockRejectedValue(new Error('offline')) },
}));

let unbind: Array<() => void> = [];

beforeEach(() => {
  unbind.forEach((off) => off());
  vi.useFakeTimers();
  useIslandStore.setState({ snapshot: INITIAL_SNAPSHOT, alert: null, expandedSize: 'normal' });
  useAudioStore.setState({ listening: false });
  useDemoStore.setState({ answer: null, streaming: false });
  useTranscriptStore.setState({ lines: [], partial: '' });
  useRegistryStore.setState({ modules: {}, activities: [], selectedId: null });

  const registry = useRegistryStore.getState();
  registry.register(demoModule);
  registry.register(weatherModule);
  unbind = [bindRegistryToIsland(), bindListeningToIsland(), bindTranscriptToIsland()];
  registry.startActivity(weatherModule.id);
});

const island = () => useIslandStore.getState().snapshot.state;

describe('la transcripción y la isla', () => {
  it('empezar a escuchar vacía la transcripción anterior y la respuesta simulada', () => {
    useTranscriptStore.setState({ lines: [{ id: 1, text: 'vieja' }], partial: 'resto' });
    useDemoStore.setState({ answer: 'Canberra', streaming: false });

    useAudioStore.setState({ listening: true });

    expect(useTranscriptStore.getState().lines).toEqual([]);
    expect(useTranscriptStore.getState().partial).toBe('');
    expect(useDemoStore.getState().answer).toBeNull();
  });

  it('la primera palabra abre la tarjeta', () => {
    useAudioStore.setState({ listening: true });
    expect(island()).toBe('compact');

    useTranscriptStore.setState({ partial: 'hola' });

    expect(island()).toBe('expanded');
  });

  it('si el usuario la cierra, las frases siguientes no la vuelven a abrir', () => {
    useAudioStore.setState({ listening: true });
    useTranscriptStore.setState({ partial: 'hola' });
    useIslandStore.getState().send({ type: 'COLLAPSE' });
    expect(island()).toBe('compact');

    useTranscriptStore.setState({ partial: 'hola mundo' });
    useTranscriptStore.setState({ lines: [{ id: 1, text: 'hola mundo' }], partial: '' });

    expect(island()).toBe('compact');
  });

  it('en la siguiente escucha vuelve a abrirse con la primera palabra', () => {
    useAudioStore.setState({ listening: true });
    useTranscriptStore.setState({ partial: 'hola' });
    useIslandStore.getState().send({ type: 'COLLAPSE' });
    useAudioStore.setState({ listening: false });
    useAudioStore.setState({ listening: true });
    expect(island()).toBe('compact');

    useTranscriptStore.setState({ partial: 'otra vez' });

    expect(island()).toBe('expanded');
  });

  it('sin escuchar, un texto suelto no mueve la isla', () => {
    useTranscriptStore.setState({ partial: 'hola' });
    expect(island()).toBe('compact');
  });
});

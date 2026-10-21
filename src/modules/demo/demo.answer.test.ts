import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SNAPSHOT } from '@/lib/island/island.machine';
import { bindAnswerToIsland, bindListeningToIsland, useDemoStore } from '@/modules/demo/demo.store';
import { demoModule } from '@/modules/demo';
import { bindRegistryToIsland, useRegistryStore } from '@/modules/registry';
import { weatherModule } from '@/modules/weather';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';

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
  useAnswerStore.getState().clear();
  useRegistryStore.setState({ modules: {}, activities: [], selectedId: null });

  const registry = useRegistryStore.getState();
  registry.register(demoModule);
  registry.register(weatherModule);
  unbind = [bindRegistryToIsland(), bindListeningToIsland(), bindAnswerToIsland()];
  registry.startActivity(weatherModule.id);
});

const island = () => useIslandStore.getState().snapshot.state;

describe('la respuesta de la IA y la isla', () => {
  it('una pregunta nueva abre la tarjeta para que se vea la respuesta', () => {
    useAudioStore.setState({ listening: true });
    expect(island()).toBe('compact');

    useAnswerStore.setState({ question: '¿Capital de Australia?' });

    expect(island()).toBe('expanded');
  });

  it('si el usuario la cierra, la siguiente pregunta la vuelve a abrir', () => {
    useAudioStore.setState({ listening: true });
    useAnswerStore.setState({ question: 'Primera' });
    useIslandStore.getState().send({ type: 'COLLAPSE' });
    expect(island()).toBe('compact');

    // Los trozos de la misma respuesta no la reabren…
    useAnswerStore.setState({ answer: 'Canberra' });
    expect(island()).toBe('compact');

    // …pero otra pregunta sí.
    useAnswerStore.setState({ question: 'Segunda', answer: '' });
    expect(island()).toBe('expanded');
  });

  it('empezar a escuchar de nuevo borra la respuesta de antes', () => {
    useAnswerStore.setState({ question: 'Vieja', answer: 'Respuesta vieja' });
    useAudioStore.setState({ listening: true });

    expect(useAnswerStore.getState().question).toBeNull();
    expect(useAnswerStore.getState().answer).toBe('');
  });

  it('el estado vacío de la respuesta no mueve la isla', () => {
    useAnswerStore.getState().clear();
    expect(island()).toBe('compact');
  });

  it('una pregunta escrita en Ajustes abre la isla aunque esté en reposo u oculta', () => {
    useIslandStore.getState().goTo('idle');
    expect(island()).toBe('idle');
    useAnswerStore.setState({ question: 'Desde reposo' });
    expect(island()).toBe('expanded');

    useIslandStore.getState().goTo('hidden');
    expect(island()).toBe('hidden');
    useAnswerStore.setState({ question: 'Desde oculta' });
    expect(island()).toBe('expanded');
  });

  it('no pisa un aviso que se está mostrando', () => {
    useIslandStore.getState().showAlert({ title: 'Aviso' }, 60_000);
    expect(island()).toBe('alert');

    useAnswerStore.setState({ question: 'Mientras hay aviso' });

    expect(island()).toBe('alert');
    vi.clearAllTimers();
  });
});

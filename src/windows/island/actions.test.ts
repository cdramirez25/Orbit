import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROMPTER_MODULE_ID } from '@/modules/prompter/id';
import { useRegistryStore } from '@/modules/registry';
import { useIslandStore } from '@/stores/island.store';
import { useQuestionStore } from '@/stores/question.store';
import { applyUiAction } from '@/windows/island/actions';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function questionStub(overrides: Partial<ReturnType<typeof useQuestionStore.getState>>) {
  const start = vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn().mockResolvedValue(undefined);
  useQuestionStore.setState({
    recording: false,
    busy: false,
    errorCode: null,
    start,
    finish,
    ...overrides,
  });
  return { start, finish };
}

beforeEach(() => {
  useRegistryStore.setState({ modules: {}, activities: [], selectedId: null });
  useIslandStore.getState().goTo('idle');
});

describe('mostrar u ocultar la isla', () => {
  it('visible: la oculta', () => {
    useIslandStore.getState().goTo('compact');
    applyUiAction('toggleIsland');
    expect(useIslandStore.getState().snapshot.state).toBe('hidden');
  });

  it('oculta: vuelve a la forma compacta', () => {
    useIslandStore.getState().goTo('hidden');
    applyUiAction('toggleIsland');
    expect(useIslandStore.getState().snapshot.state).toBe('compact');
  });

  it('dos veces seguidas la deja como estaba', () => {
    useIslandStore.getState().goTo('compact');
    applyUiAction('toggleIsland');
    applyUiAction('toggleIsland');
    expect(useIslandStore.getState().snapshot.state).toBe('compact');
  });
});

describe('grabar audio con el atajo', () => {
  it('sin grabar: empieza a grabar', async () => {
    const { start, finish } = questionStub({ recording: false });
    applyUiAction('toggleQuestion');
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  it('grabando: termina la pregunta y la envía', async () => {
    const { start, finish } = questionStub({ recording: true });
    applyUiAction('toggleQuestion');
    await flush();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('si falla, abre la tarjeta de IA para que se vea el motivo', async () => {
    useIslandStore.getState().goTo('compact');
    questionStub({
      recording: false,
      start: vi.fn().mockImplementation(() => {
        useQuestionStore.setState({ errorCode: 'audio.permissionDenied' });
        return Promise.resolve();
      }),
    });

    applyUiAction('toggleQuestion');
    await flush();

    expect(useIslandStore.getState().snapshot.state).toBe('expanded');
    expect(useRegistryStore.getState().selectedId).toBe(PROMPTER_MODULE_ID);
  });

  it('si sale bien, no abre la tarjeta', async () => {
    useIslandStore.getState().goTo('compact');
    questionStub({ recording: false });
    applyUiAction('toggleQuestion');
    await flush();
    expect(useIslandStore.getState().snapshot.state).toBe('compact');
  });
});

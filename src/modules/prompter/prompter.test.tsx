import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { Compact } from '@/modules/prompter/Compact';
import { Expanded } from '@/modules/prompter/Expanded';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useQuestionStore } from '@/stores/question.store';
import { useSessionStore } from '@/stores/session.store';
import { useTranscriptStore } from '@/stores/transcript.store';
import type { Session, SessionsState } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    questionStart: vi.fn(),
    questionFinish: vi.fn(),
    questionCancel: vi.fn(),
    questionIsRecording: vi.fn(),
    sessionGetState: vi.fn(),
    sessionCreate: vi.fn(),
    sessionSetActive: vi.fn(),
    sessionMessages: vi.fn(),
    aiAsk: vi.fn(),
    setIslandKeyboard: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const session = (id: number, name: string): Session => ({
  id,
  name,
  prompt: '',
  autoAnswer: false,
  provider: null,
  createdAt: 0,
});

const sessionsState = (active: number | null, ...names: string[]): SessionsState => ({
  active,
  sessions: names.map((name, index) => session(index + 1, name)),
});

const click = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAudioStore.setState({ listening: false, errorCode: null });
  useTranscriptStore.setState({ lines: [], partial: '' });
  useAnswerStore.getState().clear();
  useQuestionStore.setState({ recording: false, busy: false, errorCode: null });
  useSessionStore.setState({ state: null, messages: [], errorCode: null });
  mocked.questionStart.mockResolvedValue();
  mocked.questionFinish.mockResolvedValue('¿Capital de Australia?');
  mocked.questionCancel.mockResolvedValue();
  mocked.sessionMessages.mockResolvedValue([]);
  mocked.aiAsk.mockResolvedValue();
  mocked.setIslandKeyboard.mockResolvedValue();
});

describe('botón de grabar la pregunta', () => {
  it('antes de grabar ofrece "Grabar audio"', () => {
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Grabar audio' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Terminar y responder' })).not.toBeInTheDocument();
  });

  it('al grabar empieza a escuchar y el botón pasa a "Terminar y responder"', async () => {
    render(<Expanded />);
    await click('Grabar audio');

    expect(mocked.questionStart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Terminar y responder' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Grabando…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('al terminar se le hace la pregunta a la IA y vuelve el botón de grabar', async () => {
    render(<Expanded />);
    await click('Grabar audio');
    await click('Terminar y responder');

    expect(mocked.questionFinish).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Grabar audio' })).toBeInTheDocument();
  });

  it('cancelar vuelve atrás sin responder', async () => {
    render(<Expanded />);
    await click('Grabar audio');
    await click('Cancelar');

    expect(mocked.questionCancel).toHaveBeenCalledTimes(1);
    expect(mocked.questionFinish).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Grabar audio' })).toBeInTheDocument();
  });

  it('si no se escuchó nada lo dice', async () => {
    mocked.questionFinish.mockRejectedValue({ code: 'ai.noQuestion', message: 'x' });
    render(<Expanded />);
    await click('Grabar audio');
    await click('Terminar y responder');

    expect(screen.getByRole('alert')).toHaveTextContent('No se escuchó nada');
    expect(screen.getByRole('button', { name: 'Grabar audio' })).toBeInTheDocument();
  });

  it('si falta el permiso de audio al empezar lo dice y no queda "grabando"', async () => {
    mocked.questionStart.mockRejectedValue({ code: 'audio.permissionDenied', message: 'x' });
    render(<Expanded />);
    await click('Grabar audio');

    expect(screen.getByRole('alert')).toHaveTextContent('Falta el permiso para capturar el audio');
    expect(screen.getByRole('button', { name: 'Grabar audio' })).toBeInTheDocument();
    expect(useQuestionStore.getState().recording).toBe(false);
  });

  it('no se puede empezar dos veces ni terminar sin haber empezado', async () => {
    await useQuestionStore.getState().finish();
    expect(mocked.questionFinish).not.toHaveBeenCalled();

    await useQuestionStore.getState().start();
    await useQuestionStore.getState().start();
    expect(mocked.questionStart).toHaveBeenCalledTimes(1);
  });

  it('al abrirse pregunta a Rust si ya se estaba grabando', async () => {
    mocked.questionIsRecording.mockResolvedValue(true);
    await useQuestionStore.getState().sync();
    expect(useQuestionStore.getState().recording).toBe(true);

    mocked.questionIsRecording.mockRejectedValue(new Error('x'));
    await useQuestionStore.getState().sync();
    expect(useQuestionStore.getState().recording).toBe(true); // se queda como estaba
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Record audio' })).toBeInTheDocument();
  });
});

describe('escribir la pregunta en la isla', () => {
  const field = () => screen.getByLabelText('Escribir una pregunta');
  const type = (value: string) => fireEvent.change(field(), { target: { value } });

  it('Enter manda la pregunta a la IA, vacía el campo y no deja el teclado enganchado', async () => {
    render(<Expanded />);
    type('  ¿Cuál es la capital de Australia?  ');
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    await act(async () => {});

    expect(mocked.aiAsk).toHaveBeenCalledTimes(1);
    expect(mocked.aiAsk).toHaveBeenCalledWith('¿Cuál es la capital de Australia?');
    expect(field()).toHaveValue('');
  });

  it('el botón de enviar hace lo mismo y está desactivado sin texto', async () => {
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Enviar pregunta' })).toBeDisabled();

    type('Hola?');
    await click('Enviar pregunta');
    expect(mocked.aiAsk).toHaveBeenCalledWith('Hola?');
  });

  it('una pregunta en blanco no se manda', async () => {
    render(<Expanded />);
    type('    ');
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    await act(async () => {});
    expect(mocked.aiAsk).not.toHaveBeenCalled();
  });

  it('mientras se graba una pregunta no se puede escribir otra', async () => {
    render(<Expanded />);
    await click('Grabar audio');
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar pregunta' })).toBeDisabled();
  });

  it('la isla recibe el teclado al usar el campo y lo devuelve al salir', async () => {
    render(<Expanded />);

    fireEvent.pointerDown(field());
    await act(async () => {});
    expect(mocked.setIslandKeyboard).toHaveBeenLastCalledWith(true);

    fireEvent.blur(field());
    await act(async () => {});
    expect(mocked.setIslandKeyboard).toHaveBeenLastCalledWith(false);
  });

  it('si la tarjeta se cierra con el campo en uso, el teclado se devuelve', async () => {
    const { unmount } = render(<Expanded />);
    fireEvent.focus(field());
    await act(async () => {});

    unmount();
    await act(async () => {});
    expect(mocked.setIslandKeyboard).toHaveBeenLastCalledWith(false);
  });

  it('si no se puede cambiar el teclado, la tarjeta sigue funcionando', async () => {
    mocked.setIslandKeyboard.mockRejectedValue(new Error('x'));
    render(<Expanded />);
    fireEvent.focus(field());
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Grabar audio' })).toBeInTheDocument();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByLabelText('Type a question')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeInTheDocument();
  });
});

describe('sesión en la tarjeta de IA', () => {
  it('muestra la sesión activa, o dice que no hay ninguna', () => {
    const { unmount } = render(<Expanded />);
    expect(screen.getByText('Sin sesión')).toBeInTheDocument();
    unmount();

    useSessionStore.setState({ state: sessionsState(2, 'Trivia', 'Reunión') });
    render(<Expanded />);
    expect(screen.getByText('Reunión')).toBeInTheDocument();
  });

  it('las flechas cambian de sesión dando la vuelta', async () => {
    mocked.sessionSetActive.mockImplementation((id) =>
      Promise.resolve(sessionsState(id, 'A', 'B', 'C')),
    );
    useSessionStore.setState({ state: sessionsState(1, 'A', 'B', 'C') });
    render(<Expanded />);

    await click('Sesión siguiente');
    expect(mocked.sessionSetActive).toHaveBeenLastCalledWith(2);

    await click('Sesión anterior');
    await click('Sesión anterior');
    expect(mocked.sessionSetActive).toHaveBeenLastCalledWith(3); // de la primera, hacia atrás: la última
  });

  it('con una sola sesión las flechas están desactivadas', () => {
    useSessionStore.setState({ state: sessionsState(1, 'Única') });
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Sesión anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sesión siguiente' })).toBeDisabled();
  });

  it('"+" crea una sesión nueva con un nombre por defecto', async () => {
    mocked.sessionCreate.mockResolvedValue(sessionsState(3, 'A', 'B', 'Sesión 3'));
    useSessionStore.setState({ state: sessionsState(2, 'A', 'B') });
    render(<Expanded />);

    await click('Nueva sesión');

    expect(mocked.sessionCreate).toHaveBeenCalledWith('Sesión 3', '');
  });
});

describe('pastilla de IA', () => {
  it('se enciende mientras se escucha y apaga sin escuchar', () => {
    const { container, rerender } = render(<Compact />);
    expect(container.querySelector('svg')).not.toHaveClass('text-accent');

    act(() => useAudioStore.setState({ listening: true }));
    rerender(<Compact />);
    expect(container.querySelector('svg')).toHaveClass('text-accent');
  });
});

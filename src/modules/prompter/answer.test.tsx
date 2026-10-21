import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { Expanded } from '@/modules/prompter/Expanded';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useQuestionStore } from '@/stores/question.store';
import { useSessionStore } from '@/stores/session.store';
import { useTranscriptStore } from '@/stores/transcript.store';

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAudioStore.setState({ listening: false, errorCode: null });
  useTranscriptStore.setState({ lines: [{ id: 1, text: 'Una frase.' }], partial: '' });
  useAnswerStore.getState().clear();
  useQuestionStore.setState({ recording: false, busy: false, errorCode: null });
  useSessionStore.setState({ state: null, messages: [], errorCode: null });
});

describe('tarjeta de IA: la respuesta', () => {
  it('muestra la pregunta y la respuesta que va llegando', () => {
    useAnswerStore.setState({
      question: '¿Cuál es la capital de Australia?',
      answer: 'Canberra.',
      streaming: true,
    });
    render(<Expanded />);

    expect(screen.getByText('Pregunta')).toBeInTheDocument();
    expect(screen.getByText('¿Cuál es la capital de Australia?')).toBeInTheDocument();
    expect(screen.getByText('Canberra.')).toBeInTheDocument();
    expect(screen.queryByText('Transcripción en vivo')).not.toBeInTheDocument();
  });

  it('las negritas de la IA se ven como negritas, sin asteriscos', () => {
    useAnswerStore.setState({
      question: '¿Capital de Australia?',
      answer: 'La capital es **Canberra**, no *Sídney*.\n\n- **Fundada:** 1913',
      streaming: false,
    });
    const { container } = render(<Expanded />);

    expect(screen.getByText('Canberra').tagName).toBe('STRONG');
    expect(screen.getByText('Sídney').tagName).toBe('EM');
    expect(container.querySelector('li')?.textContent).toBe('Fundada: 1913');
    expect(container.textContent).not.toContain('**');
  });

  it('mientras la respuesta llega, una negrita sin cerrar ya se ve sin asteriscos', () => {
    useAnswerStore.setState({ question: 'P', answer: 'La capital es **Can', streaming: true });
    const { container } = render(<Expanded />);
    expect(container.textContent).toContain('La capital es Can');
    expect(container.textContent).not.toContain('*');
  });

  it('si la IA falla dice por qué en vez de quedarse esperando', () => {
    useAnswerStore.setState({
      question: '¿Cuál es la capital de Australia?',
      answer: '',
      streaming: false,
      errorCode: 'ai.unauthorized',
    });
    render(<Expanded />);

    expect(screen.getByRole('alert')).toHaveTextContent('La clave no es válida o no tiene permiso');
  });

  it('sin proveedor elegido avisa de que hay que elegirlo', () => {
    useAnswerStore.setState({ question: '¿Qué hora es en Tokio?', errorCode: 'ai.notConfigured' });
    render(<Expanded />);
    expect(screen.getByRole('alert')).toHaveTextContent('Elige un proveedor de IA en Ajustes');
  });

  it('mientras se graba una pregunta nueva se ve lo que se oye, no la respuesta anterior', () => {
    useAnswerStore.setState({ question: 'Vieja', answer: 'Respuesta vieja' });
    useQuestionStore.setState({ recording: true });
    useAudioStore.setState({ listening: true });
    render(<Expanded />);

    expect(screen.getByText('Transcripción en vivo')).toBeInTheDocument();
    expect(screen.queryByText('Respuesta vieja')).not.toBeInTheDocument();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    useAnswerStore.setState({ question: 'What?', errorCode: 'ai.network' });
    render(<Expanded />);

    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not connect');
  });
});

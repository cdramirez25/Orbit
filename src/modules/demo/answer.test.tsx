import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { useDemoStore } from '@/modules/demo/demo.store';
import { Expanded } from '@/modules/demo/Expanded';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useTranscriptStore } from '@/stores/transcript.store';

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useDemoStore.setState({ answer: null, streaming: false });
  useAudioStore.setState({ listening: true, errorCode: null });
  useTranscriptStore.setState({ lines: [{ id: 1, text: 'Una frase.' }], partial: '' });
  useAnswerStore.getState().clear();
});

describe('tarjeta con la respuesta de la IA', () => {
  it('muestra la pregunta detectada y la respuesta que va llegando', () => {
    useAnswerStore.setState({
      question: '¿Cuál es la capital de Australia?',
      answer: 'Canberra.',
      streaming: true,
    });
    render(<Expanded />);

    expect(screen.getByText('Pregunta detectada')).toBeInTheDocument();
    expect(screen.getByText('¿Cuál es la capital de Australia?')).toBeInTheDocument();
    expect(screen.getByText('Canberra.')).toBeInTheDocument();
    expect(screen.queryByText('Transcripción en vivo')).not.toBeInTheDocument();
  });

  it('sin pregunta se sigue viendo la transcripción', () => {
    render(<Expanded />);
    expect(screen.getByText('Transcripción en vivo')).toBeInTheDocument();
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

  it('la respuesta simulada del botón tiene prioridad', () => {
    useAnswerStore.setState({ question: '¿Algo?', answer: 'Respuesta real', streaming: false });
    useDemoStore.setState({ answer: 'Canberra (simulada)', streaming: false });
    render(<Expanded />);

    expect(screen.getByText('Canberra (simulada)')).toBeInTheDocument();
    expect(screen.queryByText('Respuesta real')).not.toBeInTheDocument();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    useAnswerStore.setState({ question: 'What?', errorCode: 'ai.network' });
    render(<Expanded />);

    expect(screen.getByText('Question detected')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not connect');
  });
});

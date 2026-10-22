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
  useTranscriptStore.setState({ lines: [], partial: '' });
  useAnswerStore.getState().clear();
  useQuestionStore.setState({ recording: false, busy: false, errorCode: null });
  useSessionStore.setState({ state: null, messages: [], errorCode: null });
});

describe('tarjeta de IA: lo que se oye', () => {
  it('sin nada que mostrar explica cómo se usa', () => {
    render(<Expanded />);
    expect(screen.getByText(/Pulsa Grabar audio/)).toBeInTheDocument();
    expect(screen.queryByText('Transcripción en vivo')).not.toBeInTheDocument();
  });

  it('al escuchar, sin texto todavía, avisa de que espera voz', () => {
    useAudioStore.setState({ listening: true });
    render(<Expanded />);
    expect(screen.getByText('Transcripción en vivo')).toBeInTheDocument();
    expect(screen.getByText('Esperando voz…')).toBeInTheDocument();
  });

  it('muestra las frases terminadas y la que está en curso', () => {
    useAudioStore.setState({ listening: true });
    useTranscriptStore.setState({
      lines: [{ id: 1, text: 'Hola a todos.' }],
      partial: 'La capital de',
    });
    render(<Expanded />);

    expect(screen.getByText('Hola a todos.')).toBeInTheDocument();
    expect(screen.getByText('La capital de')).toBeInTheDocument();
    expect(screen.queryByText('Esperando voz…')).not.toBeInTheDocument();
  });

  it('al parar de escuchar el texto se queda para poder leerlo', () => {
    useTranscriptStore.setState({
      lines: [{ id: 1, text: 'Lo último que se dijo.' }],
      partial: '',
    });
    render(<Expanded />);
    expect(screen.getByText('Lo último que se dijo.')).toBeInTheDocument();
  });

  it('si falta el modelo lo dice en vez de esperar para siempre', () => {
    useAudioStore.setState({ listening: true, errorCode: 'stt.modelMissing' });
    render(<Expanded />);

    expect(
      screen.getByText('Falta el modelo de transcripción. Descárgalo en Ajustes, Audio.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Esperando voz…')).not.toBeInTheDocument();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    useAudioStore.setState({ listening: true });
    render(<Expanded />);
    expect(screen.getByText('Live transcript')).toBeInTheDocument();
    expect(screen.getByText('Waiting for speech…')).toBeInTheDocument();
  });
});

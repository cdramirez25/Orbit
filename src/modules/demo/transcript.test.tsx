import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { useDemoStore } from '@/modules/demo/demo.store';
import { Expanded } from '@/modules/demo/Expanded';
import { useAudioStore } from '@/stores/audio.store';
import { useTranscriptStore } from '@/stores/transcript.store';

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useDemoStore.setState({ answer: null, streaming: false });
  useAudioStore.setState({ listening: false, errorCode: null });
  useTranscriptStore.setState({ lines: [], partial: '' });
});

describe('tarjeta del módulo de demo', () => {
  it('sin escuchar y sin texto muestra la pregunta de ejemplo', () => {
    render(<Expanded />);
    expect(screen.getByText('Pregunta detectada')).toBeInTheDocument();
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

  it('la respuesta simulada tiene prioridad sobre la transcripción', () => {
    useAudioStore.setState({ listening: true });
    useTranscriptStore.setState({ lines: [{ id: 1, text: 'Hola.' }], partial: '' });
    useDemoStore.setState({ answer: 'Canberra', streaming: false });
    render(<Expanded />);

    expect(screen.getByText('Canberra')).toBeInTheDocument();
    expect(screen.queryByText('Hola.')).not.toBeInTheDocument();
  });

  it('si falta el modelo lo dice en vez de esperar para siempre', () => {
    useAudioStore.setState({ listening: true, errorCode: 'stt.modelMissing' });
    render(<Expanded />);

    expect(screen.getByText('Falta el modelo de transcripción')).toBeInTheDocument();
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

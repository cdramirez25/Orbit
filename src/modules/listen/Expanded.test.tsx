import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { Compact } from '@/modules/listen/Compact';
import { Expanded } from '@/modules/listen/Expanded';
import { listenModule } from '@/modules/listen';
import { useAudioStore } from '@/stores/audio.store';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useTranscriptStore } from '@/stores/transcript.store';
import { modelStatus } from '@/test/factories';

vi.mock('@/ipc/commands', () => ({
  commands: {
    startListening: vi.fn(),
    stopListening: vi.fn(),
    getAudioPermission: vi.fn(),
    requestAudioPermission: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
  useAudioStore.setState({ listening: false, errorCode: null, permission: 'granted' });
  useTranscriptStore.setState({ lines: [], partial: '' });
  useModelStore.setState({ status: modelStatus({ active: 'medium' }) });
  useSettingsStore.setState({ sttLanguage: 'auto' });
  mocked.startListening.mockResolvedValue();
  mocked.stopListening.mockResolvedValue();
});

describe('tarjeta de transcripción', () => {
  it('detenida: explica cómo probar y no enseña nada de IA', () => {
    render(<Expanded />);
    expect(screen.getByRole('status')).toHaveTextContent('Detenida');
    expect(screen.getByText(/Pulsa Escuchar y habla o reproduce algo/)).toBeInTheDocument();
    expect(screen.getByText(/prueba otro en Ajustes, Audio/)).toBeInTheDocument();
    expect(screen.queryByText('Grabar audio')).not.toBeInTheDocument();
  });

  it('muestra el modelo y el idioma que se están usando', () => {
    useSettingsStore.setState({ sttLanguage: 'es' });
    render(<Expanded />);
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Español')).toBeInTheDocument();
  });

  it('el idioma automático se llama Automático', () => {
    render(<Expanded />);
    expect(screen.getByText('Automático')).toBeInTheDocument();
  });

  it('Escuchar empieza a escuchar y el botón pasa a Detener', async () => {
    const { rerender } = render(<Expanded />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    });
    expect(mocked.startListening).toHaveBeenCalledTimes(1);

    rerender(<Expanded />);
    expect(screen.getByRole('status')).toHaveTextContent('Escuchando');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Detener' }));
    });
    expect(mocked.stopListening).toHaveBeenCalledTimes(1);
  });

  it('mientras escucha y aún no hay texto, espera la voz', () => {
    useAudioStore.setState({ listening: true });
    render(<Expanded />);
    expect(screen.getByText('Esperando voz…')).toBeInTheDocument();
  });

  it('va mostrando las frases terminadas y la que está en curso', () => {
    useAudioStore.setState({ listening: true });
    useTranscriptStore.setState({
      lines: [
        { id: 1, text: 'Hola, ¿cómo estás?' },
        { id: 2, text: 'Quiero saber la capital de Francia.' },
      ],
      partial: 'y qué tiempo hace',
    });
    render(<Expanded />);

    expect(screen.getByText('Hola, ¿cómo estás?')).toBeInTheDocument();
    expect(screen.getByText('Quiero saber la capital de Francia.')).toBeInTheDocument();
    expect(screen.getByText('y qué tiempo hace')).toBeInTheDocument();
    expect(screen.queryByText('Esperando voz…')).not.toBeInTheDocument();
  });

  it('Limpiar borra el texto y está desactivado si no hay nada', () => {
    const { rerender } = render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Limpiar el texto' })).toBeDisabled();

    act(() => useTranscriptStore.setState({ lines: [{ id: 1, text: 'hola' }] }));
    rerender(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar el texto' }));

    expect(useTranscriptStore.getState().lines).toEqual([]);
  });

  it('si falta el modelo lo dice', () => {
    useAudioStore.setState({ errorCode: 'stt.modelMissing' });
    render(<Expanded />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falta el modelo de transcripción');
  });

  it('si falta el permiso, lo explica aquí también', () => {
    useAudioStore.setState({ errorCode: 'audio.permissionDenied' });
    render(<Expanded />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Falta el permiso de Grabación de pantalla',
    );
  });

  it('en inglés, los textos salen en inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Stopped');
    expect(screen.getByText('Automatic')).toBeInTheDocument();
  });
});

describe('pastilla de transcripción', () => {
  it('se anuncia como detenida o escuchando', () => {
    const { rerender } = render(<Compact />);
    expect(screen.getByText('Detenida')).toBeInTheDocument();

    act(() => useAudioStore.setState({ listening: true }));
    rerender(<Compact />);
    expect(screen.getByText('Escuchando')).toBeInTheDocument();
  });

  it('es un módulo residente de la isla cuyo scroll sigue al final', () => {
    expect(listenModule.ambient).toBe(true);
    expect(listenModule.followEnd).toBe(true);
    expect(listenModule.labelKey).toBe('listen.module');
  });
});

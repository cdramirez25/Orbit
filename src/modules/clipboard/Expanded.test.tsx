import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useLocaleStore } from '@/i18n/locale.store';
import { Compact } from '@/modules/clipboard/Compact';
import { Expanded } from '@/modules/clipboard/Expanded';
import { useClipboardStore } from '@/stores/clipboard.store';
import type { ClipboardEntry } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getClipboardHistory: vi.fn(),
    copyClipboardEntry: vi.fn().mockResolvedValue(undefined),
    deleteClipboardEntry: vi.fn().mockResolvedValue(undefined),
    clearClipboardHistory: vi.fn().mockResolvedValue(undefined),
    clipboardAi: vi.fn(),
    copyClipboardText: vi.fn().mockResolvedValue(undefined),
  },
}));

const mocked = vi.mocked(commands);

const text: ClipboardEntry = {
  id: 2,
  kind: 'text',
  copiedAtMs: Date.now(),
  text: 'hola mundo',
  charCount: 10,
  width: null,
  height: null,
  thumbnail: null,
};

const image: ClipboardEntry = {
  id: 1,
  kind: 'image',
  copiedAtMs: Date.now(),
  text: null,
  charCount: null,
  width: 1280,
  height: 720,
  thumbnail: 'data:image/png;base64,AAAA',
};

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
  useClipboardStore.setState({
    entries: [text, image],
    copiedId: null,
    aiResult: null,
    aiResultCopied: false,
  });
});

describe('historial del portapapeles', () => {
  it('lista el texto y las imágenes con su detalle', () => {
    render(<Expanded />);
    expect(screen.getByText('hola mundo')).toBeInTheDocument();
    expect(screen.getByText(/10 caracteres/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Imagen copiada' })).toHaveAttribute(
      'src',
      image.thumbnail,
    );
    expect(screen.getByText(/1280 × 720/)).toBeInTheDocument();
  });

  it('avisa que el historial es solo de la sesión', () => {
    render(<Expanded />);
    expect(screen.getByText(/se borra al cerrar Orbit/)).toBeInTheDocument();
  });

  it('al pulsar un elemento lo vuelve a copiar y muestra "Copiado"', async () => {
    render(<Expanded />);
    fireEvent.click(screen.getByText('hola mundo'));
    expect(mocked.copyClipboardEntry).toHaveBeenCalledWith(2);
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  it('el icono de borrar quita solo ese elemento', async () => {
    render(<Expanded />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Borrar este elemento' })[0]!);
    await waitFor(() => expect(mocked.deleteClipboardEntry).toHaveBeenCalledWith(2));
    expect(screen.queryByText('hola mundo')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Imagen copiada' })).toBeInTheDocument();
  });

  it('"Borrar todo" vacía el historial y muestra el estado vacío', async () => {
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Borrar todo el historial' }));
    await waitFor(() => expect(mocked.clearClipboardHistory).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Aún no has copiado nada en esta sesión.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borrar todo el historial' })).toBeNull();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Clear the whole history' })).toBeInTheDocument();
    expect(screen.getByText(/10 characters/)).toBeInTheDocument();
  });

  describe('acciones de IA sobre lo copiado', () => {
    it('un texto ofrece traducir, resumir y explicar; una imagen no', () => {
      render(<Expanded />);
      expect(screen.getAllByRole('button', { name: 'Traducir' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Resumir' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Explicar' })).toHaveLength(1);
    });

    it('traducir pide a la IA ese texto en el idioma de la interfaz y muestra el resultado', async () => {
      let finish: (value: string) => void = () => {};
      mocked.clipboardAi.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
      render(<Expanded />);

      fireEvent.click(screen.getByRole('button', { name: 'Traducir' }));
      expect(mocked.clipboardAi).toHaveBeenCalledWith(2, 'translate', 'es');
      expect(screen.getByText('Traducción')).toBeInTheDocument();
      expect(screen.getByText('Pensando…')).toBeInTheDocument();

      finish('hello world');
      expect(await screen.findByText('hello world')).toBeInTheDocument();
      expect(screen.queryByText('Pensando…')).not.toBeInTheDocument();
    });

    it('el resultado se copia con un botón y se cierra con otro', async () => {
      mocked.clipboardAi.mockResolvedValue('Resumen corto');
      render(<Expanded />);
      fireEvent.click(screen.getByRole('button', { name: 'Resumir' }));
      await screen.findByText('Resumen corto');

      fireEvent.click(screen.getByRole('button', { name: 'Copiar resultado' }));
      await waitFor(() => expect(mocked.copyClipboardText).toHaveBeenCalledWith('Resumen corto'));

      fireEvent.click(screen.getByRole('button', { name: 'Cerrar resultado' }));
      expect(screen.queryByText('Resumen corto')).not.toBeInTheDocument();
    });

    it('si no hay una IA elegida o falla, lo explica con el mensaje de la IA', async () => {
      mocked.clipboardAi.mockRejectedValue({ code: 'ai.notConfigured', message: 'x' });
      render(<Expanded />);
      fireEvent.click(screen.getByRole('button', { name: 'Explicar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Elige un proveedor de IA en Ajustes',
      );
    });

    it('en inglés, los botones y el resultado salen en inglés y se pide en inglés', async () => {
      useLocaleStore.setState({ locale: 'en' });
      mocked.clipboardAi.mockResolvedValue('Hola mundo');
      render(<Expanded />);

      fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
      expect(mocked.clipboardAi).toHaveBeenCalledWith(2, 'translate', 'en');
      expect(await screen.findByText('Translation')).toBeInTheDocument();
    });

    it('un texto de la IA vacío lo dice en vez de dejar un hueco', async () => {
      mocked.clipboardAi.mockResolvedValue('');
      render(<Expanded />);
      fireEvent.click(screen.getByRole('button', { name: 'Resumir' }));
      expect(await screen.findByText('La IA no devolvió nada.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copiar resultado' })).not.toBeInTheDocument();
    });
  });

  it('la pastilla cuenta los elementos', () => {
    render(<Compact />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

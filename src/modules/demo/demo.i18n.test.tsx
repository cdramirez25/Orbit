import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { MESSAGES } from '@/i18n/messages';
import { INITIAL_SNAPSHOT } from '@/lib/island/island.machine';
import { DemoControls } from '@/modules/demo/DemoControls';
import { useDemoStore } from '@/modules/demo/demo.store';
import { Expanded } from '@/modules/demo/Expanded';
import { useIslandStore } from '@/stores/island.store';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useDemoStore.setState({ answer: null, streaming: false });
  useIslandStore.setState({ snapshot: INITIAL_SNAPSHOT, alert: null });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('módulo de demo traducido', () => {
  it('muestra el contenido de ejemplo en español', () => {
    render(<Expanded />);
    expect(screen.getByText('Pregunta detectada')).toBeInTheDocument();
    expect(screen.getByText('¿Cuál es la capital de Australia?')).toBeInTheDocument();
  });

  it('cambia a inglés al instante al elegir el idioma', () => {
    render(<Expanded />);
    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getByText('Question detected')).toBeInTheDocument();
    expect(screen.getByText('What is the capital of Australia?')).toBeInTheDocument();
  });

  it('la respuesta simulada sale en el idioma activo', () => {
    useLocaleStore.getState().setLocale('en');
    act(() => useDemoStore.getState().streamAnswer());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(useDemoStore.getState().answer).toBe(MESSAGES.en['demo.answerLong']);
    expect(useDemoStore.getState().streaming).toBe(false);
  });

  it('la alerta de demo se traduce', () => {
    useLocaleStore.getState().setLocale('en');
    act(() => useDemoStore.getState().showDemoAlert());
    expect(useIslandStore.getState().alert).toEqual({
      title: 'Question detected',
      message: 'What is the capital of Australia?',
    });
  });
});

describe('panel de demo traducido', () => {
  it('los botones cambian de idioma con el selector ES / EN', () => {
    render(<DemoControls />);
    expect(screen.getByRole('button', { name: 'Simular respuesta' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Izquierda' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'EN' }));

    expect(screen.getByRole('button', { name: 'Simulate answer' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Left' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Expanded' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simular respuesta' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'ES' }));
    expect(screen.getByRole('button', { name: 'Simular respuesta' })).toBeInTheDocument();
  });
});

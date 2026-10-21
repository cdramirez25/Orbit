import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { Compact } from '@/modules/weather/Compact';
import { Expanded } from '@/modules/weather/Expanded';
import { useWeatherStore } from '@/stores/weather.store';
import type { WeatherReport } from '@/types';

const report: WeatherReport = {
  location: {
    name: 'Santa Cruz',
    country: 'Bolivia',
    countryCode: 'BO',
    latitude: -17.8,
    longitude: -63.2,
  },
  units: 'metric',
  current: {
    temperature: 24.4,
    apparentTemperature: 25.6,
    humidity: 81,
    windSpeed: 19.9,
    weatherCode: 61,
    isDay: true,
  },
  today: { temperatureMax: 31, temperatureMin: 23.5, precipitationProbability: 20 },
  fetchedAtMs: Date.UTC(2026, 9, 21, 15, 30),
};

const refresh = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
  useWeatherStore.setState({ report, status: 'ready', errorCode: null, refresh });
});

describe('clima expandido', () => {
  it('muestra temperatura, condición, lugar y detalles', () => {
    render(<Expanded />);
    expect(screen.getByText('24°')).toBeInTheDocument();
    expect(screen.getByText('Lluvia')).toBeInTheDocument();
    expect(screen.getByText('Santa Cruz, Bolivia')).toBeInTheDocument();
    expect(screen.getByText('26°')).toBeInTheDocument(); // sensación
    expect(screen.getByText('81%')).toBeInTheDocument();
    expect(screen.getByText('20 km/h')).toBeInTheDocument();
    expect(screen.getByText('31° / 24°')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('sin probabilidad de lluvia no inventa el dato', () => {
    useWeatherStore.setState({
      report: { ...report, today: { ...report.today, precipitationProbability: null } },
    });
    render(<Expanded />);
    expect(screen.queryByText('Prob. lluvia')).toBeNull();
    expect(screen.queryByText('20%')).toBeNull();
  });

  it('con unidades imperiales usa mph', () => {
    useWeatherStore.setState({ report: { ...report, units: 'imperial' } });
    render(<Expanded />);
    expect(screen.getByText('20 mph')).toBeInTheDocument();
  });

  it('el botón actualizar fuerza la consulta', () => {
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar clima' }));
    expect(refresh).toHaveBeenCalledWith(true);
  });

  it('mientras carga por primera vez avisa que lo está buscando', () => {
    useWeatherStore.setState({ report: null, status: 'loading' });
    render(<Expanded />);
    expect(screen.getByText('Buscando el clima de tu zona…')).toBeInTheDocument();
  });

  it('sin conexión ofrece reintentar', () => {
    useWeatherStore.setState({ report: null, status: 'error', errorCode: 'weather.network' });
    render(<Expanded />);
    expect(screen.getByText('Sin conexión para consultar el clima')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refresh).toHaveBeenCalledWith(true);
  });

  it('un error cualquiera muestra el mensaje genérico', () => {
    useWeatherStore.setState({ report: null, status: 'error', errorCode: 'weather.badResponse' });
    render(<Expanded />);
    expect(screen.getByText('No se pudo obtener el clima')).toBeInTheDocument();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByText('Rain')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh weather' })).toBeInTheDocument();
  });
});

describe('clima en la pastilla', () => {
  it('muestra la temperatura', () => {
    render(<Compact />);
    expect(screen.getByText('24°')).toBeInTheDocument();
  });

  it('sin datos todavía muestra guiones', () => {
    useWeatherStore.setState({ report: null, status: 'loading' });
    render(<Compact />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });
});

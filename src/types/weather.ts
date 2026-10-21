/** Espejo de `WeatherReport` y sus partes en `src-tauri/src/weather/mod.rs`. */

/** `metric`: °C y km/h. `imperial`: °F y mph. */
export type Units = 'metric' | 'imperial';

export interface WeatherLocation {
  name: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

/** Condiciones de ahora mismo, ya en las unidades de `WeatherReport.units`. */
export interface WeatherCurrent {
  temperature: number;
  apparentTemperature: number;
  /** Humedad relativa, 0–100. */
  humidity: number;
  windSpeed: number;
  /** Código meteorológico WMO (0 despejado, 61 lluvia, 95 tormenta…). */
  weatherCode: number;
  isDay: boolean;
}

export interface WeatherToday {
  temperatureMax: number;
  temperatureMin: number;
  /** Probabilidad máxima de precipitación, 0–100, si el proveedor la da. */
  precipitationProbability: number | null;
}

export interface WeatherReport {
  location: WeatherLocation;
  units: Units;
  current: WeatherCurrent;
  today: WeatherToday;
  /** Cuándo se obtuvo (milisegundos Unix). */
  fetchedAtMs: number;
}

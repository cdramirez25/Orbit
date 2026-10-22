import { describe, expect, it } from 'vitest';

import { modelErrorKey, sttErrorKey } from '@/lib/audio/stt-error';

describe('sttErrorKey', () => {
  it('elige el mensaje de cada error de transcripción', () => {
    expect(sttErrorKey('stt.modelMissing')).toBe('stt.error.modelMissing');
    expect(sttErrorKey('stt.modelLoad')).toBe('stt.error.modelLoad');
    expect(sttErrorKey('stt.inference')).toBe('stt.error.generic');
  });

  it('ignora los errores que no son de transcripción', () => {
    expect(sttErrorKey('audio.capture')).toBeNull();
    expect(sttErrorKey('unknown')).toBeNull();
  });
});

describe('modelErrorKey', () => {
  it('elige el mensaje de cada fallo de la descarga del modelo', () => {
    expect(modelErrorKey('stt.model.network')).toBe('stt.model.error.network');
    expect(modelErrorKey('stt.model.disk')).toBe('stt.model.error.disk');
    expect(modelErrorKey('stt.model.corrupt')).toBe('stt.model.error.corrupt');
    expect(modelErrorKey('stt.model.busy')).toBe('stt.model.error.busy');
  });

  it('cualquier otro código tiene un mensaje genérico', () => {
    expect(modelErrorKey('unknown')).toBe('stt.model.error.generic');
  });
});

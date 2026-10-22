import { describe, expect, it } from 'vitest';

import { listenErrorKey } from '@/lib/audio/listen-error';

describe('listenErrorKey', () => {
  it('en Ajustes el permiso denegado no se explica (ya se ve su estado)', () => {
    expect(listenErrorKey('audio.permissionDenied')).toBeNull();
  });

  it('en la isla el permiso denegado sí se explica', () => {
    expect(listenErrorKey('audio.permissionDenied', true)).toBe('listen.error.permission');
  });

  it('sin dispositivo, sin modelo y los demás fallos tienen su mensaje', () => {
    expect(listenErrorKey('audio.noOutputDevice')).toBe('audio.error.noDevice');
    expect(listenErrorKey('stt.modelMissing')).toBe('stt.error.modelMissing');
    expect(listenErrorKey('stt.modelLoad')).toBe('stt.error.modelLoad');
    expect(listenErrorKey('algo.raro')).toBe('audio.error.generic');
  });
});

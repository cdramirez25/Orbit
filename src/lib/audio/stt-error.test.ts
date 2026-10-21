import { describe, expect, it } from 'vitest';

import { sttErrorKey } from '@/lib/audio/stt-error';

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

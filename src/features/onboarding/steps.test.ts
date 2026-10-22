import { describe, expect, it } from 'vitest';

import { guideSteps } from '@/features/onboarding/steps';

describe('pasos de la guía', () => {
  it('donde el sistema pide el permiso de audio hay cinco pasos', () => {
    expect(guideSteps(true)).toEqual(['welcome', 'audio', 'model', 'ai', 'done']);
  });

  it('donde no lo pide (Windows) se salta el paso del permiso', () => {
    expect(guideSteps(false)).toEqual(['welcome', 'model', 'ai', 'done']);
  });
});

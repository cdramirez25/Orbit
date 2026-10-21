import { describe, expect, it } from 'vitest';

import { aiErrorKey, isAiError } from '@/lib/ai/ai-error';

describe('errores de la IA', () => {
  it('cada código tiene su mensaje y los desconocidos caen en el genérico', () => {
    expect(aiErrorKey('ai.unauthorized')).toBe('ai.error.unauthorized');
    expect(aiErrorKey('ai.missingKey')).toBe('ai.error.missingKey');
    expect(aiErrorKey('ai.notConfigured')).toBe('ai.error.notConfigured');
    expect(aiErrorKey('ai.rateLimited')).toBe('ai.error.rateLimited');
    expect(aiErrorKey('ai.algoNuevo')).toBe('ai.error.generic');
    expect(aiErrorKey('unknown')).toBe('ai.error.generic');
  });

  it('distingue los errores de la IA de los demás', () => {
    expect(isAiError('ai.network')).toBe(true);
    expect(isAiError('stt.modelMissing')).toBe(false);
    expect(isAiError('audio.capture')).toBe(false);
  });
});

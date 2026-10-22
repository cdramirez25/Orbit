import { describe, expect, it } from 'vitest';

import {
  RECOMMENDED_MODEL,
  STT_MODELS,
  activeEntry,
  isActiveModelReady,
  isDownloading,
} from '@/lib/audio/stt-models';
import { modelStatus } from '@/test/factories';

describe('modelos de voz', () => {
  it('se ofrecen de menor a mayor capacidad y se recomienda small', () => {
    expect(STT_MODELS).toEqual(['base', 'small', 'medium', 'turbo']);
    expect(RECOMMENDED_MODEL).toBe('small');
  });

  it('el modelo en uso está listo solo si ese está descargado', () => {
    expect(isActiveModelReady(null)).toBe(false);
    expect(isActiveModelReady(modelStatus())).toBe(false);
    // Otro modelo descargado no hace que el que se usa esté listo.
    expect(isActiveModelReady(modelStatus({ entries: { base: { state: 'ready' } } }))).toBe(false);
    expect(isActiveModelReady(modelStatus({ entries: { small: { state: 'ready' } } }))).toBe(true);
    expect(
      isActiveModelReady(modelStatus({ active: 'medium', entries: { small: { state: 'ready' } } })),
    ).toBe(false);
  });

  it('encuentra la entrada del modelo en uso', () => {
    expect(activeEntry(null)).toBeNull();
    expect(activeEntry(modelStatus({ active: 'turbo' }))?.model).toBe('turbo');
  });

  it('sabe si se está bajando alguno', () => {
    expect(isDownloading(null)).toBe(false);
    expect(isDownloading(modelStatus())).toBe(false);
    expect(isDownloading(modelStatus({ entries: { medium: { state: 'downloading' } } }))).toBe(
      true,
    );
  });
});

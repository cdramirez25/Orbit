import { describe, expect, it } from 'vitest';

import {
  canHandle,
  eventsToReach,
  INITIAL_SNAPSHOT,
  reduce,
  reduceAll,
  type IslandEvent,
  type IslandEventType,
  type IslandSnapshot,
} from '@/lib/island/island.machine';
import type { IslandState } from '@/types';

const snap = (state: IslandState, hovered = false): IslandSnapshot => {
  if (state === 'hidden') return { state, hovered: false };
  if (state === 'alert') return { state, hovered, returnTo: 'compact' };
  return { state, hovered };
};

const ev = (type: IslandEventType): IslandEvent => ({ type }) as IslandEvent;

describe('island.machine — transiciones válidas', () => {
  it('arranca en idle y sin hover', () => {
    expect(INITIAL_SNAPSHOT).toEqual({ state: 'idle', hovered: false });
  });

  it.each([
    ['hidden', 'SHOW', 'idle'],
    ['idle', 'ACTIVATE', 'compact'],
    ['compact', 'EXPAND', 'expanded'],
    ['expanded', 'COLLAPSE', 'compact'],
    ['compact', 'DEACTIVATE', 'idle'],
    ['idle', 'HIDE', 'hidden'],
    ['compact', 'HIDE', 'hidden'],
    ['expanded', 'HIDE', 'hidden'],
    ['alert', 'HIDE', 'hidden'],
  ] as const)('%s + %s → %s', (from, type, to) => {
    expect(reduce(snap(from), ev(type)).state).toBe(to);
  });

  it.each(['idle', 'compact', 'expanded'] as const)(
    '%s → alert → %s (vuelve al anterior)',
    (from) => {
      const inAlert = reduce(snap(from), ev('ALERT'));
      expect(inAlert).toMatchObject({ state: 'alert', returnTo: from });
      expect(reduce(inAlert, ev('ALERT_END')).state).toBe(from);
    },
  );
});

describe('island.machine — transiciones inválidas', () => {
  it.each([
    ['idle', 'EXPAND'], // la cadena es estricta: idle no salta a expanded
    ['idle', 'COLLAPSE'],
    ['idle', 'DEACTIVATE'],
    ['idle', 'SHOW'],
    ['compact', 'ACTIVATE'],
    ['compact', 'COLLAPSE'],
    ['expanded', 'EXPAND'],
    ['expanded', 'DEACTIVATE'], // expanded no salta a idle
    ['hidden', 'ACTIVATE'],
    ['hidden', 'EXPAND'],
    ['hidden', 'ALERT'],
    ['hidden', 'HIDE'],
    ['alert', 'ALERT'], // un alert no se anida
    ['alert', 'EXPAND'],
    ['alert', 'COLLAPSE'],
    ['idle', 'ALERT_END'],
  ] as const)('%s + %s se ignora y devuelve el mismo snapshot', (from, type) => {
    const before = snap(from);
    expect(canHandle(before, type)).toBe(false);
    expect(reduce(before, ev(type))).toBe(before);
  });

  it('canHandle coincide con reduce para cada estado y evento', () => {
    const states: IslandState[] = ['hidden', 'idle', 'compact', 'expanded', 'alert'];
    const types: IslandEventType[] = [
      'SHOW',
      'HIDE',
      'ACTIVATE',
      'DEACTIVATE',
      'EXPAND',
      'COLLAPSE',
      'ALERT',
      'ALERT_END',
    ];
    for (const state of states) {
      for (const type of types) {
        const before = snap(state);
        const changed = reduce(before, ev(type)) !== before;
        expect(canHandle(before, type), `${state} + ${type}`).toBe(changed);
      }
    }
  });
});

describe('island.machine — hover', () => {
  it('activa y desactiva el hover en estados visibles', () => {
    const hovered = reduce(snap('idle'), ev('POINTER_ENTER'));
    expect(hovered).toEqual({ state: 'idle', hovered: true });
    expect(reduce(hovered, ev('POINTER_LEAVE'))).toEqual({ state: 'idle', hovered: false });
  });

  it('es idempotente: no cambia la referencia si ya está en ese valor', () => {
    const before = snap('compact', true);
    expect(reduce(before, ev('POINTER_ENTER'))).toBe(before);
    const away = snap('compact', false);
    expect(reduce(away, ev('POINTER_LEAVE'))).toBe(away);
  });

  it('hidden nunca entra en hover', () => {
    const before = snap('hidden');
    expect(reduce(before, ev('POINTER_ENTER'))).toBe(before);
    expect(canHandle(before, 'POINTER_ENTER')).toBe(false);
  });

  it('el hover se conserva al cambiar de estado', () => {
    const next = reduce(snap('idle', true), ev('ACTIVATE'));
    expect(next).toEqual({ state: 'compact', hovered: true });
  });

  it('el hover se pierde al ocultar', () => {
    expect(reduce(snap('expanded', true), ev('HIDE'))).toEqual({ state: 'hidden', hovered: false });
  });
});

describe('island.machine — eventsToReach', () => {
  const targets: IslandState[] = ['hidden', 'idle', 'compact', 'expanded', 'alert'];
  const origins: IslandState[] = ['hidden', 'idle', 'compact', 'expanded', 'alert'];

  it.each(origins.flatMap((from) => targets.map((to) => [from, to] as const)))(
    'de %s a %s solo usa transiciones válidas y llega al destino',
    (from, to) => {
      const start = snap(from);
      const events = eventsToReach(start, to);
      let current = start;
      for (const event of events) {
        expect(canHandle(current, event.type), `${current.state} + ${event.type}`).toBe(true);
        current = reduce(current, event);
      }
      expect(current.state).toBe(to);
    },
  );

  it('idle → expanded pasa por compact en una sola ráfaga', () => {
    const events = eventsToReach(snap('idle'), 'expanded');
    expect(events.map((e) => e.type)).toEqual(['ACTIVATE', 'EXPAND']);
    expect(reduceAll(snap('idle'), events).state).toBe('expanded');
  });

  it('no emite eventos si ya está en el destino', () => {
    expect(eventsToReach(snap('compact'), 'compact')).toEqual([]);
  });
});

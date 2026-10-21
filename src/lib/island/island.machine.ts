import type { IslandState, RestingState } from '@/types';

/**
 * Máquina de estados de la isla (§3.1). Lógica pura: sin React, sin Tauri, sin timers.
 *
 *   hidden ⇄ idle ⇄ compact ⇄ expanded        (cadena estricta; no se salta de idle a expanded)
 *   idle | compact | expanded → alert → (estado anterior)
 *   cualquier estado visible → hidden
 *
 * El *hover* es una región ortogonal (puntero encima o no) y vive en el snapshot; no es una
 * bandera suelta: está tipada por estado y `hidden` nunca puede estar en hover.
 */

export type IslandEvent =
  | { type: 'SHOW' }
  | { type: 'HIDE' }
  | { type: 'ACTIVATE' }
  | { type: 'DEACTIVATE' }
  | { type: 'EXPAND' }
  | { type: 'COLLAPSE' }
  | { type: 'ALERT' }
  | { type: 'ALERT_END' }
  | { type: 'POINTER_ENTER' }
  | { type: 'POINTER_LEAVE' };

export type IslandEventType = IslandEvent['type'];

export type IslandSnapshot =
  | { readonly state: 'hidden'; readonly hovered: false }
  | { readonly state: RestingState; readonly hovered: boolean }
  | { readonly state: 'alert'; readonly hovered: boolean; readonly returnTo: RestingState };

export const INITIAL_SNAPSHOT: IslandSnapshot = { state: 'idle', hovered: false };

/** `'return'` = volver al estado guardado en `returnTo`. */
type Target = IslandState | 'return';

type TransitionTable = Record<IslandState, Partial<Record<IslandEventType, Target>>>;

const TRANSITIONS: TransitionTable = {
  hidden: { SHOW: 'idle' },
  idle: { ACTIVATE: 'compact', ALERT: 'alert', HIDE: 'hidden' },
  compact: { EXPAND: 'expanded', DEACTIVATE: 'idle', ALERT: 'alert', HIDE: 'hidden' },
  expanded: { COLLAPSE: 'compact', ALERT: 'alert', HIDE: 'hidden' },
  alert: { ALERT_END: 'return', HIDE: 'hidden' },
};

export function isResting(
  snapshot: IslandSnapshot,
): snapshot is Extract<IslandSnapshot, { state: RestingState }> {
  return snapshot.state === 'idle' || snapshot.state === 'compact' || snapshot.state === 'expanded';
}

/** ¿Es `event` una transición válida desde `snapshot`? (El hover es válido salvo en `hidden`.) */
export function canHandle(snapshot: IslandSnapshot, eventType: IslandEventType): boolean {
  if (eventType === 'POINTER_ENTER' || eventType === 'POINTER_LEAVE') {
    return snapshot.state !== 'hidden';
  }
  return TRANSITIONS[snapshot.state][eventType] !== undefined;
}

function reduceHover(snapshot: IslandSnapshot, hovered: boolean): IslandSnapshot {
  if (snapshot.state === 'hidden' || snapshot.hovered === hovered) return snapshot;
  return { ...snapshot, hovered };
}

/**
 * Transición pura. Un evento inválido en el estado actual se ignora y devuelve el *mismo*
 * snapshot (misma referencia), de modo que `store.set` no provoca re-render.
 */
export function reduce(snapshot: IslandSnapshot, event: IslandEvent): IslandSnapshot {
  if (event.type === 'POINTER_ENTER') return reduceHover(snapshot, true);
  if (event.type === 'POINTER_LEAVE') return reduceHover(snapshot, false);

  const target = TRANSITIONS[snapshot.state][event.type];
  if (target === undefined) return snapshot;

  if (target === 'hidden') return { state: 'hidden', hovered: false };

  if (target === 'return') {
    // Solo `alert` define 'return' en la tabla.
    return snapshot.state === 'alert'
      ? { state: snapshot.returnTo, hovered: snapshot.hovered }
      : snapshot;
  }

  if (target === 'alert') {
    // Solo se llega a `alert` desde un estado de reposo.
    return isResting(snapshot)
      ? { state: 'alert', hovered: snapshot.hovered, returnTo: snapshot.state }
      : snapshot;
  }

  return { state: target, hovered: snapshot.hovered };
}

/** Aplica varios eventos en orden y devuelve el snapshot final. */
export function reduceAll(
  snapshot: IslandSnapshot,
  events: readonly IslandEvent[],
): IslandSnapshot {
  return events.reduce(reduce, snapshot);
}

const CHAIN: readonly RestingState[] = ['idle', 'compact', 'expanded'];

const STEP_UP: Record<'idle' | 'compact', IslandEvent> = {
  idle: { type: 'ACTIVATE' },
  compact: { type: 'EXPAND' },
};

const STEP_DOWN: Record<'compact' | 'expanded', IslandEvent> = {
  expanded: { type: 'COLLAPSE' },
  compact: { type: 'DEACTIVATE' },
};

/**
 * Camino de eventos válidos para llegar a `target` desde `from` (lo usan los botones de demo).
 * Recorre la cadena paso a paso; nunca salta una transición que la máquina no permita.
 */
export function eventsToReach(from: IslandSnapshot, target: IslandState): IslandEvent[] {
  if (from.state === target) return [];

  const events: IslandEvent[] = [];
  let current = from;
  const push = (event: IslandEvent) => {
    events.push(event);
    current = reduce(current, event);
  };

  if (target === 'hidden') {
    push({ type: 'HIDE' });
    return events;
  }

  if (current.state === 'hidden') push({ type: 'SHOW' });
  if (current.state === 'alert') push({ type: 'ALERT_END' });

  if (target === 'alert') {
    push({ type: 'ALERT' });
    return events;
  }

  let index = isResting(current) ? CHAIN.indexOf(current.state) : 0;
  const goal = CHAIN.indexOf(target);

  while (index < goal) {
    const step = STEP_UP[CHAIN[index] as 'idle' | 'compact'];
    push(step);
    index += 1;
  }
  while (index > goal) {
    const step = STEP_DOWN[CHAIN[index] as 'compact' | 'expanded'];
    push(step);
    index -= 1;
  }

  return events;
}

import { describe, expect, it } from 'vitest';

import {
  HOVER,
  isShrinking,
  resolveIslandTarget,
  resolveLayout,
  SHAPE,
  SIZE,
  type ResolveArgs,
} from '@/lib/island/island.motion';
import type { NotchInfo } from '@/types';

const notch: NotchInfo = {
  hasNotch: true,
  notchWidth: 190,
  notchHeight: 33,
  screenFrame: { x: 0, y: 0, width: 1512, height: 982 },
};

const base: ResolveArgs = {
  state: 'idle',
  hovered: false,
  style: 'floating',
  notch: null,
  contentHeight: 150,
};

describe('resolveIslandTarget', () => {
  it('attached + notch real: idle mide exactamente el notch y no tiene esquinas superiores', () => {
    const t = resolveIslandTarget({ ...base, style: 'attached', notch });
    expect(t).toMatchObject({ width: 190, height: 33, topRadius: 0, opacity: 1, fused: true });
  });

  it('attached + notch real: hidden se funde con el notch (sigue visible)', () => {
    const t = resolveIslandTarget({ ...base, state: 'hidden', style: 'attached', notch });
    expect(t).toMatchObject({ width: 190, height: 33, opacity: 1, fused: true });
  });

  it('floating: hidden es invisible', () => {
    expect(resolveIslandTarget({ ...base, state: 'hidden' }).opacity).toBe(0);
  });

  it('hover en idle crece el ancho ~6 % (entre 4 % y 8 %)', () => {
    const rest = resolveIslandTarget(base);
    const hover = resolveIslandTarget({ ...base, hovered: true });
    const growth = hover.width / rest.width - 1;
    expect(growth).toBeCloseTo(HOVER.scaleX - 1);
    expect(growth).toBeGreaterThanOrEqual(0.04);
    expect(growth).toBeLessThanOrEqual(0.08);
    expect(hover.height).toBe(rest.height);
  });

  it('el hover no cambia el tamaño fuera de idle', () => {
    const a = resolveIslandTarget({ ...base, state: 'compact' });
    const b = resolveIslandTarget({ ...base, state: 'compact', hovered: true });
    expect(b).toEqual(a);
  });

  it('compact attached extiende alas a ambos lados del notch', () => {
    const t = resolveIslandTarget({ ...base, state: 'compact', style: 'attached', notch });
    expect(t.width).toBe(190 + SIZE.attached.compactWing * 2);
    expect(t.height).toBe(33);
  });

  it('esquinas inferiores: ≈18 en compact y ≈28 en expanded', () => {
    expect(resolveIslandTarget({ ...base, state: 'compact' }).bottomRadius).toBe(18);
    expect(resolveIslandTarget({ ...base, state: 'expanded' }).bottomRadius).toBe(28);
  });

  it('expanded: la altura se limita entre el mínimo y el máximo (después, scroll interno)', () => {
    const small = resolveIslandTarget({ ...base, state: 'expanded', contentHeight: 10 });
    const big = resolveIslandTarget({ ...base, state: 'expanded', contentHeight: 9999 });
    expect(small.height).toBe(SIZE.expanded.minHeight);
    expect(big.height).toBe(SIZE.expanded.maxHeight.normal);
  });

  it('expanded attached reserva la franja del notch arriba', () => {
    const t = resolveIslandTarget({ ...base, state: 'expanded', style: 'attached', notch });
    expect(t.topInset).toBe(33);
    expect(t.topRadius).toBe(0);
  });

  it('floating: las esquinas superiores igualan a las inferiores', () => {
    const t = resolveIslandTarget({ ...base, state: 'expanded' });
    expect(t.topRadius).toBe(t.bottomRadius);
  });

  it('attached sin notch real usa medidas ficticias y no se considera fundida', () => {
    const t = resolveIslandTarget({
      ...base,
      style: 'attached',
      notch: { ...notch, hasNotch: false },
    });
    expect(t.width).toBe(SHAPE.notchFallback.width);
    expect(t.fused).toBe(false);
  });

  it('el radio nunca supera la mitad del alto', () => {
    const t = resolveIslandTarget(base);
    expect(t.bottomRadius).toBeLessThanOrEqual(t.height / 2);
  });
});

describe('tarjeta alargada (expandedSize)', () => {
  const expanded = { ...base, state: 'expanded' as const, contentHeight: 9999 };

  it('alargar deja más alto el tope que el tamaño normal', () => {
    const normal = resolveIslandTarget({ ...expanded, expandedSize: 'normal' });
    const tall = resolveIslandTarget({ ...expanded, expandedSize: 'tall' });
    expect(normal.height).toBe(SIZE.expanded.maxHeight.normal);
    expect(tall.height).toBe(SIZE.expanded.maxHeight.tall);
    expect(tall.height).toBeGreaterThan(normal.height);
  });

  it('sin indicar tamaño se usa el normal', () => {
    expect(resolveIslandTarget(expanded).height).toBe(SIZE.expanded.maxHeight.normal);
  });

  it('en attached el tope suma la franja del notch para no perder filas', () => {
    const tall = resolveIslandTarget({
      ...expanded,
      style: 'attached',
      notch,
      expandedSize: 'tall',
    });
    expect(tall.height).toBe(SIZE.expanded.maxHeight.tall + notch.notchHeight);
  });

  it('con poco contenido la tarjeta no se estira aunque esté alargada', () => {
    const tall = resolveIslandTarget({ ...expanded, contentHeight: 150, expandedSize: 'tall' });
    expect(tall.height).toBe(150);
  });

  it('alargado cabe en la ventana nativa con el panel de demo debajo', () => {
    const attachedTall = SIZE.expanded.maxHeight.tall + notch.notchHeight;
    const demoPanel = 120; // alto aproximado del panel de demo + su margen
    expect(SHAPE.floatingMarginTop + attachedTall + demoPanel).toBeLessThanOrEqual(480);
  });
});

describe('resolveLayout', () => {
  it('en el centro la isla se acopla al notch real y respeta el estilo elegido', () => {
    expect(resolveLayout({ anchor: 'center', style: 'attached', notch })).toEqual({
      style: 'attached',
      notch,
    });
  });

  it.each(['left', 'right'] as const)('en %s ignora el notch (no está sobre él)', (anchor) => {
    expect(resolveLayout({ anchor, style: 'attached', notch })).toEqual({
      style: 'attached',
      notch: null,
    });
  });

  it('en modo libre siempre flota y no usa el notch', () => {
    expect(resolveLayout({ anchor: 'free', style: 'attached', notch })).toEqual({
      style: 'floating',
      notch: null,
    });
  });

  it('fuera del centro la isla ya no se funde con el notch (hidden sigue invisible)', () => {
    const { style, notch: effective } = resolveLayout({ anchor: 'left', style: 'attached', notch });
    const hidden = resolveIslandTarget({ ...base, state: 'hidden', style, notch: effective });
    expect(hidden.opacity).toBe(0);
    expect(hidden.fused).toBe(false);
  });
});

describe('isShrinking', () => {
  it('detecta cuándo el contenedor se contrae', () => {
    expect(isShrinking('expanded', 'compact')).toBe(true);
    expect(isShrinking('compact', 'idle')).toBe(true);
    expect(isShrinking('idle', 'hidden')).toBe(true);
    expect(isShrinking('idle', 'compact')).toBe(false);
    expect(isShrinking('compact', 'expanded')).toBe(false);
    expect(isShrinking('compact', 'compact')).toBe(false);
  });
});

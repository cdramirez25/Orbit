import { beforeEach, describe, expect, it } from 'vitest';

import { pickActive, selectActiveModule, useRegistryStore } from '@/modules/registry';
import type { OrbitModule } from '@/types';

function fakeModule(id: string, priority: number, ambient = false): OrbitModule {
  const View = () => null;
  return {
    id,
    labelKey: 'weather.module',
    icon: View,
    priority,
    ambient,
    Compact: View,
    Expanded: View,
  };
}

const weather = fakeModule('weather', 0, true);
const clipboard = fakeModule('clipboard', 0, true);
const listening = fakeModule('listening', 1);
const modules = { weather, clipboard, listening };

describe('pickActive', () => {
  it('sin actividades no hay módulo', () => {
    expect(pickActive(modules, [])).toBeNull();
  });

  it('gana la actividad de mayor prioridad', () => {
    expect(pickActive(modules, ['weather', 'listening', 'clipboard'])).toBe(listening);
  });

  it('a igual prioridad gana el que empezó antes', () => {
    expect(pickActive(modules, ['weather', 'clipboard'])).toBe(weather);
    expect(pickActive(modules, ['clipboard', 'weather'])).toBe(clipboard);
  });

  it('a igual prioridad gana el elegido por el usuario', () => {
    expect(pickActive(modules, ['weather', 'clipboard'], 'clipboard')).toBe(clipboard);
  });

  it('lo elegido no pasa por encima de una prioridad mayor', () => {
    expect(pickActive(modules, ['clipboard', 'listening'], 'clipboard')).toBe(listening);
  });

  it('ignora ids que no están registrados', () => {
    expect(pickActive(modules, ['ghost', 'weather'])).toBe(weather);
  });
});

describe('useRegistryStore', () => {
  beforeEach(() => {
    useRegistryStore.setState({ modules: {}, activities: [], selectedId: null });
    for (const module of Object.values(modules)) useRegistryStore.getState().register(module);
  });

  it('select cambia el módulo visible entre los residentes', () => {
    const { startActivity, select } = useRegistryStore.getState();
    startActivity('weather');
    startActivity('clipboard');
    expect(selectActiveModule(useRegistryStore.getState())).toBe(weather);

    select('clipboard');
    expect(selectActiveModule(useRegistryStore.getState())).toBe(clipboard);
  });

  it('terminar una actividad devuelve la isla al siguiente módulo', () => {
    const { startActivity, endActivity } = useRegistryStore.getState();
    startActivity('weather');
    startActivity('listening');
    expect(selectActiveModule(useRegistryStore.getState())).toBe(listening);

    endActivity('listening');
    expect(selectActiveModule(useRegistryStore.getState())).toBe(weather);
  });
});

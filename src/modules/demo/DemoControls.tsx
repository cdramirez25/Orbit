import { Button, Tab, Toggle } from '@/components/ui';
import { HIT_TARGET_ATTR } from '@/hooks/useHitTest';
import { useDemoStore } from '@/modules/demo/demo.store';
import { commands } from '@/ipc/commands';
import { useIslandStore } from '@/stores/island.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { IslandAnchor, IslandState } from '@/types';

const STATES: ReadonlyArray<{ id: IslandState; label: string }> = [
  { id: 'hidden', label: 'Oculto' },
  { id: 'idle', label: 'Reposo' },
  { id: 'compact', label: 'Compacto' },
  { id: 'expanded', label: 'Expandido' },
];

const POSITIONS: ReadonlyArray<{ id: IslandAnchor; label: string }> = [
  { id: 'left', label: 'Izquierda' },
  { id: 'center', label: 'Centro' },
  { id: 'right', label: 'Derecha' },
  { id: 'free', label: 'Libre' },
];

/** Panel de demo (solo en desarrollo): recorre los estados de la isla y alterna el estilo. */
export function DemoControls() {
  const current = useIslandStore((s) => s.snapshot.state);
  const goTo = useDemoStore((s) => s.goTo);
  const streamAnswer = useDemoStore((s) => s.streamAnswer);
  const showAlert = useDemoStore((s) => s.showDemoAlert);
  const style = useSettingsStore((s) => s.islandStyle);
  const setStyle = useSettingsStore((s) => s.setIslandStyle);
  const anchor = useSettingsStore((s) => s.anchor);
  const setAnchor = useSettingsStore((s) => s.setAnchor);
  const hideFromShare = useSettingsStore((s) => s.hideFromScreenShare);
  const setHideFromShare = useSettingsStore((s) => s.setHideFromScreenShare);

  const hitTarget = { [HIT_TARGET_ATTR]: '' };

  return (
    <div
      {...hitTarget}
      className="fixed bottom-2 left-1/2 flex -translate-x-1/2 flex-col gap-2 rounded-2xl bg-neutral-900/95 px-3 py-2.5 ring-1 ring-white/10"
    >
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Estado de la isla">
        {STATES.map(({ id, label }) => (
          <Tab key={id} selected={current === id} onClick={() => goTo(id)}>
            {label}
          </Tab>
        ))}
        <Tab selected={current === 'alert'} onClick={showAlert}>
          Alerta
        </Tab>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Estilo">
          <Tab selected={style === 'attached'} onClick={() => setStyle('attached')}>
            Attached
          </Tab>
          <Tab selected={style === 'floating'} onClick={() => setStyle('floating')}>
            Floating
          </Tab>
        </div>
        <Button size="sm" variant="primary" onClick={streamAnswer}>
          Simular respuesta
        </Button>
        <label className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-ink-dim">
          <Toggle
            label="Ocultar de screen share"
            checked={hideFromShare}
            onCheckedChange={setHideFromShare}
          />
          Oculta en share
        </label>
        <Button size="sm" variant="danger" onClick={() => void commands.quitApp()}>
          Salir
        </Button>
      </div>

      <div className="flex items-center gap-1.5" role="tablist" aria-label="Posición de la isla">
        <span className="text-[11px] text-ink-faint">Posición</span>
        {POSITIONS.map(({ id, label }) => (
          <Tab key={id} selected={anchor === id} onClick={() => void setAnchor(id)}>
            {label}
          </Tab>
        ))}
        {anchor === 'free' && (
          <span className="text-[11px] whitespace-nowrap text-ink-faint">
            arrastra la isla y suéltala
          </span>
        )}
      </div>
    </div>
  );
}

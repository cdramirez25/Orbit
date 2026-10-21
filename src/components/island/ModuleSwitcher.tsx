import { Tab } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils/cn';
import type { OrbitModule } from '@/types';

interface ModuleSwitcherProps {
  /** Módulos entre los que se puede elegir (los residentes). */
  modules: readonly OrbitModule[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Pestañas de la tarjeta: el módulo elegido muestra su nombre, el resto solo el icono. */
export function ModuleSwitcher({ modules, activeId, onSelect }: ModuleSwitcherProps) {
  const t = useT();

  return (
    <div role="tablist" aria-label={t('modules.switcherAria')} className="flex items-center gap-1">
      {modules.map((module) => {
        const selected = module.id === activeId;
        const label = t(module.labelKey);
        return (
          <Tab
            key={module.id}
            selected={selected}
            aria-label={label}
            title={label}
            onClick={() => onSelect(module.id)}
            className={cn(
              'inline-flex items-center gap-1.5',
              selected ? 'bg-white/14 text-ink' : 'bg-transparent hover:bg-white/10',
            )}
          >
            <span aria-hidden className="flex [&>svg]:size-3.5">
              <module.icon />
            </span>
            {selected && label}
          </Tab>
        );
      })}
    </div>
  );
}

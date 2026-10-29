import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Plug,
  type LucideIcon,
} from 'lucide-react';

import { batteryAlert } from '@/lib/system';
import type { Battery } from '@/types';

export type BatteryIconName =
  'critical' | 'low' | 'charging' | 'pluggedIn' | 'full' | 'medium' | 'empty';

export const BATTERY_ICONS: Record<BatteryIconName, LucideIcon> = {
  critical: BatteryWarning,
  low: BatteryLow,
  charging: BatteryCharging,
  pluggedIn: Plug,
  full: BatteryFull,
  medium: BatteryMedium,
  empty: BatteryLow,
};

/** Qué icono cuenta cómo está la batería: el aviso, si lo hay; si no, el estado o el nivel. */
export function batteryIconName(battery: Battery): BatteryIconName {
  const alert = batteryAlert(battery);
  if (alert === 'critical') return 'critical';
  if (alert === 'low') return 'low';
  if (battery.state === 'charging') return 'charging';
  if (battery.state === 'pluggedIn') return 'pluggedIn';
  if (battery.state === 'full' || battery.percent >= 60) return 'full';
  return battery.percent >= 30 ? 'medium' : 'empty';
}

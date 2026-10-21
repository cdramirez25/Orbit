import { Island } from '@/components/island/Island';
import { useHitTest } from '@/hooks/useHitTest';
import { DemoControls } from '@/modules/demo/DemoControls';

export function App() {
  useHitTest();

  return (
    <>
      <Island />
      {/* Controles de demo de la Fase 1: solo en desarrollo (`pnpm tauri dev`). */}
      {import.meta.env.DEV && <DemoControls />}
    </>
  );
}

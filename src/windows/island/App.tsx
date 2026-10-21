import { Island } from '@/components/island/Island';
import { useHitTest } from '@/hooks/useHitTest';

export function App() {
  useHitTest();

  return <Island />;
}

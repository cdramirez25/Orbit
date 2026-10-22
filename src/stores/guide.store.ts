import { create } from 'zustand';

interface GuideStore {
  /** ¿Se está mostrando la guía de primer arranque en lugar de los ajustes? */
  visible: boolean;
  show: () => void;
  hide: () => void;
}

/** La guía de primer arranque vive en la ventana de ajustes: sale la primera vez y desde General. */
export const useGuideStore = create<GuideStore>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));

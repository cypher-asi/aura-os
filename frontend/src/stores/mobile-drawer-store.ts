import { create } from "zustand";

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

interface MobileDrawerState {
  navOpen: boolean;
  previewOpen: boolean;
  accountOpen: boolean;

  setNavOpen: (open: boolean) => void;
  setPreviewOpen: (open: boolean) => void;
  setAccountOpen: (open: boolean) => void;
  closeDrawers: () => void;
  openAfterDrawerClose: (callback: () => void) => void;
}

export const useMobileDrawerStore = create<MobileDrawerState>()((set) => ({
  navOpen: false,
  previewOpen: false,
  accountOpen: false,

  setNavOpen: (open) => set({ navOpen: open }),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  setAccountOpen: (open) => set({ accountOpen: open }),

  closeDrawers: () => {
    blurActiveElement();
    set({ navOpen: false, previewOpen: false, accountOpen: false });
  },

  openAfterDrawerClose: (callback) => {
    const { closeDrawers } = useMobileDrawerStore.getState();
    closeDrawers();
    window.setTimeout(callback, 180);
  },
}));

export function selectDrawerOpen(s: MobileDrawerState): boolean {
  return s.navOpen || s.previewOpen || s.accountOpen;
}

export function selectOverlayDrawerOpen(s: MobileDrawerState): boolean {
  return s.navOpen || s.previewOpen || s.accountOpen;
}

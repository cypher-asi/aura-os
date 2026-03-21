import { create } from "zustand";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";

interface UIModalState {
  orgSettingsOpen: boolean;
  orgInitialSection: "billing" | undefined;
  settingsOpen: boolean;
  buyCreditsOpen: boolean;
  hostSettingsOpen: boolean;

  openOrgSettings: () => void;
  closeOrgSettings: () => void;
  openOrgBilling: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openBuyCredits: () => void;
  closeBuyCredits: () => void;
  openHostSettings: () => void;
  closeHostSettings: () => void;
}

export const useUIModalStore = create<UIModalState>()((set) => ({
  orgSettingsOpen: false,
  orgInitialSection: undefined,
  settingsOpen: false,
  buyCreditsOpen: false,
  hostSettingsOpen: false,

  openOrgSettings: () => set({ orgSettingsOpen: true }),
  closeOrgSettings: () => set({ orgSettingsOpen: false, orgInitialSection: undefined }),
  openOrgBilling: () => set({ orgSettingsOpen: true, orgInitialSection: "billing" }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openBuyCredits: () => set({ buyCreditsOpen: true }),
  closeBuyCredits: () => set({ buyCreditsOpen: false }),
  openHostSettings: () => set({ hostSettingsOpen: true }),
  closeHostSettings: () => set({ hostSettingsOpen: false }),
}));

if (typeof window !== "undefined") {
  window.addEventListener(INSUFFICIENT_CREDITS_EVENT, () => {
    useUIModalStore.getState().openBuyCredits();
  });
}

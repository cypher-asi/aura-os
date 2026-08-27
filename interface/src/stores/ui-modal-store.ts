import { create } from "zustand";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";

// Sections the settings modal can be deep-linked to. Matches the relevant
// members of `Section` in `OrgSettingsPanel/useOrgSettingsData.ts` (kept as a
// local union so the store doesn't depend on the component).
export type OrgInitialSection = "general" | "billing" | "appearance";

interface UIModalState {
  orgSettingsOpen: boolean;
  orgInitialSection: OrgInitialSection | undefined;
  // Sub-area to open within a drill-down section (e.g. Theme's "background").
  orgInitialSubArea: string | undefined;
  buyCreditsOpen: boolean;
  hostSettingsOpen: boolean;
  appsModalOpen: boolean;
  inviteModalOpen: boolean;
  changelogModalOpen: boolean;
  downloadsModalOpen: boolean;
  commandPaletteOpen: boolean;

  openOrgSettings: () => void;
  closeOrgSettings: () => void;
  openOrgBilling: () => void;
  /** Opens settings to the Theme section (drill-down). */
  openOrgTheme: () => void;
  /** Opens settings to Theme > Background. */
  openOrgBackground: () => void;
  openBuyCredits: () => void;
  closeBuyCredits: () => void;
  openHostSettings: () => void;
  closeHostSettings: () => void;
  openAppsModal: () => void;
  closeAppsModal: () => void;
  openInviteModal: () => void;
  closeInviteModal: () => void;
  openChangelog: () => void;
  closeChangelog: () => void;
  openDownloads: () => void;
  closeDownloads: () => void;
  toggleCommandPalette: () => void;
  closeCommandPalette: () => void;
  reset: () => void;
}

const CLOSED_MODAL_STATE = {
  orgSettingsOpen: false,
  orgInitialSection: undefined,
  orgInitialSubArea: undefined,
  buyCreditsOpen: false,
  hostSettingsOpen: false,
  appsModalOpen: false,
  inviteModalOpen: false,
  changelogModalOpen: false,
  downloadsModalOpen: false,
  commandPaletteOpen: false,
} as const;

export const useUIModalStore = create<UIModalState>()((set) => ({
  ...CLOSED_MODAL_STATE,

  openOrgSettings: () => set({ orgSettingsOpen: true, orgInitialSection: "general", orgInitialSubArea: undefined }),
  closeOrgSettings: () => set({ orgSettingsOpen: false, orgInitialSection: undefined, orgInitialSubArea: undefined }),
  openOrgBilling: () => set({ orgSettingsOpen: true, orgInitialSection: "billing", orgInitialSubArea: undefined }),
  openOrgTheme: () => set({ orgSettingsOpen: true, orgInitialSection: "appearance", orgInitialSubArea: undefined }),
  openOrgBackground: () => set({ orgSettingsOpen: true, orgInitialSection: "appearance", orgInitialSubArea: "background" }),
  openBuyCredits: () => set({ buyCreditsOpen: true }),
  closeBuyCredits: () => set({ buyCreditsOpen: false }),
  openHostSettings: () => set({ hostSettingsOpen: true }),
  closeHostSettings: () => set({ hostSettingsOpen: false }),
  openAppsModal: () => set({ appsModalOpen: true }),
  closeAppsModal: () => set({ appsModalOpen: false }),
  openInviteModal: () => set({ inviteModalOpen: true }),
  closeInviteModal: () => set({ inviteModalOpen: false }),
  openChangelog: () => set({ changelogModalOpen: true }),
  closeChangelog: () => set({ changelogModalOpen: false }),
  openDownloads: () => set({ downloadsModalOpen: true }),
  closeDownloads: () => set({ downloadsModalOpen: false }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  // Closes every modal at once. Used on logout so an open overlay (e.g. the
  // settings panel) doesn't linger over the public page after the session ends.
  reset: () => set({ ...CLOSED_MODAL_STATE }),
}));

if (typeof window !== "undefined") {
  window.addEventListener(INSUFFICIENT_CREDITS_EVENT, () => {
    useUIModalStore.getState().openBuyCredits();
  });
}

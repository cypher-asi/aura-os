import { describe, it, expect, beforeEach } from "vitest";
import { useUIModalStore } from "./ui-modal-store";

beforeEach(() => {
  useUIModalStore.setState({
    orgSettingsOpen: false,
    orgInitialSection: undefined,
    buyCreditsOpen: false,
    hostSettingsOpen: false,
    appsModalOpen: false,
    commandPaletteOpen: false,
  });
});

describe("ui-modal-store", () => {
  describe("initial state", () => {
    it("all modals are closed", () => {
      const s = useUIModalStore.getState();
      expect(s.orgSettingsOpen).toBe(false);
      expect(s.buyCreditsOpen).toBe(false);
      expect(s.hostSettingsOpen).toBe(false);
      expect(s.commandPaletteOpen).toBe(false);
    });
  });

  describe("openOrgSettings / closeOrgSettings", () => {
    it("opens org settings", () => {
      useUIModalStore.getState().openOrgSettings();
      expect(useUIModalStore.getState().orgSettingsOpen).toBe(true);
      expect(useUIModalStore.getState().orgInitialSection).toBe("general");
    });

    it("closes org settings and clears initialSection", () => {
      useUIModalStore.setState({ orgSettingsOpen: true, orgInitialSection: "billing" });
      useUIModalStore.getState().closeOrgSettings();
      expect(useUIModalStore.getState().orgSettingsOpen).toBe(false);
      expect(useUIModalStore.getState().orgInitialSection).toBeUndefined();
    });
  });

  describe("openOrgBilling", () => {
    it("opens org settings with billing section", () => {
      useUIModalStore.getState().openOrgBilling();
      expect(useUIModalStore.getState().orgSettingsOpen).toBe(true);
      expect(useUIModalStore.getState().orgInitialSection).toBe("billing");
    });
  });

  describe("openOrgTheme", () => {
    it("opens org settings to the Theme (appearance) section", () => {
      useUIModalStore.getState().openOrgTheme();
      const s = useUIModalStore.getState();
      expect(s.orgSettingsOpen).toBe(true);
      expect(s.orgInitialSection).toBe("appearance");
      expect(s.orgInitialSubArea).toBeUndefined();
    });
  });

  describe("openOrgBackground", () => {
    it("opens org settings to Theme > Background", () => {
      useUIModalStore.getState().openOrgBackground();
      const s = useUIModalStore.getState();
      expect(s.orgSettingsOpen).toBe(true);
      expect(s.orgInitialSection).toBe("appearance");
      expect(s.orgInitialSubArea).toBe("background");
    });

    it("clears the sub-area on close", () => {
      useUIModalStore.getState().openOrgBackground();
      useUIModalStore.getState().closeOrgSettings();
      expect(useUIModalStore.getState().orgInitialSubArea).toBeUndefined();
    });
  });

  describe("openBuyCredits / closeBuyCredits", () => {
    it("opens buy credits", () => {
      useUIModalStore.getState().openBuyCredits();
      expect(useUIModalStore.getState().buyCreditsOpen).toBe(true);
    });

    it("closes buy credits", () => {
      useUIModalStore.setState({ buyCreditsOpen: true });
      useUIModalStore.getState().closeBuyCredits();
      expect(useUIModalStore.getState().buyCreditsOpen).toBe(false);
    });
  });

  describe("openHostSettings / closeHostSettings", () => {
    it("opens host settings", () => {
      useUIModalStore.getState().openHostSettings();
      expect(useUIModalStore.getState().hostSettingsOpen).toBe(true);
    });

    it("closes host settings", () => {
      useUIModalStore.setState({ hostSettingsOpen: true });
      useUIModalStore.getState().closeHostSettings();
      expect(useUIModalStore.getState().hostSettingsOpen).toBe(false);
    });
  });

  describe("openAppsModal / closeAppsModal", () => {
    it("opens the apps modal", () => {
      useUIModalStore.getState().openAppsModal();
      expect(useUIModalStore.getState().appsModalOpen).toBe(true);
    });

    it("closes the apps modal", () => {
      useUIModalStore.setState({ appsModalOpen: true });
      useUIModalStore.getState().closeAppsModal();
      expect(useUIModalStore.getState().appsModalOpen).toBe(false);
    });
  });

  describe("toggleCommandPalette / closeCommandPalette", () => {
    it("toggles and closes the command palette", () => {
      useUIModalStore.getState().toggleCommandPalette();
      expect(useUIModalStore.getState().commandPaletteOpen).toBe(true);

      useUIModalStore.getState().toggleCommandPalette();
      expect(useUIModalStore.getState().commandPaletteOpen).toBe(false);

      useUIModalStore.setState({ commandPaletteOpen: true });
      useUIModalStore.getState().closeCommandPalette();
      expect(useUIModalStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  describe("reset", () => {
    it("closes every open modal and clears initialSection", () => {
      useUIModalStore.setState({
        orgSettingsOpen: true,
        orgInitialSection: "billing",
        buyCreditsOpen: true,
        hostSettingsOpen: true,
        appsModalOpen: true,
        inviteModalOpen: true,
        commandPaletteOpen: true,
      });

      useUIModalStore.getState().reset();

      const s = useUIModalStore.getState();
      expect(s.orgSettingsOpen).toBe(false);
      expect(s.orgInitialSection).toBeUndefined();
      expect(s.buyCreditsOpen).toBe(false);
      expect(s.hostSettingsOpen).toBe(false);
      expect(s.appsModalOpen).toBe(false);
      expect(s.inviteModalOpen).toBe(false);
      expect(s.commandPaletteOpen).toBe(false);
    });
  });
});

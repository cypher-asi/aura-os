import { describe, it, expect, beforeEach } from "vitest";
import { useUIModalStore } from "./ui-modal-store";

beforeEach(() => {
  useUIModalStore.setState({
    orgSettingsOpen: false,
    orgInitialSection: undefined,
    settingsOpen: false,
    buyCreditsOpen: false,
    hostSettingsOpen: false,
  });
});

describe("ui-modal-store", () => {
  describe("initial state", () => {
    it("all modals are closed", () => {
      const s = useUIModalStore.getState();
      expect(s.orgSettingsOpen).toBe(false);
      expect(s.settingsOpen).toBe(false);
      expect(s.buyCreditsOpen).toBe(false);
      expect(s.hostSettingsOpen).toBe(false);
    });
  });

  describe("openOrgSettings / closeOrgSettings", () => {
    it("opens org settings", () => {
      useUIModalStore.getState().openOrgSettings();
      expect(useUIModalStore.getState().orgSettingsOpen).toBe(true);
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

  describe("openSettings / closeSettings", () => {
    it("opens settings", () => {
      useUIModalStore.getState().openSettings();
      expect(useUIModalStore.getState().settingsOpen).toBe(true);
    });

    it("closes settings", () => {
      useUIModalStore.setState({ settingsOpen: true });
      useUIModalStore.getState().closeSettings();
      expect(useUIModalStore.getState().settingsOpen).toBe(false);
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
});

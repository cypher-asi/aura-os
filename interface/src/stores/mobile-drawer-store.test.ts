import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useMobileDrawerStore,
  selectDrawerOpen,
  selectOverlayDrawerOpen,
} from "./mobile-drawer-store";

beforeEach(() => {
  useMobileDrawerStore.setState({
    navOpen: false,
    appOpen: false,
    previewOpen: false,
    accountOpen: false,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mobile-drawer-store", () => {
  describe("initial state", () => {
    it("all drawers are closed", () => {
      const s = useMobileDrawerStore.getState();
      expect(s.navOpen).toBe(false);
      expect(s.appOpen).toBe(false);
      expect(s.previewOpen).toBe(false);
      expect(s.accountOpen).toBe(false);
    });
  });

  describe("setNavOpen", () => {
    it("opens the nav drawer", () => {
      useMobileDrawerStore.getState().setNavOpen(true);
      expect(useMobileDrawerStore.getState().navOpen).toBe(true);
    });
  });

  describe("setPreviewOpen", () => {
    it("opens the preview drawer", () => {
      useMobileDrawerStore.getState().setPreviewOpen(true);
      expect(useMobileDrawerStore.getState().previewOpen).toBe(true);
    });
  });

  describe("setAccountOpen", () => {
    it("opens the account drawer", () => {
      useMobileDrawerStore.getState().setAccountOpen(true);
      expect(useMobileDrawerStore.getState().accountOpen).toBe(true);
    });
  });

  describe("closeDrawers", () => {
    it("closes all drawers", () => {
      useMobileDrawerStore.setState({ navOpen: true, appOpen: true, previewOpen: true, accountOpen: true });
      useMobileDrawerStore.getState().closeDrawers();
      const s = useMobileDrawerStore.getState();
      expect(s.navOpen).toBe(false);
      expect(s.appOpen).toBe(false);
      expect(s.previewOpen).toBe(false);
      expect(s.accountOpen).toBe(false);
    });
  });

  describe("openAfterDrawerClose", () => {
    it("calls the callback after a delay", () => {
      useMobileDrawerStore.setState({ navOpen: true });
      const cb = vi.fn();
      useMobileDrawerStore.getState().openAfterDrawerClose(cb);

      expect(useMobileDrawerStore.getState().navOpen).toBe(false);
      expect(cb).not.toHaveBeenCalled();

      vi.advanceTimersByTime(180);
      expect(cb).toHaveBeenCalledOnce();
    });
  });

  describe("selectDrawerOpen", () => {
    it("returns true when any drawer is open", () => {
      const s = { ...useMobileDrawerStore.getState(), navOpen: true };
      expect(selectDrawerOpen(s)).toBe(true);
    });

    it("returns false when all drawers are closed", () => {
      expect(selectDrawerOpen(useMobileDrawerStore.getState())).toBe(false);
    });
  });

  describe("selectOverlayDrawerOpen", () => {
    it("returns true when account drawer is open", () => {
      const s = { ...useMobileDrawerStore.getState(), accountOpen: true };
      expect(selectOverlayDrawerOpen(s)).toBe(true);
    });
  });
});

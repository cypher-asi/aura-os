import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuraCapabilities } from "./use-aura-capabilities";
import { useSidekick } from "../stores/sidekick-store";

function previewItemKey(item: ReturnType<typeof useSidekick>["previewItem"]): string | null {
  if (!item) return null;
  switch (item.kind) {
    case "spec":
      return `spec:${item.spec.spec_id}`;
    case "specs_overview":
      return `specs:${item.specs.map((spec) => spec.spec_id).join(",")}`;
    case "task":
      return `task:${item.task.task_id}`;
    case "session":
      return `session:${item.session.session_id}`;
    case "log":
      return `log:${item.entry.timestamp}:${item.entry.summary}`;
  }
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

export interface MobileDrawerState {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
  accountOpen: boolean;
  setAccountOpen: (open: boolean) => void;
  hostSettingsOpen: boolean;
  setHostSettingsOpen: (open: boolean) => void;
  drawerOpen: boolean;
  overlayDrawerOpen: boolean;
  closeDrawers: () => void;
  openAfterDrawerClose: (callback: () => void) => void;
}

/**
 * Manages the mobile drawer states (nav, preview, account, host settings)
 * and auto-closes them on route change or when preview items change.
 */
export function useMobileDrawers(hasPreviewPanel: boolean): MobileDrawerState {
  const { isMobileLayout } = useAuraCapabilities();
  const { previewItem } = useSidekick();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const lastPreviewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isMobileLayout) return;
    const frame = window.requestAnimationFrame(() => {
      setNavOpen(false);
      setPreviewOpen(false);
      setAccountOpen(false);
      setHostSettingsOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMobileLayout, location.pathname]);

  useEffect(() => {
    if (!isMobileLayout) return;
    if (!hasPreviewPanel || !previewItem) {
      const frame = window.requestAnimationFrame(() => setPreviewOpen(false));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [hasPreviewPanel, isMobileLayout, previewItem]);

  useEffect(() => {
    if (!isMobileLayout) return;
    const key = previewItemKey(previewItem);

    if (!hasPreviewPanel || !key) {
      lastPreviewKeyRef.current = null;
      return;
    }

    if (lastPreviewKeyRef.current === key) {
      return;
    }

    lastPreviewKeyRef.current = key;
    const frame = window.requestAnimationFrame(() => {
      setAccountOpen(false);
      setPreviewOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasPreviewPanel, isMobileLayout, previewItem]);

  const drawerOpen = navOpen || previewOpen || accountOpen || hostSettingsOpen;
  const overlayDrawerOpen = navOpen || previewOpen || accountOpen;

  const closeDrawers = useCallback(() => {
    blurActiveElement();
    setNavOpen(false);
    setPreviewOpen(false);
    setAccountOpen(false);
  }, []);

  const openAfterDrawerClose = useCallback((callback: () => void) => {
    closeDrawers();
    window.setTimeout(callback, 180);
  }, [closeDrawers]);

  return {
    navOpen,
    setNavOpen,
    previewOpen,
    setPreviewOpen,
    accountOpen,
    setAccountOpen,
    hostSettingsOpen,
    setHostSettingsOpen,
    drawerOpen,
    overlayDrawerOpen,
    closeDrawers,
    openAfterDrawerClose,
  };
}

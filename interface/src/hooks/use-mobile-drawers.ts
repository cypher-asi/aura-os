import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuraCapabilities } from "./use-aura-capabilities";
import { useSidekick } from "../stores/sidekick-store";
import { useMobileDrawerStore } from "../stores/mobile-drawer-store";
import { useUIModalStore } from "../stores/ui-modal-store";

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

/**
 * Runs side-effects that auto-close mobile drawers on route change
 * or when preview items change. Call once in MobileShell.
 */
export function useMobileDrawerEffects(hasPreviewPanel: boolean): void {
  const { isMobileLayout } = useAuraCapabilities();
  const { previewItem } = useSidekick();
  const location = useLocation();
  const lastPreviewKeyRef = useRef<string | null>(null);

  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const setPreviewOpen = useMobileDrawerStore((s) => s.setPreviewOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const closeHostSettings = useUIModalStore((s) => s.closeHostSettings);

  useEffect(() => {
    if (!isMobileLayout) return;
    const frame = window.requestAnimationFrame(() => {
      setNavOpen(false);
      setPreviewOpen(false);
      setAccountOpen(false);
      closeHostSettings();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMobileLayout, location.pathname, setNavOpen, setPreviewOpen, setAccountOpen, closeHostSettings]);

  useEffect(() => {
    if (!isMobileLayout) return;
    if (!hasPreviewPanel || !previewItem) {
      const frame = window.requestAnimationFrame(() => setPreviewOpen(false));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [hasPreviewPanel, isMobileLayout, previewItem, setPreviewOpen]);

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
  }, [hasPreviewPanel, isMobileLayout, previewItem, setAccountOpen, setPreviewOpen]);
}

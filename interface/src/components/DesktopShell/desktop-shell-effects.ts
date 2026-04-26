import { useEffect, useLayoutEffect, type RefObject } from "react";
import type { LaneResizeControls } from "../Lane";
import { getSidekickTargetWidth } from "./desktop-shell-sidekick";

export function useLeftPanelWidthCssVar({
  leftPanelRef,
  isDesktop,
  activeAppId,
}: {
  leftPanelRef: RefObject<HTMLDivElement | null>;
  isDesktop: boolean;
  activeAppId: string;
}): void {
  // Measure before paint on app switches; this CSS var drives centered panels.
  useLayoutEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    const width = Math.round(el.getBoundingClientRect().width);
    document.documentElement.style.setProperty("--left-panel-width", `${width}px`);
  }, [leftPanelRef, isDesktop, activeAppId]);

  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    let lastWidth = -1;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      const nextWidth = Math.round(rawWidth);
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      document.documentElement.style.setProperty("--left-panel-width", `${nextWidth}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [leftPanelRef]);
}

export function useSidekickWidthRetargeting({
  activeAppId,
  sidekickCollapsed,
  mainPanelEl,
  sidekickResizeControlsRef,
  appliedSidekickAppIdRef,
}: {
  activeAppId: string;
  sidekickCollapsed: boolean;
  mainPanelEl: HTMLDivElement | null;
  sidekickResizeControlsRef: RefObject<LaneResizeControls | null>;
  appliedSidekickAppIdRef: RefObject<string | null>;
}): void {
  // Retarget the sidekick Lane whenever the active app changes so each app
  // restores the width the user chose for it. The first render is covered by
  // Lane's defaultWidth; later runs retry until the main panel has non-zero width.
  useLayoutEffect(() => {
    if (appliedSidekickAppIdRef.current === null) {
      appliedSidekickAppIdRef.current = activeAppId;
      return;
    }
    if (appliedSidekickAppIdRef.current === activeAppId) return;
    if (!mainPanelEl) return;
    const sidekickResizeControls = sidekickResizeControlsRef.current;
    if (!sidekickResizeControls) return;

    const mainWidth = Math.round(mainPanelEl.getBoundingClientRect().width);
    if (mainWidth <= 0) {
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        if (appliedSidekickAppIdRef.current === activeAppId) {
          observer.disconnect();
          return;
        }
        const controls = sidekickResizeControlsRef.current;
        if (!controls) return;
        const observedWidth = Math.round(mainPanelEl.getBoundingClientRect().width);
        if (observedWidth <= 0) return;
        const currentSidekickWidth = sidekickCollapsed ? 0 : controls.getSize();
        controls.setSize(
          getSidekickTargetWidth(activeAppId, {
            mainWidth: observedWidth,
            currentSidekickWidth,
          }),
        );
        appliedSidekickAppIdRef.current = activeAppId;
        observer.disconnect();
      });
      observer.observe(mainPanelEl);
      return () => observer.disconnect();
    }

    const currentSidekickWidth = sidekickCollapsed
      ? 0
      : sidekickResizeControls.getSize();
    sidekickResizeControls.setSize(
      getSidekickTargetWidth(activeAppId, {
        mainWidth,
        currentSidekickWidth,
      }),
    );
    appliedSidekickAppIdRef.current = activeAppId;
  }, [
    activeAppId,
    appliedSidekickAppIdRef,
    mainPanelEl,
    sidekickCollapsed,
    sidekickResizeControlsRef,
  ]);
}

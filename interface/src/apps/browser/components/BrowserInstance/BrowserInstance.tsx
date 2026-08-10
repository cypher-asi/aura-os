import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProjectBrowserSettings,
  triggerBrowserDetect,
  updateProjectBrowserSettings,
  type BrowserClientMsg,
  type DesignElement,
  type DetectedUrl,
  type InspectionResult,
  type NavError,
  type NavState,
  type ProjectBrowserSettings,
} from "../../../../shared/api/browser";
import { useBrowser } from "../../../../hooks/use-browser";
import { useBrowserPanelStore } from "../../../../stores/browser-panel-store";
import { BrowserAddressBar } from "../BrowserAddressBar";
import { BrowserDesignInspector } from "../BrowserDesignInspector";
import { BrowserErrorOverlay } from "../BrowserErrorOverlay";
import { BrowserViewport } from "../BrowserViewport";
import type { BrowserWorkerInMsg } from "../../../../workers/browser-frame-worker";
import styles from "./BrowserInstance.module.css";
import type { BrowserMode } from "../../design-mode";

export interface BrowserInstanceProps {
  clientId: string;
  projectId?: string;
  width: number;
  height: number;
  mode?: BrowserMode;
  deviceFrame?: boolean;
}

/**
 * Translate backend spawn failures into a short, user-readable message.
 * The structured error codes come from `aura_os_browser::Error` via the
 * REST layer's JSON payload.
 */
function friendlyBrowserError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (
    msg.includes("chromium_launch") ||
    msg.includes("chrome") ||
    msg.includes("no such file")
  ) {
    return "Could not start Chromium. Install Google Chrome or Chromium, or set BROWSER_EXECUTABLE_PATH.";
  }
  if (msg.includes("network") || msg.includes("websocket")) {
    return "Lost connection to the browser backend. Retrying…";
  }
  return err.message || "Failed to start browser session.";
}

function mergeDetected(
  settings: ProjectBrowserSettings | undefined,
  extra: DetectedUrl[],
): DetectedUrl[] {
  const base = settings?.detected_urls ?? [];
  const seen = new Set<string>();
  const out: DetectedUrl[] = [];
  for (const entry of [...extra, ...base]) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }
  return out;
}

export function BrowserInstance({
  clientId,
  projectId,
  width,
  height,
  mode = "preview",
  deviceFrame = false,
}: BrowserInstanceProps) {
  const setServerId = useBrowserPanelStore((s) => s.setServerId);
  const setProjectSettings = useBrowserPanelStore((s) => s.setProjectSettings);
  const cachedSettings = useBrowserPanelStore((s) =>
    projectId ? s.perProjectSettings[projectId] : undefined,
  );

  const workerRef = useRef<Worker | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
  const [navError, setNavError] = useState<NavError | null>(null);
  const [recentDetected, setRecentDetected] = useState<DetectedUrl[]>([]);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [hoveredElement, setHoveredElement] = useState<DesignElement | null>(
    null,
  );
  const [selectedElement, setSelectedElement] = useState<DesignElement | null>(
    null,
  );
  const latestInspectionRef = useRef(0);

  const handleWorkerReady = useCallback((worker: Worker) => {
    workerRef.current = worker;
  }, []);

  const handleFrame = useCallback(
    (frame: {
      seq: number;
      width: number;
      height: number;
      jpeg: Uint8Array;
    }) => {
      const worker = workerRef.current;
      if (!worker) return;
      const copy = new Uint8Array(frame.jpeg.byteLength);
      copy.set(frame.jpeg);
      const payload: BrowserWorkerInMsg = {
        type: "frame",
        jpeg: copy.buffer,
        width: frame.width,
        height: frame.height,
      };
      worker.postMessage(payload, [copy.buffer]);
    },
    [],
  );

  const handleNav = useCallback((state: NavState) => {
    setNav(state);
    setHoveredElement(null);
    setSelectedElement(null);
    // After a main-frame failure Chromium commits its own native error
    // document at a `chrome-error://...` URL and re-fires `Nav` for it;
    // clearing the overlay on that event would wipe it just as we set
    // it, leaving the user staring at Chromium's page. So only clear
    // when the new URL is a real document — that's the success signal
    // we want, and it's also what lets the overlay survive across a
    // user-driven Reload (the URL doesn't change, so we never clear
    // until the retry actually commits a real page).
    if (state.url && !state.url.startsWith("chrome-error://")) {
      setNavError(null);
    }
  }, []);

  const handleNavError = useCallback((err: NavError) => {
    setNavError(err);
  }, []);

  const handleInspection = useCallback((inspection: InspectionResult) => {
    if (inspection.request_id < latestInspectionRef.current) return;
    latestInspectionRef.current = inspection.request_id;
    if (inspection.kind === "select") {
      setSelectedElement(inspection.element);
      setHoveredElement(inspection.element);
    } else {
      setHoveredElement(inspection.element);
    }
  }, []);

  const browser = useBrowser({
    width,
    height,
    projectId,
    onFrame: handleFrame,
    onNav: handleNav,
    onNavError: handleNavError,
    onInspection: handleInspection,
    onSpawned: (resp) => {
      setServerId(clientId, resp.id);
      setSpawnError(null);
    },
    onError: (err) => {
      setSpawnError(friendlyBrowserError(err));
    },
  });

  const browserSend = browser.send;
  const browserConnected = browser.connected;
  useEffect(() => {
    if (!browserConnected) return;
    browserSend({ type: "resize", width, height });
  }, [browserConnected, browserSend, width, height]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void getProjectBrowserSettings(projectId)
      .then((settings) => {
        if (cancelled) return;
        setProjectSettings(projectId, settings);
      })
      .catch(() => {
        // Best-effort; fall through with cached / empty settings.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setProjectSettings]);

  /**
   * Run a user-initiated browser command and dismiss any error overlay
   * first. Used for actions that point at a *different* document
   * (URL submit, back/forward) so the overlay doesn't linger over the
   * incoming page; a subsequent `NavError` from the backend re-opens
   * it.
   *
   * Reload is intentionally NOT routed through here — see
   * `handleReload` below for why.
   */
  const clearNavErrorAnd = useCallback(
    (msg: BrowserClientMsg) => {
      setNavError(null);
      browser.send(msg);
    },
    [browser],
  );

  /**
   * Reload retries the *same* URL, so the screencast still holds
   * Chromium's just-committed `chrome-error://` document. Eagerly
   * clearing `navError` here would reveal that native error page until
   * the retry produces a new event, which is exactly the regression
   * the user sees as "the old/wrong 404 page flashes through". Keep
   * the overlay up; `handleNav` clears it once a real (non-
   * `chrome-error://`) URL commits, and a re-failed retry simply
   * replaces it via `handleNavError`.
   */
  const handleReload = useCallback(() => {
    browser.send({ type: "reload" });
  }, [browser]);

  const handleSubmit = useCallback(
    (url: string) => {
      clearNavErrorAnd({ type: "navigate", url });
    },
    [clearNavErrorAnd],
  );

  const handlePin = useCallback(
    async (url: string) => {
      if (!projectId) return;
      const updated = await updateProjectBrowserSettings(projectId, {
        pinned_url: url,
      });
      setProjectSettings(projectId, updated);
    },
    [projectId, setProjectSettings],
  );

  const handleUnpin = useCallback(async () => {
    if (!projectId) return;
    const updated = await updateProjectBrowserSettings(projectId, {
      pinned_url: null,
    });
    setProjectSettings(projectId, updated);
  }, [projectId, setProjectSettings]);

  const handleSelectDetected = useCallback(
    (url: string) => {
      clearNavErrorAnd({ type: "navigate", url });
    },
    [clearNavErrorAnd],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void triggerBrowserDetect(projectId)
      .then((detected) => {
        if (cancelled || detected.length === 0) return;
        setRecentDetected((prev) =>
          mergeDetected(
            { detected_urls: prev } as ProjectBrowserSettings,
            detected,
          ),
        );
      })
      .catch(() => {
        // Detection is advisory; ignore failures silently.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const detectedUrls = useMemo(
    () => mergeDetected(cachedSettings, recentDetected),
    [cachedSettings, recentDetected],
  );

  const barValue = nav?.url ?? browser.initialUrl ?? "";

  return (
    <div className={styles.root}>
      <BrowserAddressBar
        value={barValue}
        autoFocus={browser.focusAddressBar}
        loading={nav?.loading}
        canGoBack={nav?.can_go_back}
        canGoForward={nav?.can_go_forward}
        pinnedUrl={cachedSettings?.pinned_url ?? null}
        detectedUrls={detectedUrls}
        onSubmit={handleSubmit}
        onBack={() => clearNavErrorAnd({ type: "back" })}
        onForward={() => clearNavErrorAnd({ type: "forward" })}
        onReload={handleReload}
        onPin={handlePin}
        onUnpin={handleUnpin}
        onSelectDetected={handleSelectDetected}
      />
      <BrowserViewport
        width={width}
        height={height}
        onWorkerReady={handleWorkerReady}
        onClientMsg={browser.send}
        designMode={mode === "design"}
        hoveredElement={hoveredElement}
        selectedElement={selectedElement}
        deviceFrame={deviceFrame}
        placeholder={
          spawnError
            ? spawnError
            : browser.connected
              ? undefined
              : browser.spawning
                ? "Starting browser session…"
                : "Connecting…"
        }
        overlay={
          navError ? (
            <BrowserErrorOverlay error={navError} onReload={handleReload} />
          ) : mode === "design" ? (
            <BrowserDesignInspector
              element={selectedElement}
              projectId={projectId}
              onClear={() => setSelectedElement(null)}
            />
          ) : null
        }
      />
    </div>
  );
}

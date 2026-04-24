import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProjectBrowserSettings,
  triggerBrowserDetect,
  updateProjectBrowserSettings,
  type DetectedUrl,
  type NavError,
  type NavState,
  type ProjectBrowserSettings,
} from "../../api/browser";
import { useBrowser } from "../../hooks/use-browser";
import { useBrowserPanelStore } from "../../stores/browser-panel-store";
import { BrowserAddressBar } from "../BrowserAddressBar";
import { BrowserErrorOverlay } from "../BrowserErrorOverlay";
import { BrowserViewport } from "../BrowserViewport";
import type { BrowserWorkerInMsg } from "../../workers/browser-frame-worker";
import styles from "./BrowserInstance.module.css";

export interface BrowserInstanceProps {
  clientId: string;
  projectId?: string;
  width: number;
  height: number;
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

  const handleWorkerReady = useCallback((worker: Worker) => {
    workerRef.current = worker;
  }, []);

  const handleFrame = useCallback(
    (frame: { seq: number; width: number; height: number; jpeg: Uint8Array }) => {
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
    // A successful navigation (loading=true) signals recovery from any
    // prior failure: clear the overlay so the new page can paint. A
    // subsequent `NavError` will re-open it.
    if (state.loading) {
      setNavError(null);
    }
  }, []);

  const handleNavError = useCallback((err: NavError) => {
    setNavError(err);
  }, []);

  const browser = useBrowser({
    width,
    height,
    projectId,
    onFrame: handleFrame,
    onNav: handleNav,
    onNavError: handleNavError,
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

  const handleSubmit = useCallback(
    (url: string) => {
      browser.send({ type: "navigate", url });
    },
    [browser],
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
      browser.send({ type: "navigate", url });
    },
    [browser],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void triggerBrowserDetect(projectId)
      .then((detected) => {
        if (cancelled || detected.length === 0) return;
        setRecentDetected((prev) => mergeDetected({ detected_urls: prev } as ProjectBrowserSettings, detected));
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
        onBack={() => browser.send({ type: "back" })}
        onForward={() => browser.send({ type: "forward" })}
        onReload={() => browser.send({ type: "reload" })}
        onPin={handlePin}
        onUnpin={handleUnpin}
        onSelectDetected={handleSelectDetected}
      />
      <BrowserViewport
        width={width}
        height={height}
        onWorkerReady={handleWorkerReady}
        onClientMsg={browser.send}
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
            <BrowserErrorOverlay
              error={navError}
              onReload={() => browser.send({ type: "reload" })}
            />
          ) : null
        }
      />
    </div>
  );
}

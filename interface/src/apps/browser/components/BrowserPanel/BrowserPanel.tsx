import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowserPanelStore } from "../../../../stores/browser-panel-store";
import { BrowserInstance } from "../BrowserInstance";
import { BrowserDesignToolbar } from "../BrowserDesignToolbar";
import { BrowserInstanceTabs } from "../BrowserInstanceTabs";
import {
  getViewportPreset,
  type BrowserMode,
  type ViewportPresetId,
} from "../../design-mode";
import styles from "./BrowserPanel.module.css";

export interface BrowserPanelProps {
  projectId?: string;
  remoteAgentId?: string;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

export function BrowserPanel({ projectId, remoteAgentId }: BrowserPanelProps) {
  const { instances, activeClientId, addInstance, removeInstance, setActive } =
    useBrowserPanelStore(
      useShallow((s) => ({
        instances: s.instances,
        activeClientId: s.activeClientId,
        addInstance: s.addInstance,
        removeInstance: s.removeInstance,
        setActive: s.setActive,
      })),
    );

  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  const [mode, setMode] = useState<BrowserMode>("preview");
  const [viewportPreset, setViewportPreset] = useState<ViewportPresetId>("fit");

  useLayoutEffect(() => {
    if (instances.length === 0) {
      addInstance();
    }
  }, [instances.length, addInstance]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const preset = getViewportPreset(viewportPreset);
  const viewportWidth = preset.width ?? Math.max(64, size.width);
  // The address bar participates in BrowserInstance's flex layout; reserve
  // its compact row so Fit maps one CSS pixel to one preview pixel.
  const viewportHeight = preset.height ?? Math.max(64, size.height - 36);

  return (
    <div className={styles.root}>
      <BrowserInstanceTabs
        instances={instances}
        activeClientId={activeClientId}
        onActivate={setActive}
        onClose={removeInstance}
        onAdd={() => addInstance()}
      />
      <BrowserDesignToolbar
        mode={mode}
        viewportPreset={viewportPreset}
        onModeChange={setMode}
        onViewportPresetChange={setViewportPreset}
      />
      <div className={styles.body} ref={bodyRef}>
        {instances.length === 0 ? (
          <div className={styles.empty}>No browser tabs</div>
        ) : (
          instances.map((instance) => (
            <div
              key={`${instance.clientId}:${remoteAgentId ?? "local"}`}
              className={styles.panel}
              style={{
                visibility:
                  instance.clientId === activeClientId ? "visible" : "hidden",
                pointerEvents:
                  instance.clientId === activeClientId ? "auto" : "none",
              }}
            >
              <BrowserInstance
                clientId={instance.clientId}
                projectId={projectId}
                remoteAgentId={remoteAgentId}
                width={viewportWidth}
                height={viewportHeight}
                mode={mode}
                deviceFrame={viewportPreset !== "fit"}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

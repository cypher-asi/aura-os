import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowserPanelStore } from "../../../../stores/browser-panel-store";
import { BrowserInstance } from "../BrowserInstance";
import { BrowserInstanceTabs } from "../BrowserInstanceTabs";
import styles from "./BrowserPanel.module.css";

export interface BrowserPanelProps {
  projectId?: string;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

export function BrowserPanel({ projectId }: BrowserPanelProps) {
  const {
    instances,
    activeClientId,
    addInstance,
    removeInstance,
    setActive,
  } = useBrowserPanelStore(
    useShallow((s) => ({
      instances: s.instances,
      activeClientId: s.activeClientId,
      addInstance: s.addInstance,
      removeInstance: s.removeInstance,
      setActive: s.setActive,
    })),
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

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

  return (
    <div className={styles.root}>
      <BrowserInstanceTabs
        instances={instances}
        activeClientId={activeClientId}
        onActivate={setActive}
        onClose={removeInstance}
        onAdd={() => addInstance()}
      />
      <div className={styles.body} ref={bodyRef}>
        {instances.length === 0 ? (
          <div className={styles.empty}>No browser tabs</div>
        ) : (
          instances.map((instance) => (
            <div
              key={instance.clientId}
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
                width={size.width}
                height={size.height}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

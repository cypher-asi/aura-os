import { X, Plus } from "lucide-react";
import type { BrowserInstance } from "../../stores/browser-panel-store";
import styles from "./BrowserInstanceTabs.module.css";

export interface BrowserInstanceTabsProps {
  instances: BrowserInstance[];
  activeClientId: string | null;
  onActivate: (clientId: string) => void;
  onClose: (clientId: string) => void;
  onAdd: () => void;
}

export function BrowserInstanceTabs({
  instances,
  activeClientId,
  onActivate,
  onClose,
  onAdd,
}: BrowserInstanceTabsProps) {
  return (
    <div className={styles.root} role="tablist">
      {instances.map((instance) => {
        const active = instance.clientId === activeClientId;
        return (
          <button
            key={instance.clientId}
            type="button"
            role="tab"
            aria-current={active ? "page" : undefined}
            aria-selected={active}
            className={styles.tab}
            onClick={() => onActivate(instance.clientId)}
          >
            <span className={styles.title}>{instance.title}</span>
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${instance.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(instance.clientId);
              }}
            >
              <X size={12} />
            </button>
          </button>
        );
      })}
      <button
        type="button"
        className={styles.addButton}
        aria-label="New browser tab"
        onClick={onAdd}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

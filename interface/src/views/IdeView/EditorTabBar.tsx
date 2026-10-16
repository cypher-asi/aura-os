import { RotateCcw, Save, X } from "lucide-react";
import { filenameFromPath } from "../../ide/lang";
import type { TabState } from "./useIdeViewTabs";
import styles from "./IdeView.module.css";

interface Props {
  tabs: TabState[];
  activeTabPath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onReopenClosedTab: () => void;
  canReopenClosedTab: boolean;
  dirty: boolean;
  saving: boolean;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  onSave: () => void;
}

export function EditorTabBar({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onReopenClosedTab,
  canReopenClosedTab,
  dirty,
  saving,
  readOnly = false,
  readOnlyReason,
  onSave,
}: Props) {
  const saveTitle = readOnly
    ? (readOnlyReason ?? "This editor is read-only")
    : "Save (Ctrl+S)";
  return (
    <div className={styles.tabBar}>
      <div className={styles.tabList}>
        {tabs.map((tab) => {
          const tabDirty = tab.content !== null && tab.savedContent !== null && tab.content !== tab.savedContent;
          return (
            <div key={tab.path} className={`${styles.tab} ${tab.path === activeTabPath ? styles.active : ""} ${tabDirty ? styles.dirty : ""}`}>
              <button type="button" className={styles.tabSelect} onClick={() => onSelectTab(tab.path)} title={tab.path}>
                <span className={styles.tabDot} />
                {filenameFromPath(tab.path)}
              </button>
              <button type="button" className={styles.tabClose} onClick={() => onCloseTab(tab.path)} aria-label={`Close ${filenameFromPath(tab.path)}`}>
                <X size={12} className={styles.tabCloseIcon} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={styles.saveButton}
        disabled={!canReopenClosedTab}
        onClick={onReopenClosedTab}
        aria-label="Reopen closed tab"
        title="Reopen closed tab (Ctrl/Cmd+Shift+T). Unsaved edits are recoverable until you leave this workspace."
      >
        <RotateCcw size={14} />
        Reopen
      </button>
      <button
        className={styles.saveButton}
        disabled={readOnly || !dirty || saving}
        onClick={onSave}
        title={saveTitle}
      >
        <Save size={14} />
        {readOnly ? "Read only" : saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

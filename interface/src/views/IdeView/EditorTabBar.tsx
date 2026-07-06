import { Save, X } from "lucide-react";
import { filenameFromPath } from "../../ide/lang";
import type { TabState } from "./useIdeViewTabs";
import styles from "./IdeView.module.css";

interface Props {
  tabs: TabState[];
  activeTabPath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
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
            <button key={tab.path} className={`${styles.tab} ${tab.path === activeTabPath ? styles.active : ""} ${tabDirty ? styles.dirty : ""}`} onClick={() => onSelectTab(tab.path)} title={tab.path}>
              <span className={styles.tabDot} />
              {filenameFromPath(tab.path)}
              <span className={styles.tabClose} onClick={(e) => { e.stopPropagation(); onCloseTab(tab.path); }}>
                <X size={12} className={styles.tabCloseIcon} />
              </span>
            </button>
          );
        })}
      </div>
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

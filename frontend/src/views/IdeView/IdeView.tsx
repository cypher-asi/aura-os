import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { PageEmptyState, Topbar, Text } from "@cypher-asi/zui";
import { FileExplorer } from "../../components/FileExplorer";
import { Lane } from "../../components/Lane";
import { WindowControls } from "../../components/WindowControls";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { windowCommand } from "../../lib/windowCommand";
import { useIdeViewTabs } from "./useIdeViewTabs";
import { EditorTabBar } from "./EditorTabBar";
import { EditorBody } from "./EditorBody";
import styles from "./IdeView.module.css";

export function IdeView() {
  const { features } = useAuraCapabilities();
  const [params] = useSearchParams();
  const initialFile = params.get("file") ?? "";
  const rootPath = params.get("root") ?? (initialFile ? initialFile.replace(/[\\/][^\\/]+$/, "") : "");

  const ide = useIdeViewTabs(initialFile);

  const handleFileSelect = useCallback((path: string) => ide.openTab(path), [ide.openTab]);

  if (!features.ideIntegration) {
    return <PageEmptyState title="IDE stays on desktop" description="This device does not expose local file editing or IDE workflows." />;
  }

  return (
    <div className={styles.root}>
      <Topbar
        className="titlebar-drag"
        onDoubleClick={() => windowCommand("maximize")}
        icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
        title={<span className="titlebar-center">AURA IDE</span>}
        actions={<WindowControls />}
      />

      <div className={styles.body}>
        {rootPath && (
          <Lane resizable resizePosition="right" defaultWidth={220} minWidth={120} maxWidth={480} storageKey="ide-sidebar-width" className={styles.sidebar}>
            <FileExplorer rootPath={rootPath} onFileSelect={handleFileSelect} />
          </Lane>
        )}

        <div className={styles.editorPane}>
          <EditorTabBar
            tabs={ide.tabs}
            activeTabPath={ide.activeTabPath}
            onSelectTab={ide.setActiveTabPath}
            onCloseTab={ide.closeTab}
            dirty={ide.dirty}
            saving={ide.saving}
            onSave={ide.handleSave}
          />
          <EditorBody
            activeTab={ide.activeTab}
            tabCount={ide.tabs.length}
            language={ide.language}
            lineCount={ide.lineCount}
            highlightedHtml={ide.highlightedHtml}
            onContentChange={ide.handleContentChange}
            textareaRef={ide.textareaRef}
            gutterRef={ide.gutterRef}
            highlightRef={ide.highlightRef}
          />
        </div>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.statusItem}>{ide.language ?? "plain text"}</span>
        {ide.lineCount > 0 && <span className={styles.statusItem}>{ide.lineCount} lines</span>}
        {ide.saveError && <span className={styles.statusItem} style={{ color: "var(--color-danger)" }}>{ide.saveError}</span>}
        {ide.saving && <span className={styles.statusItem}>Saving…</span>}
        <span style={{ flex: 1 }} />
        {ide.activeTab && <span className={styles.statusItem}>{ide.activeTab.path}</span>}
      </div>
    </div>
  );
}

import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageEmptyState, Topbar } from "@cypher-asi/zui";
import { FileExplorer, type FileContextMenuInfo } from "../../components/FileExplorer";
import { Lane } from "../../components/Lane";
import { WindowControls } from "../../components/WindowControls";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { windowCommand } from "../../lib/windowCommand";
import { useIdeViewTabs } from "./useIdeViewTabs";
import { EditorTabBar } from "./EditorTabBar";
import { EditorBody } from "./EditorBody";
import { InputDialog } from "./InputDialog";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { ContextMenu, type ContextMenuTarget } from "./ContextMenu";
import styles from "./IdeView.module.css";

export function IdeView() {
  const { features } = useAuraCapabilities();
  const [params] = useSearchParams();
  const initialFile = params.get("file") ?? "";
  const rootPath = params.get("root") ?? (initialFile ? initialFile.replace(/[\\/][^\\/]+$/, "") : "");
  const remoteAgentId = params.get("remoteAgentId") ?? undefined;

  const ide = useIdeViewTabs(initialFile, remoteAgentId);
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [dialog, setDialog] = useState<{ type: "newFile" | "newDir" | "rename" | "delete"; dirPath: string; targetPath: string; targetName: string; isDir: boolean } | null>(null);

  const handleFileSelect = useCallback((path: string) => ide.openTab(path), [ide.openTab]);

  const handleCreateFile = useCallback((dirPath: string) => {
    setContextMenu(null);
    setDialog({ type: "newFile", dirPath, targetPath: "", targetName: "", isDir: false });
  }, []);

  const handleContextMenu = useCallback((info: FileContextMenuInfo) => {
    setContextMenu(info);
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);

  const sep = rootPath.includes("\\") ? "\\" : "/";

  const handleNewFileConfirm = useCallback(async (value: string) => {
    if (!dialog) return null;
    const fullPath = dialog.dirPath + sep + value;
    const err = await ide.createFile(fullPath);
    if (err) return err;
    setDialog(null);
    return null;
  }, [dialog?.dirPath, sep, ide.createFile]);

  const handleNewDirConfirm = useCallback(async (value: string) => {
    if (!dialog) return null;
    const fullPath = dialog.dirPath + sep + value;
    const err = await ide.createDirectory(fullPath);
    if (err) return err;
    setDialog(null);
    return null;
  }, [dialog?.dirPath, sep, ide.createDirectory]);

  const handleRenameConfirm = useCallback(async (value: string) => {
    if (!dialog) return null;
    const parentPath = dialog.targetPath.replace(/[\\/][^\\/]+$/, "");
    const newPath = parentPath + sep + value;
    const err = await ide.renamePath(dialog.targetPath, newPath);
    if (err) return err;
    setDialog(null);
    return null;
  }, [dialog?.targetPath, sep, ide.renamePath]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!dialog) return null;
    const err = await ide.deletePath(dialog.targetPath);
    if (err) return err;
    setDialog(null);
    return null;
  }, [dialog?.targetPath, ide.deletePath]);

  if (!features.ideIntegration && !remoteAgentId) {
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
            <FileExplorer rootPath={rootPath} onFileSelect={handleFileSelect} remoteAgentId={remoteAgentId} onCreateFile={!remoteAgentId ? handleCreateFile : undefined} onContextMenu={!remoteAgentId ? handleContextMenu : undefined} />
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

      {contextMenu && (
        <ContextMenu
          target={contextMenu}
          onNewFile={() => {
            const dir = contextMenu.isDir ? contextMenu.path : contextMenu.path.replace(/[\\/][^\\/]+$/, "");
            setContextMenu(null);
            setDialog({ type: "newFile", dirPath: dir, targetPath: "", targetName: "", isDir: false });
          }}
          onNewDirectory={() => {
            const dir = contextMenu.isDir ? contextMenu.path : contextMenu.path.replace(/[\\/][^\\/]+$/, "");
            setContextMenu(null);
            setDialog({ type: "newDir", dirPath: dir, targetPath: "", targetName: "", isDir: false });
          }}
          onRename={() => {
            setDialog({ type: "rename", dirPath: "", targetPath: contextMenu.path, targetName: contextMenu.name, isDir: contextMenu.isDir });
            setContextMenu(null);
          }}
          onDelete={() => {
            setDialog({ type: "delete", dirPath: "", targetPath: contextMenu.path, targetName: contextMenu.name, isDir: contextMenu.isDir });
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {dialog?.type === "newFile" && (
        <InputDialog
          label="New file name"
          placeholder="example.ts"
          onConfirm={handleNewFileConfirm}
          onCancel={closeDialog}
        />
      )}

      {dialog?.type === "newDir" && (
        <InputDialog
          label="New folder name"
          placeholder="my-folder"
          onConfirm={handleNewDirConfirm}
          onCancel={closeDialog}
        />
      )}

      {dialog?.type === "rename" && (
        <InputDialog
          label="Rename"
          initialValue={dialog.targetName}
          confirmLabel="Rename"
          onConfirm={handleRenameConfirm}
          onCancel={closeDialog}
        />
      )}

      {dialog?.type === "delete" && (
        <ConfirmDeleteDialog
          name={dialog.targetName}
          isDir={dialog.isDir}
          onConfirm={handleDeleteConfirm}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}

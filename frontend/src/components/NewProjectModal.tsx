import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "../api/client";
import { useOrg } from "../context/OrgContext";
import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { PathInput } from "./PathInput";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import {
  clearNewProjectDraftFiles,
  loadNewProjectDraftFiles,
  saveNewProjectDraftFiles,
} from "../lib/new-project-draft";
import styles from "./NewProjectModal.module.css";

const NEW_PROJECT_DRAFT_STORAGE_KEY = "aura:new-project-draft";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: import("../types").Project) => void;
}

type WorkspaceMode = "linked" | "imported";

type WorkspaceModeOption = {
  id: WorkspaceMode;
  label: string;
  description: string;
};

type ImportCandidate = {
  file: File;
  relativePath: string;
};

type BrowserFile = File & {
  webkitRelativePath?: string;
};

type DirectoryInput = HTMLInputElement & {
  webkitdirectory?: boolean;
  directory?: boolean;
};

type NewProjectDraft = {
  workspaceMode: WorkspaceMode;
  name: string;
  description: string;
  folderPath: string;
};

function readDraft(): NewProjectDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(NEW_PROJECT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      workspaceMode: parsed.workspaceMode === "linked" ? "linked" : "imported",
      name: typeof parsed.name === "string" ? parsed.name : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: NewProjectDraft | null) {
  if (typeof window === "undefined") return;
  if (!draft) {
    window.sessionStorage.removeItem(NEW_PROJECT_DRAFT_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(NEW_PROJECT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function getRelativePath(file: File): string {
  const browserFile = file as BrowserFile;
  return browserFile.webkitRelativePath && browserFile.webkitRelativePath.length > 0
    ? browserFile.webkitRelativePath
    : file.name;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return window.btoa(binary);
}

async function toImportedFiles(files: ImportCandidate[]) {
  const importedFiles = await Promise.all(
    files.map(async ({ file, relativePath }) => {
      const buffer = await file.arrayBuffer();
      return {
        relative_path: relativePath,
        contents_base64: bytesToBase64(new Uint8Array(buffer)),
      };
    }),
  );

  return importedFiles;
}

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const { activeOrg, isLoading: orgLoading } = useOrg();
  const { supportsDesktopWorkspace, isMobileLayout } = useAuraCapabilities();
  const storedDraftRef = useRef<NewProjectDraft | null>(null);
  if (storedDraftRef.current === null) {
    storedDraftRef.current = readDraft();
  }
  const storedDraft = storedDraftRef.current;
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    storedDraft?.workspaceMode === "linked" && supportsDesktopWorkspace ? "linked" : "imported",
  );
  const [name, setName] = useState(storedDraft?.name ?? "");
  const [description, setDescription] = useState(storedDraft?.description ?? "");
  const [folderPath, setFolderPath] = useState(storedDraft?.folderPath ?? "");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<DirectoryInput>(null);
  const importFilesInputRef = useRef<HTMLInputElement>(null);
  const restoringImportDraftRef = useRef(false);
  const userChangedImportSelectionRef = useRef(false);

  useEffect(() => {
    if (importFolderInputRef.current) {
      importFolderInputRef.current.webkitdirectory = true;
      importFolderInputRef.current.directory = true;
      importFolderInputRef.current.setAttribute("webkitdirectory", "");
      importFolderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    if (!isOpen || workspaceMode !== "imported") return;
    let cancelled = false;
    userChangedImportSelectionRef.current = false;

    loadNewProjectDraftFiles().then((files) => {
      if (cancelled || userChangedImportSelectionRef.current) return;
      restoringImportDraftRef.current = true;
      setImportCandidates(files);
      restoringImportDraftRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, workspaceMode]);

  useEffect(() => {
    if (!isOpen) return;
    writeDraft({
      workspaceMode,
      name,
      description,
      folderPath,
    });
  }, [description, folderPath, isOpen, name, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "imported") {
      void clearNewProjectDraftFiles();
      return;
    }
    if (restoringImportDraftRef.current) return;
    void saveNewProjectDraftFiles(importCandidates);
  }, [importCandidates, workspaceMode]);

  useEffect(() => {
    if (isOpen && !isMobileLayout) {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [isOpen, isMobileLayout]);

  const reset = useCallback(() => {
    setWorkspaceMode(supportsDesktopWorkspace ? "linked" : "imported");
    setName("");
    setDescription("");
    setFolderPath("");
    setImportCandidates([]);
    setLoading(false);
    setError("");
    setNameError("");
    writeDraft(null);
    void clearNewProjectDraftFiles();
    if (importFolderInputRef.current) importFolderInputRef.current.value = "";
    if (importFilesInputRef.current) importFilesInputRef.current.value = "";
  }, [supportsDesktopWorkspace]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError("Project name is required");
      return;
    }
    if (workspaceMode === "linked" && !folderPath.trim()) {
      setError("Choose a linked folder before creating the project.");
      return;
    }
    if (workspaceMode === "imported" && importCandidates.length === 0) {
      setError("Choose files or a folder to import.");
      return;
    }
    setNameError("");
    setLoading(true);
    setError("");
    try {
      if (!activeOrg) return;
      let project;
      if (workspaceMode === "linked") {
        project = await api.createProject({
          org_id: activeOrg.org_id,
          name: name.trim(),
          description: description.trim(),
          linked_folder_path: folderPath.trim(),
        });
      } else {
        const importedFiles = await toImportedFiles(importCandidates);
        project = await api.importProject({
          org_id: activeOrg.org_id,
          name: name.trim(),
          description: description.trim(),
          files: importedFiles,
        });
      }
      reset();
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const importSummary = useMemo(() => {
    const totalBytes = importCandidates.reduce((sum, candidate) => sum + candidate.file.size, 0);
    const totalKilobytes = totalBytes / 1024;
    return {
      count: importCandidates.length,
      sizeLabel: totalKilobytes >= 1024
        ? `${(totalKilobytes / 1024).toFixed(1)} MB`
        : `${Math.max(totalKilobytes, 0.1).toFixed(1)} KB`,
      samplePaths: importCandidates.slice(0, 3).map((candidate) => candidate.relativePath),
    };
  }, [importCandidates]);

  const handleImportSelection = useCallback((files: FileList | null) => {
    userChangedImportSelectionRef.current = true;
    const nextCandidates = Array.from(files ?? []).map((file) => ({
      file,
      relativePath: getRelativePath(file),
    }));
    setImportCandidates(nextCandidates);
    setError("");
  }, []);

  const workspaceModeOptions: WorkspaceModeOption[] = supportsDesktopWorkspace
    ? [
        { id: "linked" as const, label: "Link folder", description: "Best for the desktop app and live local workspaces." },
        { id: "imported" as const, label: "Use local files", description: "Choose a folder or files from this device for browser-friendly workspaces." },
      ]
    : [
        { id: "imported" as const, label: "Local files", description: "Choose a folder or files from this device to start a project." },
      ];
  const selectedWorkspaceMode = workspaceModeOptions.find((option) => option.id === workspaceMode) ?? workspaceModeOptions[0];
  const showWorkspaceModePicker = workspaceModeOptions.length > 1;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Project"
      size="md"
      contentClassName={isMobileLayout ? styles.mobileContent : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={
              loading ||
              orgLoading ||
              !activeOrg ||
              (workspaceMode === "linked" && !supportsDesktopWorkspace)
            }
          >
            {loading ? <><Spinner size="sm" /> Creating...</> : "Create Project"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Text size="sm" style={{ fontWeight: 600 }}>
            {showWorkspaceModePicker ? "Workspace source" : selectedWorkspaceMode.label}
          </Text>
          {showWorkspaceModePicker ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {workspaceModeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setWorkspaceMode(option.id)}
                  style={{
                    textAlign: "left",
                    borderRadius: "var(--radius-md)",
                    border: option.id === workspaceMode ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                    background: option.id === workspaceMode ? "rgba(255,255,255,0.06)" : "var(--color-bg-elevated)",
                    color: "inherit",
                    padding: "var(--space-3)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{option.label}</div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>{option.description}</div>
                </button>
              ))}
            </div>
          ) : (
            <Text variant="muted" size="sm">
              {selectedWorkspaceMode.description}
            </Text>
          )}
        </div>
        <Input
          ref={nameInputRef}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(""); }}
          placeholder="Project name"
          validationMessage={nameError}
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        {workspaceMode === "linked" ? (
          <>
            <PathInput
              value={folderPath}
              onChange={setFolderPath}
              placeholder="Linked folder path"
              mode="folder"
            />
            {!supportsDesktopWorkspace && (
              <Text variant="muted" size="sm">
                Linking a live local folder stays in the desktop app.
              </Text>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <input
              ref={importFolderInputRef}
              type="file"
              multiple
              onChange={(event) => handleImportSelection(event.target.files)}
              style={{ display: "none" }}
            />
            <input
              ref={importFilesInputRef}
              type="file"
              multiple
              onChange={(event) => handleImportSelection(event.target.files)}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <Button variant="secondary" onClick={() => importFolderInputRef.current?.click()} disabled={loading}>
                Open folder
              </Button>
              <Button variant="ghost" onClick={() => importFilesInputRef.current?.click()} disabled={loading}>
                Choose files
              </Button>
            </div>
            <Text variant="muted" size="sm">
              Aura prepares a workspace from the selected local files on the connected host so you can keep working from the browser.
            </Text>
            {importSummary.count > 0 && (
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3)",
                  background: "var(--color-bg-elevated)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}
              >
                <Text size="sm" style={{ fontWeight: 600 }}>
                  {importSummary.count} file{importSummary.count === 1 ? "" : "s"} selected
                </Text>
                <Text variant="muted" size="sm">
                  {importSummary.sizeLabel}
                </Text>
                {importSummary.samplePaths.map((path) => (
                  <Text key={path} variant="muted" size="xs" style={{ wordBreak: "break-all" }}>
                    {path}
                  </Text>
                ))}
              </div>
            )}
          </div>
        )}
        {!orgLoading && !activeOrg && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            No team found. Log out and back in to create a default team.
          </Text>
        )}
        {error && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}

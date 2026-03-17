import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "../api/client";
import { useOrg } from "../context/OrgContext";
import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { PathInput } from "./PathInput";
import type { GitHubRepo } from "../types";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: import("../types").Project) => void;
}

type WorkspaceMode = "linked" | "imported";

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
  const { supportsDesktopWorkspace } = useAuraCapabilities();
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    supportsDesktopWorkspace ? "linked" : "imported",
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<DirectoryInput>(null);
  const importFilesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (importFolderInputRef.current) {
      importFolderInputRef.current.webkitdirectory = true;
      importFolderInputRef.current.directory = true;
      importFolderInputRef.current.setAttribute("webkitdirectory", "");
      importFolderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !activeOrg) return;
    api.orgs.listGithubRepos(activeOrg.org_id).then(setRepos).catch(() => setRepos([]));
  }, [isOpen, activeOrg]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [isOpen]);

  const reset = useCallback(() => {
    setWorkspaceMode(supportsDesktopWorkspace ? "linked" : "imported");
    setName("");
    setDescription("");
    setFolderPath("");
    setImportCandidates([]);
    setSelectedRepo("");
    setLoading(false);
    setError("");
    setNameError("");
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
        const repoObj = repos.find((r) => r.full_name === selectedRepo);
        project = await api.createProject({
          org_id: activeOrg.org_id,
          name: name.trim(),
          description: description.trim(),
          linked_folder_path: folderPath.trim(),
          github_integration_id: repoObj?.integration_id,
          github_repo_full_name: repoObj?.full_name,
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
    const nextCandidates = Array.from(files ?? []).map((file) => ({
      file,
      relativePath: getRelativePath(file),
    }));
    setImportCandidates(nextCandidates);
    setError("");
  }, []);

  const workspaceModeOptions = supportsDesktopWorkspace
    ? [
        { id: "linked" as const, label: "Link folder", description: "Best for the desktop app and live local workspaces." },
        { id: "imported" as const, label: "Import snapshot", description: "Uploads a copy of files for web and mobile use." },
      ]
    : [
        { id: "imported" as const, label: "Import snapshot", description: "Uploads files into an Aura-managed workspace on the server." },
      ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Project"
      size="md"
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
            Workspace source
          </Text>
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
                Import folder
              </Button>
              <Button variant="ghost" onClick={() => importFilesInputRef.current?.click()} disabled={loading}>
                Import files
              </Button>
            </div>
            <Text variant="muted" size="sm">
              Aura uploads a copy of the selected files to a managed workspace on the connected host. This is the recommended web/mobile path.
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
        {workspaceMode === "linked" && repos.length > 0 && (
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            style={{
              padding: "var(--space-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <option value="">No GitHub repository</option>
            {repos.map((r) => (
              <option key={r.github_repo_id} value={r.full_name}>
                {r.full_name}{r.private ? " (private)" : ""}
              </option>
            ))}
          </select>
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

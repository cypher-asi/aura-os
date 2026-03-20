import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { api, type OrbitRepo } from "../api/client";
import { useOrg } from "../context/OrgContext";
import { useAuth } from "../context/AuthContext";
import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { PathInput } from "./PathInput";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useModalInitialFocus } from "../hooks/use-modal-initial-focus";
import {
  clearNewProjectDraftFiles,
  loadNewProjectDraftFiles,
  saveNewProjectDraftFiles,
} from "../lib/new-project-draft";

const NEW_PROJECT_DRAFT_STORAGE_KEY = "aura:new-project-draft";

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

type OrbitRepoMode = "default" | "custom" | "existing" | "none";

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
  const { user, isAuthenticated } = useAuth();
  const { projects } = useProjectsList();
  const { features } = useAuraCapabilities();
  const { inputRef: nameInputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const storedDraftRef = useRef<NewProjectDraft | null>(null);
  if (storedDraftRef.current === null) {
    storedDraftRef.current = readDraft();
  }
  const storedDraft = storedDraftRef.current;
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    storedDraft?.workspaceMode === "linked" && features.linkedWorkspace ? "linked" : "imported",
  );
  const [name, setName] = useState(storedDraft?.name ?? "");
  const [description, setDescription] = useState(storedDraft?.description ?? "");
  const [folderPath, setFolderPath] = useState(storedDraft?.folderPath ?? "");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [orbitRepoName, setOrbitRepoName] = useState("");
  const [orbitRepoMode, setOrbitRepoMode] = useState<OrbitRepoMode>("none");
  const [orbitRepos, setOrbitRepos] = useState<OrbitRepo[]>([]);
  const [orbitReposLoading, setOrbitReposLoading] = useState(false);
  const [selectedOrbitRepo, setSelectedOrbitRepo] = useState<OrbitRepo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const importFolderInputRef = useRef<DirectoryInput>(null);
  const importFilesInputRef = useRef<HTMLInputElement>(null);
  const restoringImportDraftRef = useRef(false);
  const userChangedImportSelectionRef = useRef(false);

  const orbitOwner = activeOrg?.org_id ?? user?.user_id ?? null;
  const proposedRepoSlug = slugFromName(name) || "my-project";
  const displayRepoName = orbitRepoName.trim() || proposedRepoSlug;
  const resolvedOrgId = activeOrg?.org_id ?? projects[0]?.org_id ?? null;

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
    if (isOpen && !isAuthenticated) {
      setOrbitRepoMode("none");
    }
  }, [isOpen, isAuthenticated]);

  useEffect(() => {
    if (!isOpen || orbitRepoMode !== "existing" || !isAuthenticated) return;
    setOrbitReposLoading(true);
    api
      .listOrbitRepos()
      .then(setOrbitRepos)
      .catch(() => setOrbitRepos([]))
      .finally(() => setOrbitReposLoading(false));
  }, [isOpen, orbitRepoMode, isAuthenticated]);

  const reset = useCallback(() => {
    setWorkspaceMode(features.linkedWorkspace ? "linked" : "imported");
    setName("");
    setDescription("");
    setFolderPath("");
    setImportCandidates([]);
    setOrbitRepoName("");
    setOrbitRepoMode("none");
    setOrbitRepos([]);
    setSelectedOrbitRepo(null);
    setLoading(false);
    setError("");
    setNameError("");
    writeDraft(null);
    void clearNewProjectDraftFiles();
    if (importFolderInputRef.current) importFolderInputRef.current.value = "";
    if (importFilesInputRef.current) importFilesInputRef.current.value = "";
  }, [features.linkedWorkspace, isAuthenticated]);

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
    if (orbitRepoMode === "existing" && !selectedOrbitRepo) {
      setError("Please select an existing repo.");
      return;
    }

    setNameError("");
    setError("");
    setLoading(true);

    try {
      if (!resolvedOrgId) {
        setError("No team found. Log out and back in to create a default team.");
        return;
      }

      const repoSlug =
        orbitRepoMode === "custom"
          ? orbitRepoName.trim() || proposedRepoSlug
          : proposedRepoSlug;

      const orbitFields = {
        git_branch: "main" as const,
        git_repo_url:
          orbitRepoMode === "existing" && selectedOrbitRepo
            ? selectedOrbitRepo.clone_url ?? `${selectedOrbitRepo.owner}/${selectedOrbitRepo.name}`
            : undefined,
        orbit_owner:
          orbitRepoMode === "existing" && selectedOrbitRepo
            ? selectedOrbitRepo.owner
            : orbitRepoMode !== "none"
              ? orbitOwner ?? undefined
              : undefined,
        orbit_repo:
          orbitRepoMode === "existing" && selectedOrbitRepo
            ? selectedOrbitRepo.name
            : orbitRepoMode !== "none"
              ? repoSlug
              : undefined,
      };

      let project;
      if (workspaceMode === "linked") {
        project = await api.createProject({
          org_id: resolvedOrgId,
          name: name.trim(),
          description: description.trim(),
          linked_folder_path: folderPath.trim(),
          ...orbitFields,
        });
      } else {
        const importedFiles = await toImportedFiles(importCandidates);
        project = await api.importProject({
          org_id: resolvedOrgId,
          name: name.trim(),
          description: description.trim(),
          files: importedFiles,
          ...orbitFields,
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

  const workspaceModeOptions: WorkspaceModeOption[] = features.linkedWorkspace
    ? [
        { id: "linked", label: "Link folder", description: "Best for the desktop app and live local workspaces." },
        { id: "imported", label: "Use local files", description: "Choose a folder or files from this device for browser-friendly workspaces." },
      ]
    : [
        { id: "imported", label: "Local files", description: "Choose a folder or files from this device to start a project." },
      ];
  const selectedWorkspaceMode = workspaceModeOptions.find((option) => option.id === workspaceMode) ?? workspaceModeOptions[0];
  const showWorkspaceModePicker = workspaceModeOptions.length > 1;
  const needsImportedFiles = workspaceMode === "imported" && importCandidates.length === 0;
  const needsLinkedFolder = workspaceMode === "linked" && !folderPath.trim();
  const submitBlocker = useMemo(() => {
    if (orgLoading) return "Loading your team...";
    if (!resolvedOrgId) return "No team found. Log out and back in to create a default team.";
    if (!name.trim()) return "Project name is required.";
    if (workspaceMode === "linked") {
      if (!features.linkedWorkspace) {
        return "Linking a live local folder stays in the desktop app.";
      }
      if (!folderPath.trim()) {
        return "Choose a linked folder to create this project.";
      }
    }
    if (workspaceMode === "imported" && importCandidates.length === 0) {
      return "Choose files or a folder to import before creating the project.";
    }
    if (orbitRepoMode === "existing" && !selectedOrbitRepo) {
      return "Select an existing Orbit repo to continue.";
    }
    return "";
  }, [
    features.linkedWorkspace,
    folderPath,
    importCandidates.length,
    name,
    orbitRepoMode,
    orgLoading,
    resolvedOrgId,
    selectedOrbitRepo,
    workspaceMode,
  ]);
  const canSubmit = !loading && !submitBlocker;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Project"
      size="md"
      initialFocusRef={initialFocusRef}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {loading ? (
              <><Spinner size="sm" /> Creating...</>
            ) : needsImportedFiles ? (
              "Choose Files to Continue"
            ) : needsLinkedFolder ? (
              "Choose Folder to Continue"
            ) : (
              "Create Project"
            )}
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
          onChange={(e) => {
            setName(e.target.value);
            setNameError("");
          }}
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
            {!features.linkedWorkspace && (
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
            {importSummary.count === 0 && (
              <Text size="sm" style={{ color: "var(--color-warning)" }}>
                Choose a folder or files to enable project creation.
              </Text>
            )}
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

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Text variant="muted" size="sm" style={{ marginTop: "var(--space-2)" }}>
            Orbit repo (optional)
          </Text>
          {!isAuthenticated && (
            <Text variant="muted" size="sm" style={{ color: "var(--color-warning)" }}>
              Sign in to create a new repo or choose an existing one.
            </Text>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
            <input
              type="radio"
              checked={orbitRepoMode === "none"}
              onChange={() => setOrbitRepoMode("none")}
            />
            <span>No Orbit repo</span>
          </label>
          {isAuthenticated && orbitOwner && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={orbitRepoMode === "default"}
                  onChange={() => setOrbitRepoMode("default")}
                />
                <span>Create new repo with default name</span>
              </label>
              {orbitRepoMode === "default" && (
                <div style={{ paddingLeft: "var(--space-6)" }}>
                  <Text variant="muted" size="sm">
                    orbit/{orbitOwner}/{proposedRepoSlug}
                  </Text>
                  <Text variant="muted" size="xs" style={{ opacity: 0.85, marginTop: "var(--space-1)" }}>
                    Format: orbit/UUID/name
                  </Text>
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={orbitRepoMode === "custom"}
                  onChange={() => setOrbitRepoMode("custom")}
                />
                <span>Create new repo with custom name</span>
              </label>
              {orbitRepoMode === "custom" && (
                <div style={{ paddingLeft: "var(--space-6)" }}>
                  <Text variant="muted" size="sm">
                    orbit/{orbitOwner}/{displayRepoName}
                  </Text>
                  <Text variant="muted" size="xs" style={{ opacity: 0.85, marginTop: "var(--space-1)" }}>
                    Format: orbit/UUID/name
                  </Text>
                  <Input
                    value={orbitRepoName}
                    onChange={(e) => setOrbitRepoName(e.target.value)}
                    placeholder={`Repo name (default: ${proposedRepoSlug})`}
                    style={{ marginTop: "var(--space-1)" }}
                  />
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={orbitRepoMode === "existing"}
                  onChange={() => setOrbitRepoMode("existing")}
                />
                <span>Use existing repo</span>
              </label>
              {orbitRepoMode === "existing" && (
                <div style={{ paddingLeft: "var(--space-6)" }}>
                  {orbitReposLoading ? (
                    <Spinner size="sm" />
                  ) : orbitRepos.length === 0 ? (
                    <Text variant="muted" size="sm">
                      No repos found. Create a new repo instead or check Orbit configuration.
                    </Text>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                      <Text variant="muted" size="sm">
                        Select a repo to link:
                      </Text>
                      <select
                        value={selectedOrbitRepo ? `${selectedOrbitRepo.owner}/${selectedOrbitRepo.name}` : ""}
                        onChange={(e) => {
                          const repo = orbitRepos.find(
                            (candidate) => `${candidate.owner}/${candidate.name}` === e.target.value,
                          );
                          setSelectedOrbitRepo(repo ?? null);
                        }}
                        style={{
                          padding: "var(--space-2)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <option value="">— Select repo —</option>
                        {orbitRepos.map((repo) => (
                          <option key={`${repo.owner}/${repo.name}`} value={`${repo.owner}/${repo.name}`}>
                            {repo.owner}/{repo.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {!orgLoading && !resolvedOrgId && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            No team found. Log out and back in to create a default team.
          </Text>
        )}
        {error && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </Text>
        )}
        {!error && submitBlocker && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-text-secondary)" }}>
            {submitBlocker}
          </Text>
        )}
      </div>
    </Modal>
  );
}

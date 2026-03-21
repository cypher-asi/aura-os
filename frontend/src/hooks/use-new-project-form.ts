import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { api, type OrbitRepo } from "../api/client";
import { useOrgStore } from "../stores/org-store";
import { useAuth } from "../stores/auth-store";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { useAuraCapabilities } from "./use-aura-capabilities";
import {
  clearNewProjectDraftFiles,
  loadNewProjectDraftFiles,
  saveNewProjectDraftFiles,
} from "../lib/new-project-draft";
import { useNewProjectDraft } from "./use-new-project-draft";
import { useOrbitRepos } from "./use-orbit-repos";

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export type OrbitRepoMode = "default" | "custom" | "existing";
export type WorkspaceMode = "linked" | "imported";

export type ImportCandidate = {
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
  return Promise.all(
    files.map(async ({ file, relativePath }) => {
      const buffer = await file.arrayBuffer();
      return {
        relative_path: relativePath,
        contents_base64: bytesToBase64(new Uint8Array(buffer)),
      };
    }),
  );
}

export type WorkspaceModeOption = {
  id: WorkspaceMode;
  label: string;
  description: string;
};

export interface NewProjectFormState {
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (description: string) => void;
  folderPath: string;
  setFolderPath: (path: string) => void;
  importCandidates: ImportCandidate[];
  orbitRepoMode: OrbitRepoMode;
  setOrbitRepoMode: (mode: OrbitRepoMode) => void;
  orbitRepoName: string;
  setOrbitRepoName: (name: string) => void;
  orbitRepos: OrbitRepo[];
  orbitReposLoading: boolean;
  selectedOrbitRepo: OrbitRepo | null;
  setSelectedOrbitRepo: (repo: OrbitRepo | null) => void;
  loading: boolean;
  error: string;
  nameError: string;
  setNameError: (error: string) => void;
  importFolderInputRef: React.RefObject<DirectoryInput | null>;
  importFilesInputRef: React.RefObject<HTMLInputElement | null>;

  orbitOwner: string | null;
  proposedRepoSlug: string;
  displayRepoName: string;
  isAuthenticated: boolean;
  importSummary: { count: number; sizeLabel: string; samplePaths: string[] };
  workspaceModeOptions: WorkspaceModeOption[];
  showWorkspaceModePicker: boolean;
  needsImportedFiles: boolean;
  needsLinkedFolder: boolean;
  submitBlocker: string;
  canSubmit: boolean;

  handleImportSelection: (files: FileList | null) => void;
  handleSubmit: () => Promise<void>;
  handleClose: () => void;
}

export function useNewProjectForm(
  isOpen: boolean,
  onClose: () => void,
  onCreated: (project: import("../types").Project) => void,
): NewProjectFormState {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const orgLoading = useOrgStore((s) => s.isLoading);
  const { user, isAuthenticated } = useAuth();
  const { projects } = useProjectsList();
  const { features } = useAuraCapabilities();

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("imported");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [orbitRepoName, setOrbitRepoName] = useState("");
  const [orbitRepoMode, setOrbitRepoMode] = useState<OrbitRepoMode>("default");
  const [selectedOrbitRepo, setSelectedOrbitRepo] = useState<OrbitRepo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const importFolderInputRef = useRef<DirectoryInput>(null);
  const importFilesInputRef = useRef<HTMLInputElement>(null);
  const restoringImportDraftRef = useRef(false);
  const userChangedImportSelectionRef = useRef(false);

  const { storedDraft, clearDraft } = useNewProjectDraft(isOpen, { workspaceMode, name, description, folderPath });
  const { orbitRepos, orbitReposLoading, resetOrbitRepos } = useOrbitRepos(isOpen, orbitRepoMode, isAuthenticated);

  const draftAppliedRef = useRef(false);
  useEffect(() => {
    if (draftAppliedRef.current || !storedDraft) return;
    draftAppliedRef.current = true;
    setWorkspaceMode(storedDraft.workspaceMode === "linked" && features.linkedWorkspace ? "linked" : "imported");
    if (storedDraft.name) setName(storedDraft.name);
    if (storedDraft.description) setDescription(storedDraft.description);
    if (storedDraft.folderPath) setFolderPath(storedDraft.folderPath);
  }, [storedDraft, features.linkedWorkspace]);

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
    if (workspaceMode !== "imported") {
      void clearNewProjectDraftFiles();
      return;
    }
    if (restoringImportDraftRef.current) return;
    void saveNewProjectDraftFiles(importCandidates);
  }, [importCandidates, workspaceMode]);

  const reset = useCallback(() => {
    setWorkspaceMode(features.linkedWorkspace ? "linked" : "imported");
    setName("");
    setDescription("");
    setFolderPath("");
    setImportCandidates([]);
    setOrbitRepoName("");
    setOrbitRepoMode("default");
    resetOrbitRepos();
    setSelectedOrbitRepo(null);
    setLoading(false);
    setError("");
    setNameError("");
    clearDraft();
    void clearNewProjectDraftFiles();
    if (importFolderInputRef.current) importFolderInputRef.current.value = "";
    if (importFilesInputRef.current) importFilesInputRef.current.value = "";
  }, [features.linkedWorkspace, clearDraft, resetOrbitRepos]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = useCallback(async () => {
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
            : orbitOwner ?? undefined,
        orbit_repo:
          orbitRepoMode === "existing" && selectedOrbitRepo
            ? selectedOrbitRepo.name
            : repoSlug,
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
  }, [name, workspaceMode, folderPath, importCandidates, orbitRepoMode,
      selectedOrbitRepo, orbitRepoName, proposedRepoSlug, orbitOwner,
      resolvedOrgId, reset, onCreated]);

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
  const selectedWorkspaceModeOption = workspaceModeOptions.find((option) => option.id === workspaceMode) ?? workspaceModeOptions[0];
  const showWorkspaceModePicker = workspaceModeOptions.length > 1;
  const needsImportedFiles = workspaceMode === "imported" && importCandidates.length === 0;
  const needsLinkedFolder = workspaceMode === "linked" && !folderPath.trim();

  const submitBlocker = useMemo(() => {
    if (orgLoading) return "Loading your team...";
    if (!isAuthenticated) return "Sign in to create a project with an Orbit repo.";
    if (!resolvedOrgId) return "No team found. Log out and back in to create a default team.";
    if (!name.trim()) return "Project name is required.";
    if (workspaceMode === "linked") {
      if (!features.linkedWorkspace) return "Linking a live local folder stays in the desktop app.";
      if (!folderPath.trim()) return "Choose a linked folder to create this project.";
    }
    if (workspaceMode === "imported" && importCandidates.length === 0) {
      return "Choose files or a folder to import before creating the project.";
    }
    if (orbitRepoMode === "existing" && !selectedOrbitRepo) {
      return "Select an existing Orbit repo to continue.";
    }
    return "";
  }, [
    features.linkedWorkspace, folderPath, importCandidates.length,
    isAuthenticated, name, orbitRepoMode, orgLoading, resolvedOrgId, selectedOrbitRepo, workspaceMode,
  ]);
  const canSubmit = !loading && !submitBlocker;

  void selectedWorkspaceModeOption;

  return {
    workspaceMode, setWorkspaceMode,
    name, setName,
    description, setDescription,
    folderPath, setFolderPath,
    importCandidates,
    orbitRepoMode, setOrbitRepoMode,
    orbitRepoName, setOrbitRepoName,
    orbitRepos, orbitReposLoading,
    selectedOrbitRepo, setSelectedOrbitRepo,
    loading, error, nameError, setNameError,
    importFolderInputRef, importFilesInputRef,
    orbitOwner, proposedRepoSlug, displayRepoName, isAuthenticated,
    importSummary, workspaceModeOptions, showWorkspaceModePicker,
    needsImportedFiles, needsLinkedFolder, submitBlocker, canSubmit,
    handleImportSelection, handleSubmit, handleClose,
  };
}

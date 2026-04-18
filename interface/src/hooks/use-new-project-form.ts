import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { api, type OrbitRepo } from "../api/client";
import { useOrgStore } from "../stores/org-store";
import { useAuth } from "../stores/auth-store";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { clearNewProjectDraftFiles } from "../lib/new-project-draft";
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
export type WorkspaceModeOption = {
  id: WorkspaceMode;
  label: string;
  description: string;
};

export interface NewProjectFormState {
  name: string;
  setName: (name: string) => void;
  orbitRepoMode: OrbitRepoMode;
  setOrbitRepoMode: (mode: OrbitRepoMode) => void;
  orbitRepoName: string;
  setOrbitRepoName: (name: string) => void;
  orbitRepos: OrbitRepo[];
  orbitReposLoading: boolean;
  selectedOrbitRepo: OrbitRepo | null;
  setSelectedOrbitRepo: (repo: OrbitRepo | null) => void;
  /**
   * Optional local-only folder override. Empty string means "use default"
   * (`{data_dir}/workspaces/{project_id}`). Never synced to aura-network.
   */
  localWorkspacePath: string;
  setLocalWorkspacePath: (path: string) => void;
  loading: boolean;
  error: string;
  nameError: string;
  setNameError: (error: string) => void;

  orbitOwner: string | null;
  proposedRepoSlug: string;
  displayRepoName: string;
  isAuthenticated: boolean;
  submitBlocker: string;
  canSubmit: boolean;

  handleSubmit: () => Promise<void>;
  handleClose: () => void;
}

function validateSubmit(
  name: string,
  orbitRepoMode: OrbitRepoMode,
  selectedOrbitRepo: OrbitRepo | null,
  orbitOwner: string | null,
  resolvedOrbitRepo: string,
  existingProjects: import("../types").Project[],
): string | null {
  if (!name.trim()) return "name";
  if (orbitRepoMode === "existing" && !selectedOrbitRepo) return "Please select an existing repo.";

  const effectiveOwner =
    orbitRepoMode === "existing" && selectedOrbitRepo
      ? selectedOrbitRepo.owner
      : orbitOwner;
  const effectiveRepo =
    orbitRepoMode === "existing" && selectedOrbitRepo
      ? selectedOrbitRepo.name
      : resolvedOrbitRepo;

  if (effectiveOwner && effectiveRepo) {
    const dup = existingProjects.find(
      (p) => p.orbit_owner === effectiveOwner && p.orbit_repo === effectiveRepo,
    );
    if (dup) return `Orbit repo already used by project "${dup.name}".`;
  }
  return null;
}

function buildOrbitFields(
  orbitRepoMode: OrbitRepoMode,
  orbitRepoName: string,
  proposedRepoSlug: string,
  selectedOrbitRepo: OrbitRepo | null,
  orbitOwner: string | null,
) {
  const repoSlug = orbitRepoMode === "custom"
    ? orbitRepoName.trim() || proposedRepoSlug
    : proposedRepoSlug;

  return {
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
}

export function useNewProjectForm(
  isOpen: boolean,
  onClose: () => void,
  onCreated: (project: import("../types").Project) => void,
): NewProjectFormState {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const orgLoading = useOrgStore((s) => s.isLoading);
  const { user, isAuthenticated } = useAuth();
  const { projects, loadingProjects, refreshProjects } = useProjectsList();

  const [name, setNameRaw] = useState("");
  const [orbitRepoName, setOrbitRepoName] = useState("");
  const [orbitRepoMode, setOrbitRepoMode] = useState<OrbitRepoMode>("default");
  const [selectedOrbitRepo, setSelectedOrbitRepo] = useState<OrbitRepo | null>(null);
  const [localWorkspacePath, setLocalWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");

  const setName = useCallback((value: string) => {
    setNameRaw(value);
  }, []);

  const { storedDraft, clearDraft } = useNewProjectDraft(isOpen, {
    name,
    folderPath: localWorkspacePath,
  });
  const { orbitRepos, orbitReposLoading, resetOrbitRepos } = useOrbitRepos(isOpen, orbitRepoMode, isAuthenticated);

  const draftAppliedRef = useRef(false);
  useEffect(() => {
    if (draftAppliedRef.current || !storedDraft) return;
    draftAppliedRef.current = true;
    if (storedDraft.name) setNameRaw(storedDraft.name);
    if (storedDraft.folderPath) setLocalWorkspacePath(storedDraft.folderPath);
  }, [storedDraft]);

  const orbitOwner = activeOrg?.org_id ?? user?.user_id ?? null;
  const proposedRepoSlug = slugFromName(name) || "my-project";
  const displayRepoName = orbitRepoName.trim() || proposedRepoSlug;
  const resolvedOrgId = activeOrg?.org_id ?? projects[0]?.org_id ?? null;

  useEffect(() => {
    if (!isOpen || activeOrg || projects.length > 0) return;
    void refreshProjects();
  }, [activeOrg, isOpen, projects.length, refreshProjects]);

  const reset = useCallback(() => {
    setNameRaw("");
    setOrbitRepoName(""); setOrbitRepoMode("default");
    resetOrbitRepos(); setSelectedOrbitRepo(null);
    setLocalWorkspacePath("");
    setLoading(false); setError(""); setNameError("");
    clearDraft(); void clearNewProjectDraftFiles();
  }, [clearDraft, resetOrbitRepos]);

  const handleClose = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const handleSubmit = useCallback(async () => {
    const resolvedRepo = orbitRepoMode === "custom"
      ? orbitRepoName.trim() || proposedRepoSlug
      : proposedRepoSlug;
    const issue = validateSubmit(name, orbitRepoMode, selectedOrbitRepo, orbitOwner, resolvedRepo, projects);
    if (issue === "name") { setNameError("Project name is required"); return; }
    if (issue) { setError(issue); return; }

    setNameError(""); setError(""); setLoading(true);
    try {
      if (!resolvedOrgId) { setError("No team found. Log out and back in to create a default team."); return; }
      const orbitFields = buildOrbitFields(orbitRepoMode, orbitRepoName, proposedRepoSlug, selectedOrbitRepo, orbitOwner);

      const trimmedLocalPath = localWorkspacePath.trim();
      const project = await api.createProject({
        org_id: resolvedOrgId,
        name: name.trim(),
        description: "",
        ...orbitFields,
        ...(trimmedLocalPath ? { local_workspace_path: trimmedLocalPath } : {}),
      });

      reset(); onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally { setLoading(false); }
  }, [name, orbitRepoMode,
      selectedOrbitRepo, orbitRepoName, proposedRepoSlug, orbitOwner,
      localWorkspacePath,
      resolvedOrgId, reset, onCreated, projects]);

  const submitBlocker = useMemo(() => {
    if (orgLoading || (!activeOrg && loadingProjects && projects.length === 0)) return "Loading your team...";
    if (!isAuthenticated) return "Sign in to create a project with an Orbit repo.";
    if (!resolvedOrgId) return "No team found. Log out and back in to create a default team.";
    if (orbitRepoMode === "existing" && !selectedOrbitRepo) return "Select an existing Orbit repo to continue.";
    return "";
  }, [activeOrg, isAuthenticated, loadingProjects, orbitRepoMode, orgLoading, projects.length, resolvedOrgId, selectedOrbitRepo]);
  const canSubmit = !loading && !submitBlocker && !!name.trim();

  return {
    name, setName,
    orbitRepoMode, setOrbitRepoMode,
    orbitRepoName, setOrbitRepoName, orbitRepos, orbitReposLoading,
    selectedOrbitRepo, setSelectedOrbitRepo,
    localWorkspacePath, setLocalWorkspacePath,
    loading, error, nameError, setNameError,
    orbitOwner, proposedRepoSlug, displayRepoName, isAuthenticated,
    submitBlocker, canSubmit,
    handleSubmit, handleClose,
  };
}

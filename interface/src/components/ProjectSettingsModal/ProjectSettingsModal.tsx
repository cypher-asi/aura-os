import { useState, useEffect, useCallback, useMemo } from "react";
import { Modal, Button, Input, Spinner, Tabs, Text } from "@cypher-asi/zui";
import { api, type OrbitCollaborator, type OrbitRepo } from "../../api/client";
import type { Project } from "../../shared/types";
import {
  joinWorkspacePath,
  useWorkspaceRoot,
} from "../../hooks/use-workspace-defaults";
import { FolderPickerField } from "../FolderPickerField";
import { OrbitRepoSection } from "../OrbitRepoSection";
import { AppearanceTab } from "./AppearanceTab";
import { useOrbitRepos } from "../../hooks/use-orbit-repos";
import type { OrbitRepoMode } from "../../hooks/use-new-project-form";
import { useOrgStore } from "../../stores/org-store";
import { useAuth } from "../../stores/auth-store";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import styles from "./ProjectSettingsModal.module.css";

export type ProjectSettingsTab = "general" | "appearance" | "integrations";

interface ProjectSettingsModalProps {
  target: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
  /**
   * Tab to focus when the modal opens. Defaults to `"general"`. Used
   * by the right-click "Change icon…" / "Change color…" context-menu
   * shortcuts to deep-link straight into the Appearance tab.
   */
  initialTab?: ProjectSettingsTab;
}

const SETTINGS_TABS: { id: ProjectSettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "integrations", label: "Integrations" },
];

function resolveOrbitUrl(project: Project): string {
  const owner = project.orbit_owner?.trim();
  const repo = project.orbit_repo?.trim();
  if (!owner || !repo) return "";
  const base = (project.orbit_base_url?.trim() || "").replace(/\/+$/, "");
  return base ? `${base}/${owner}/${repo}.git` : `${owner}/${repo}`;
}

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function ProjectSettingsModal({
  target,
  onClose,
  onSaved,
  initialTab = "general",
}: ProjectSettingsModalProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectSettingsTab>(initialTab);
  // Reset to the requested tab every time the modal opens with a new
  // target so the deep-link entry from the right-click menu always
  // lands the user on the expected tab.
  useEffect(() => {
    if (target) setActiveTab(initialTab);
  }, [target, initialTab]);
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [localWorkspacePath, setLocalWorkspacePath] = useState("");
  const [initialLocalWorkspacePath, setInitialLocalWorkspacePath] = useState("");
  const [collaborators, setCollaborators] = useState<OrbitCollaborator[] | null>(null);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [orbitRepoMode, setOrbitRepoMode] = useState<OrbitRepoMode>("default");
  const [orbitRepoName, setOrbitRepoName] = useState("");
  const [selectedOrbitRepo, setSelectedOrbitRepo] = useState<OrbitRepo | null>(null);
  const workspaceRoot = useWorkspaceRoot();
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const { user, isAuthenticated } = useAuth();
  const { projects } = useProjectsList();
  const defaultWorkspacePath = project
    ? joinWorkspacePath(workspaceRoot, project.project_id)
    : "";
  const orbitUrl = project ? resolveOrbitUrl(project) : "";
  const hasLinkedOrbit = !!orbitUrl;
  const orbitOwner = activeOrg?.org_id ?? user?.user_id ?? null;
  const proposedRepoSlug = useMemo(
    () => slugFromName(project?.name ?? "") || "my-project",
    [project?.name],
  );
  const displayRepoName = orbitRepoName.trim() || proposedRepoSlug;
  const { orbitRepos, orbitReposLoading } = useOrbitRepos(
    !!target && !hasLinkedOrbit,
    orbitRepoMode,
    isAuthenticated,
  );

  useEffect(() => {
    if (!target) {
      setProject(null);
      setCollaborators(null);
      setOrbitRepoMode("default");
      setOrbitRepoName("");
      setSelectedOrbitRepo(null);
      return;
    }
    setLoading(true);
    setError("");
    setOrbitRepoMode("default");
    setOrbitRepoName("");
    setSelectedOrbitRepo(null);
    api
      .getProject(target.project_id)
      .then((p) => {
        setProject(p);
        setGitRepoUrl(p.git_repo_url ?? "");
        setGitBranch(p.git_branch ?? "main");
        const initialPath = p.local_workspace_path ?? "";
        setLocalWorkspacePath(initialPath);
        setInitialLocalWorkspacePath(initialPath);
      })
      .catch(() => setError("Failed to load project"))
      .finally(() => setLoading(false));
  }, [target, target?.project_id]);

  useEffect(() => {
    if (!project?.orbit_owner || !project?.orbit_repo) {
      setCollaborators(null);
      return;
    }
    setCollaboratorsLoading(true);
    api
      .listProjectOrbitCollaborators(project.project_id)
      .then(setCollaborators)
      .catch(() => setCollaborators([]))
      .finally(() => setCollaboratorsLoading(false));
  }, [project?.project_id, project?.orbit_owner, project?.orbit_repo]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    setError("");
    try {
      const trimmedLocalPath = localWorkspacePath.trim();
      const localPathChanged =
        trimmedLocalPath !== (initialLocalWorkspacePath ?? "").trim();

      let orbitFields: {
        orbit_owner?: string;
        orbit_repo?: string;
        git_repo_url?: string;
      } = {};
      if (!hasLinkedOrbit && isAuthenticated && orbitOwner) {
        if (orbitRepoMode === "existing") {
          if (!selectedOrbitRepo) {
            setError("Select an existing Orbit repo to link.");
            setSaving(false);
            return;
          }
          const dup = projects.find(
            (p) =>
              p.project_id !== project.project_id &&
              p.orbit_owner === selectedOrbitRepo.owner &&
              p.orbit_repo === selectedOrbitRepo.name,
          );
          if (dup) {
            setError(`Orbit repo already used by project "${dup.name}".`);
            setSaving(false);
            return;
          }
          orbitFields = {
            orbit_owner: selectedOrbitRepo.owner,
            orbit_repo: selectedOrbitRepo.name,
            git_repo_url:
              selectedOrbitRepo.clone_url ??
              `${selectedOrbitRepo.owner}/${selectedOrbitRepo.name}`,
          };
        } else {
          const repoSlug =
            orbitRepoMode === "custom"
              ? orbitRepoName.trim() || proposedRepoSlug
              : proposedRepoSlug;
          const dup = projects.find(
            (p) =>
              p.project_id !== project.project_id &&
              p.orbit_owner === orbitOwner &&
              p.orbit_repo === repoSlug,
          );
          if (dup) {
            setError(`Orbit repo already used by project "${dup.name}".`);
            setSaving(false);
            return;
          }
          orbitFields = {
            orbit_owner: orbitOwner,
            orbit_repo: repoSlug,
          };
        }
      }

      const trimmedGitRepoUrl =
        orbitFields.git_repo_url ?? gitRepoUrl.trim() ?? "";
      const updated = await api.updateProject(project.project_id, {
        git_repo_url: trimmedGitRepoUrl || undefined,
        git_branch: gitBranch.trim() || undefined,
        ...(orbitFields.orbit_owner ? { orbit_owner: orbitFields.orbit_owner } : {}),
        ...(orbitFields.orbit_repo ? { orbit_repo: orbitFields.orbit_repo } : {}),
        ...(localPathChanged
          ? { local_workspace_path: trimmedLocalPath ? trimmedLocalPath : null }
          : {}),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    project,
    gitRepoUrl,
    gitBranch,
    localWorkspacePath,
    initialLocalWorkspacePath,
    onSaved,
    onClose,
    hasLinkedOrbit,
    isAuthenticated,
    orbitOwner,
    orbitRepoMode,
    orbitRepoName,
    proposedRepoSlug,
    selectedOrbitRepo,
    projects,
  ]);

  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Project settings"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? <><Spinner size="sm" /> Saving...</> : "Save"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className={styles.loadingPad}>
          <Spinner size="md" />
        </div>
      ) : (
        <div className={styles.formColumn}>
          <Tabs
            tabs={SETTINGS_TABS}
            value={activeTab}
            onChange={(id) => setActiveTab(id as ProjectSettingsTab)}
            className={styles.tabsHeader}
          />
          {activeTab === "general" && (
            <>
              <Text variant="muted" size="sm" className={styles.sectionLabel}>
                Local workspace
              </Text>
              <FolderPickerField
                label=""
                value={localWorkspacePath}
                onChange={setLocalWorkspacePath}
                disabled={saving}
                defaultPath={defaultWorkspacePath}
              />
            </>
          )}
          {activeTab === "appearance" && project && (
            <AppearanceTab
              projectId={project.project_id}
              projectName={project.name}
            />
          )}
          {activeTab === "integrations" && (
            <>
              <Text variant="muted" size="sm" className={styles.sectionLabel}>
                Github
              </Text>
              <Input
                value={gitRepoUrl}
                onChange={(e) => setGitRepoUrl(e.target.value)}
                placeholder="Git remote URL"
              />
              <Input
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                placeholder="Branch (e.g. main)"
              />
              <Text variant="muted" size="sm" className={styles.sectionLabelTop}>
                Orbit
              </Text>
              {hasLinkedOrbit ? (
                <Input value={orbitUrl} readOnly disabled />
              ) : (
                <OrbitRepoSection
                  isAuthenticated={isAuthenticated}
                  orbitOwner={orbitOwner}
                  orbitRepoMode={orbitRepoMode}
                  setOrbitRepoMode={setOrbitRepoMode}
                  orbitRepoName={orbitRepoName}
                  setOrbitRepoName={setOrbitRepoName}
                  proposedRepoSlug={proposedRepoSlug}
                  displayRepoName={displayRepoName}
                  orbitRepos={orbitRepos}
                  orbitReposLoading={orbitReposLoading}
                  selectedOrbitRepo={selectedOrbitRepo}
                  setSelectedOrbitRepo={setSelectedOrbitRepo}
                />
              )}
              {project?.orbit_owner && project?.orbit_repo && (
                <>
                  <Text variant="muted" size="sm" className={styles.sectionLabelTop}>
                    Repo collaborators
                  </Text>
                  {collaboratorsLoading ? (
                    <Spinner size="sm" />
                  ) : collaborators && collaborators.length > 0 ? (
                    <ul className={styles.collaboratorList}>
                      {collaborators.map((c, i) => (
                        <li key={c.user_id ?? c.username ?? i}>
                          {c.display_name ?? c.username ?? c.user_id ?? "—"} ({c.role})
                          {c.role === "owner" ? " — can add people" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : collaborators?.length === 0 ? (
                    <Text variant="muted" size="sm">No collaborators returned.</Text>
                  ) : null}
                  <Text variant="muted" size="xs">
                    Repo owner and users with owner role can add people.
                  </Text>
                </>
              )}
            </>
          )}
          {error && (
            <Text variant="muted" size="sm" className={styles.dangerText}>
              {error}
            </Text>
          )}
        </div>
      )}
    </Modal>
  );
}

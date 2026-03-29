import { useState, useEffect, useCallback } from "react";
import { api, type OrbitCollaborator } from "../../api/client";
import type { Project } from "../../types";

interface ProjectSettingsData {
  project: Project | null;
  gitRepoUrl: string;
  setGitRepoUrl: (v: string) => void;
  gitBranch: string;
  setGitBranch: (v: string) => void;
  collaborators: OrbitCollaborator[] | null;
  collaboratorsLoading: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  handleSave: () => Promise<void>;
}

export function useProjectSettingsData(
  target: Project | null,
  onSaved: (project: Project) => void,
  onClose: () => void,
): ProjectSettingsData {
  const [project, setProject] = useState<Project | null>(null);
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [collaborators, setCollaborators] = useState<OrbitCollaborator[] | null>(null);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) {
      setProject(null); setCollaborators(null); return;
    }
    setLoading(true); setError("");
    api.getProject(target.project_id)
      .then((p) => {
        setProject(p);
        setGitRepoUrl(p.git_repo_url ?? "");
        setGitBranch(p.git_branch ?? "main");
      })
      .catch(() => setError("Failed to load project"))
      .finally(() => setLoading(false));
  }, [target?.project_id]);

  useEffect(() => {
    if (!project?.orbit_owner || !project?.orbit_repo) {
      setCollaborators(null); return;
    }
    setCollaboratorsLoading(true);
    api.listProjectOrbitCollaborators(project.project_id)
      .then(setCollaborators)
      .catch(() => setCollaborators([]))
      .finally(() => setCollaboratorsLoading(false));
  }, [project?.project_id, project?.orbit_owner, project?.orbit_repo]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true); setError("");
    try {
      const updated = await api.updateProject(project.project_id, {
        git_repo_url: gitRepoUrl.trim() || undefined,
        git_branch: gitBranch.trim() || undefined,
      });
      onSaved(updated); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }, [project, gitRepoUrl, gitBranch, onSaved, onClose]);

  return {
    project, gitRepoUrl, setGitRepoUrl, gitBranch, setGitBranch,
    collaborators, collaboratorsLoading, loading, saving, error, handleSave,
  };
}

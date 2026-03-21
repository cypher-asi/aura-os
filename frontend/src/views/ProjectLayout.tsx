import { useEffect, useState, useCallback, useMemo, useLayoutEffect, type SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { useParams, useNavigate, Outlet } from "react-router-dom";
import { api } from "../api/client";
import type { Project, Spec, Task } from "../types";
import type { EngineEvent } from "../types/events";
import { useProjectRegister } from "../context/ProjectContext";
import { useEventContext } from "../context/EventContext";
import { EmptyState } from "../components/EmptyState";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { Button } from "@cypher-asi/zui";
import { ArrowLeft } from "lucide-react";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects } = useProjectsList();
  const cachedProject = useMemo(
    () => projects.find((candidate) => candidate.project_id === projectId) ?? null,
    [projectId, projects],
  );

  const [project, setProjectRaw] = useState<Project | null>(() => cachedProject);
  const [initialSpecs, setInitialSpecs] = useState<Spec[]>([]);
  const [initialTasks, setInitialTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(() => cachedProject == null);
  const [message, setMessage] = useState("");
  const { register, unregister } = useProjectRegister();
  const { subscribe } = useEventContext();

  const displayProject = useMemo(() => {
    if (project && project.project_id === projectId) return project;
    return cachedProject;
  }, [project, projectId, cachedProject]);

  const setProjectSafe = useCallback((update: SetStateAction<Project>) => {
    if (typeof update === "function") {
      setProjectRaw(prev => prev ? update(prev) : prev);
    } else {
      setProjectRaw(update);
    }
  }, []);

  // Synchronously reset stale data when projectId changes (React set-state-during-render pattern)
  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setInitialSpecs([]);
    setInitialTasks([]);
    if (!cachedProject) {
      setLoading(true);
    } else {
      setLoading(false);
    }
  }

  // Pick up cachedProject when it arrives after mount
  const [prevCached, setPrevCached] = useState(cachedProject);
  if (cachedProject !== prevCached) {
    setPrevCached(cachedProject);
    if (cachedProject && !project) {
      setProjectRaw(cachedProject);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    Promise.all([
      api.getProject(projectId),
      api.listSpecs(projectId).catch(() => [] as Spec[]),
      api.listTasks(projectId).catch(() => [] as Task[]),
    ])
      .then(([proj, specs, tasks]) => {
        if (cancelled) return;
        setProjectRaw(proj);
        setInitialSpecs(specs.sort((a, b) => a.order_index - b.order_index));
        setInitialTasks(tasks.sort((a, b) => a.order_index - b.order_index));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    return subscribe("spec_gen_completed", (e: EngineEvent) => {
      if (e.project_id === projectId) {
        api.getProject(projectId).then(setProjectRaw).catch(() => {});
      }
    });
  }, [projectId, setProjectSafe, subscribe]);

  useLayoutEffect(() => {
    if (!displayProject) {
      unregister();
      return;
    }

    const handleArchive = async () => {
      try {
        await api.archiveProject(displayProject.project_id);
        navigate("/projects");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to archive");
      }
    };

    const navigateToExecution = () => {
      navigate(`/projects/${displayProject.project_id}/execution`);
    };

    register({
      project: displayProject,
      setProject: setProjectSafe,
      message,
      handleArchive,
      navigateToExecution,
      initialSpecs,
      initialTasks,
    });

    return () => unregister();
  }, [displayProject, initialSpecs, initialTasks, message, navigate, register, setProjectSafe, unregister]);

  if (loading && !displayProject) {
    return (
      <EmptyState>
        <Loader2 size={20} className="spin" />
      </EmptyState>
    );
  }
  if (!displayProject) {
    if (projects.length === 0) {
      return (
        <EmptyState>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
            <strong>No project selected</strong>
            <span>Create a project to get started.</span>
          </div>
        </EmptyState>
      );
    }

    return (
      <EmptyState>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
          <strong>Project not found</strong>
          <span>Choose a project from navigation to continue.</span>
          <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => navigate("/projects")}>
            Back to Projects
          </Button>
        </div>
      </EmptyState>
    );
  }

  return <Outlet />;
}

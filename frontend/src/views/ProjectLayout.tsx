import { useEffect, useState, useCallback, useMemo, useLayoutEffect, type SetStateAction } from "react";
import { useParams, useNavigate, Outlet } from "react-router-dom";
import { api } from "../api/client";
import type { Project, Spec, Task } from "../types";
import type { EngineEvent } from "../types/events";
import { useProjectRegister } from "../context/ProjectContext";
import { useEventContext } from "../context/EventContext";
import { EmptyState } from "../components/EmptyState";
import { useProjectsList } from "../apps/projects/useProjectsList";

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

  const setProjectSafe = useCallback((update: SetStateAction<Project>) => {
    if (typeof update === "function") {
      setProjectRaw(prev => prev ? update(prev) : prev);
    } else {
      setProjectRaw(update);
    }
  }, []);

  useEffect(() => {
    if (!cachedProject) return;
    setProjectRaw((prev) => prev ?? cachedProject);
    setLoading(false);
  }, [cachedProject]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (!cachedProject) {
        setLoading(true);
      }
      setProjectRaw((prev) => prev?.project_id === projectId ? prev : cachedProject);
      setInitialSpecs([]);
      setInitialTasks([]);
    });
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
      .catch(() => { if (!cancelled) setProjectRaw(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [cachedProject, projectId]);

  useEffect(() => {
    if (!projectId) return;
    return subscribe("spec_gen_completed", (e: EngineEvent) => {
      if (e.project_id === projectId) {
        api.getProject(projectId).then(setProjectRaw).catch(() => {});
      }
    });
  }, [projectId, setProjectSafe, subscribe]);

  useLayoutEffect(() => {
    if (!project) {
      unregister();
      return;
    }

    const handleArchive = async () => {
      try {
        await api.archiveProject(project.project_id);
        navigate("/projects");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to archive");
      }
    };

    const navigateToExecution = () => {
      navigate(`/projects/${project.project_id}/execution`);
    };

    register({
      project,
      setProject: setProjectSafe,
      message,
      handleArchive,
      navigateToExecution,
      initialSpecs,
      initialTasks,
    });

    return () => unregister();
  }, [project, initialSpecs, initialTasks, message, navigate, register, setProjectSafe, unregister]);

  if (loading) return null;
  if (!project) return <EmptyState>Project not found</EmptyState>;
  if (project.project_id !== projectId) return null;

  return <Outlet />;
}

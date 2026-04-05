import { useEffect, useRef, useState, useCallback, useMemo, type SetStateAction } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Project, Spec, Task } from "../../types";
import { EventType } from "../../types/aura-events";
import { useProjectRegister } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useSidekickStore } from "../../stores/sidekick-store";
import { compareSpecs } from "../../utils/collections";

interface ProjectLayoutData {
  displayProject: Project | null;
  initialSpecs: Spec[];
  initialTasks: Task[];
  loading: boolean;
  projects: Project[];
}

export function useProjectLayoutData(): ProjectLayoutData {
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
  const subscribe = useEventStore((s) => s.subscribe);

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

  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setInitialSpecs([]);
    setInitialTasks([]);
    if (!cachedProject) setLoading(true);
    else setLoading(false);
  }

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
        setInitialSpecs(specs.sort(compareSpecs));
        setInitialTasks(tasks.sort((a, b) => a.order_index - b.order_index));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    return subscribe(EventType.SpecGenCompleted, (e) => {
      if (e.project_id === projectId) {
        api.getProject(projectId).then(setProjectRaw).catch(() => {});
      }
    });
  }, [projectId, setProjectSafe, subscribe]);

  const streamingId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const prevStreamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const wasStreaming = prevStreamingIdRef.current != null;
    prevStreamingIdRef.current = streamingId;
    if (wasStreaming && streamingId == null && projectId) {
      Promise.all([
        api.listSpecs(projectId).catch(() => [] as Spec[]),
        api.listTasks(projectId).catch(() => [] as Task[]),
      ]).then(([specs, tasks]) => {
        setInitialSpecs(specs.sort(compareSpecs));
        setInitialTasks(tasks.sort((a, b) => a.order_index - b.order_index));
      });
    }
  }, [streamingId, projectId]);

  useEffect(() => {
    if (!displayProject) { unregister(); return; }

    const handleArchive = async () => {
      try {
        await api.archiveProject(displayProject.project_id);
        navigate("/projects");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to archive");
      }
    };

    register({
      project: displayProject,
      setProject: setProjectSafe,
      message,
      handleArchive,
      navigateToExecution: () => navigate(`/projects/${displayProject.project_id}/execution`),
      initialSpecs,
      initialTasks,
    });

    return () => unregister();
  }, [displayProject, initialSpecs, initialTasks, message, navigate, register, setProjectSafe, unregister]);

  return { displayProject, initialSpecs, initialTasks, loading, projects };
}

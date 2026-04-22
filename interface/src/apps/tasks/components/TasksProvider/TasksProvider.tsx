import { useEffect, useState, useMemo, useCallback, type ReactNode, type SetStateAction } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../../../api/client";
import type { Project, Spec, Task } from "../../../../types";
import { useProjectRegister } from "../../../../stores/project-action-store";
import { useProjectsList } from "../../../projects/useProjectsList";
import { compareSpecs } from "../../../../utils/collections";
import { useSidekickStore } from "../../../../stores/sidekick-store";

export function TasksProvider({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // The sidekick defaults to the tasks tab whenever the user enters the Tasks
  // app. Because this provider only mounts under `/tasks/*` routes, the tab
  // selection is naturally scoped to genuine app entry and unmounts on exit.
  useEffect(() => {
    useSidekickStore.getState().setActiveTab("tasks");
  }, []);
  const { projects } = useProjectsList();
  const { register, unregister } = useProjectRegister();

  const cachedProject = useMemo(
    () => projects.find((p) => p.project_id === projectId) ?? null,
    [projectId, projects],
  );

  const [project, setProjectRaw] = useState<Project | null>(() => cachedProject);
  const [initialSpecs, setInitialSpecs] = useState<Spec[]>([]);
  const [initialTasks, setInitialTasks] = useState<Task[]>([]);

  const setProjectSafe = useCallback((update: SetStateAction<Project>) => {
    if (typeof update === "function") {
      setProjectRaw((prev) => (prev ? update(prev) : prev));
    } else {
      setProjectRaw(update);
    }
  }, []);

  const displayProject = useMemo(() => {
    if (project && project.project_id === projectId) return project;
    return cachedProject;
  }, [project, projectId, cachedProject]);

  useEffect(() => {
    if (cachedProject && !project) {
      setProjectRaw(cachedProject);
    }
  }, [cachedProject, project]);

  useEffect(() => {
    if (!projectId) return;
    setInitialSpecs([]);
    setInitialTasks([]);
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
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const handleArchive = useCallback(async () => {
    if (!displayProject) {
      return;
    }

    try {
      await api.archiveProject(displayProject.project_id);
      navigate("/tasks");
    } catch {
      /* handled by caller */
    }
  }, [displayProject, navigate]);

  const navigateToExecution = useCallback(() => {
    if (!displayProject) {
      return;
    }

    navigate(`/projects/${displayProject.project_id}/execution`);
  }, [displayProject, navigate]);

  useEffect(() => {
    if (!displayProject) {
      unregister();
      return;
    }

    register({
      project: displayProject,
      setProject: setProjectSafe,
      message: "",
      handleArchive,
      navigateToExecution,
      initialSpecs,
      initialTasks,
    });
  }, [displayProject, handleArchive, initialSpecs, initialTasks, navigateToExecution, register, setProjectSafe, unregister]);

  // Keep the shared project context stable across ordinary data refreshes.
  // Cleaning up in the registration effect creates a one-render gap where the
  // sidekick sees no project context and briefly unmounts.
  useEffect(() => unregister, [unregister]);

  return <>{children}</>;
}

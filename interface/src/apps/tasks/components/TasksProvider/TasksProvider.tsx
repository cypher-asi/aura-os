import { useEffect, useState, useMemo, useCallback, type ReactNode, type SetStateAction } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../../../api/client";
import type { Project, Spec, Task } from "../../../../types";
import { useProjectRegister } from "../../../../stores/project-action-store";
import { useProjectsList } from "../../../projects/useProjectsList";
import { compareSpecs } from "../../../../utils/collections";

export function TasksProvider({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!displayProject) {
      unregister();
      return;
    }

    const handleArchive = async () => {
      try {
        await api.archiveProject(displayProject.project_id);
        navigate("/tasks");
      } catch {
        /* handled by caller */
      }
    };

    register({
      project: displayProject,
      setProject: setProjectSafe,
      message: "",
      handleArchive,
      navigateToExecution: () =>
        navigate(`/projects/${displayProject.project_id}/execution`),
      initialSpecs,
      initialTasks,
    });

    return () => {
      unregister();
    };
  }, [displayProject, initialSpecs, initialTasks, navigate, register, setProjectSafe, unregister]);

  return <>{children}</>;
}

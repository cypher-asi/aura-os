import { useEffect, useRef, useState, useCallback, useMemo, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Project, Spec, Task } from "../../types";
import { EventType } from "../../types/aura-events";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { projectLayoutQueryOptions, projectQueryKeys, type ProjectLayoutBundle } from "../../queries/project-queries";
import { useProjectRegister } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import { useSidekickStore } from "../../stores/sidekick-store";

interface ProjectLayoutData {
  displayProject: Project | null;
  initialSpecs: Spec[];
  initialTasks: Task[];
  loading: boolean;
  loadingProjects: boolean;
  projects: Project[];
}

export function useProjectLayoutData(): ProjectLayoutData {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projects, loadingProjects, setProjects } = useProjectsList();
  const cachedProject = useMemo(
    () => projects.find((candidate) => candidate.project_id === projectId) ?? null,
    [projectId, projects],
  );

  const [message, setMessage] = useState("");
  const { register, unregister } = useProjectRegister();
  const subscribe = useEventStore((s) => s.subscribe);
  const layoutQuery = useQuery({
    ...(projectId ? projectLayoutQueryOptions(projectId) : projectLayoutQueryOptions("")),
    enabled: Boolean(projectId),
    initialData:
      projectId && cachedProject
        ? {
            project: cachedProject,
            specs: [] as Spec[],
            tasks: [] as Task[],
          }
        : undefined,
    initialDataUpdatedAt: 0,
  });

  const displayProject = layoutQuery.data?.project ?? cachedProject;
  const initialSpecs = layoutQuery.data?.specs ?? [];
  const initialTasks = layoutQuery.data?.tasks ?? [];
  const loading = Boolean(projectId) && layoutQuery.isPending && !displayProject;

  const setProjectSafe = useCallback((update: SetStateAction<Project>) => {
    if (!projectId) return;

    queryClient.setQueryData<ProjectLayoutBundle | undefined>(
      projectQueryKeys.layout(projectId),
      (current) => {
        const currentProject = current?.project ?? cachedProject;
        if (!currentProject) return current;
        const nextProject =
          typeof update === "function" ? update(currentProject) : update;
        return {
          project: nextProject,
          specs: current?.specs ?? [],
          tasks: current?.tasks ?? [],
        };
      },
    );

    setProjects((currentProjects) =>
      currentProjects.map((candidate) => {
        if (candidate.project_id !== projectId) return candidate;
        return typeof update === "function" ? update(candidate) : update;
      }),
    );
  }, [cachedProject, projectId, queryClient, setProjects]);

  useEffect(() => {
    if (!projectId) return;
    return subscribe(EventType.SpecGenCompleted, (e) => {
      if (e.project_id === projectId) {
        void queryClient.invalidateQueries({
          queryKey: projectQueryKeys.layout(projectId),
        });
      }
    });
  }, [projectId, queryClient, subscribe]);

  const streamingId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const prevStreamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const wasStreaming = prevStreamingIdRef.current != null;
    prevStreamingIdRef.current = streamingId;
    if (wasStreaming && streamingId == null && projectId) {
      void queryClient.invalidateQueries({
        queryKey: projectQueryKeys.layout(projectId),
      });
    }
  }, [projectId, queryClient, streamingId]);

  useEffect(() => {
    if (!displayProject) { unregister(); return; }

    const handleArchive = async () => {
      try {
        await api.archiveProject(displayProject.project_id);
        await queryClient.invalidateQueries({ queryKey: projectQueryKeys.root });
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
  }, [
    displayProject,
    initialSpecs,
    initialTasks,
    message,
    navigate,
    queryClient,
    register,
    setProjectSafe,
    unregister,
  ]);

  return { displayProject, initialSpecs, initialTasks, loading, loadingProjects, projects };
}

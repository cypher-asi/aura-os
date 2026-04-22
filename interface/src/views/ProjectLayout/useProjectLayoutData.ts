import { useEffect, useRef, useState, useCallback, useMemo, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Project, Spec, Task } from "../../types";
import { EventType } from "../../types/aura-events";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import {
  mergeSpecIntoProjectLayout,
  mergeTaskIntoProjectLayout,
  patchTaskStatusInProjectLayout,
  projectLayoutQueryOptions,
  projectQueryKeys,
  type ProjectLayoutBundle,
} from "../../queries/project-queries";
import { useProjectRegister } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import { useSidekickStore } from "../../stores/sidekick-store";
import {
  useTaskOutputPanelStore,
  type PanelTaskStatus,
} from "../../stores/task-output-panel-store";

interface ProjectLayoutData {
  displayProject: Project | null;
  initialSpecs: Spec[];
  initialTasks: Task[];
  loading: boolean;
  loadingProjects: boolean;
  projects: Project[];
}

const EMPTY_SPECS: Spec[] = [];
const EMPTY_TASKS: Task[] = [];

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
  const initialSpecs = layoutQuery.data?.specs ?? EMPTY_SPECS;
  const initialTasks = layoutQuery.data?.tasks ?? EMPTY_TASKS;
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

  useEffect(() => {
    if (!projectId) return;
    const unsubs = [
      subscribe(EventType.SpecSaved, (e) => {
        if (e.project_id !== projectId || !e.content.spec) return;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => mergeSpecIntoProjectLayout(current, e.content.spec),
        );
      }),
      subscribe(EventType.TaskSaved, (e) => {
        if (e.project_id !== projectId || !e.content.task) return;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => mergeTaskIntoProjectLayout(current, e.content.task),
        );
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        const taskId = e.content.task_id;
        const sessionId = e.session_id;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => patchTaskStatusInProjectLayout(current, taskId, {
            status: "in_progress",
            ...(sessionId ? { session_id: sessionId } : {}),
          }),
        );
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        const { task_id, execution_notes, files } = e.content;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => patchTaskStatusInProjectLayout(current, task_id, {
            status: "done",
            execution_notes,
            ...(files ? { files_changed: files } : {}),
          }),
        );
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        const taskId = e.content.task_id;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => patchTaskStatusInProjectLayout(current, taskId, { status: "failed" }),
        );
      }),
      subscribe(EventType.TaskBecameReady, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        const taskId = e.content.task_id;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => patchTaskStatusInProjectLayout(current, taskId, { status: "ready" }),
        );
      }),
      subscribe(EventType.TasksBecameReady, (e) => {
        if (e.project_id !== projectId || !e.content.task_ids?.length) return;
        const taskIds = e.content.task_ids;
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) =>
            taskIds.reduce<ProjectLayoutBundle | undefined>(
              (acc, taskId) =>
                patchTaskStatusInProjectLayout(acc, taskId, { status: "ready" }),
              current,
            ),
        );
      }),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [projectId, queryClient, subscribe]);

  // Boot-time reconciliation: when `GET /projects/:pid/tasks` finishes we
  // have the authoritative per-task status. Push it into the output
  // panel store so rehydrated "active" rows whose runs finished while
  // the UI was closed get the correct final badge instead of blindly
  // being marked "interrupted" (or, worse, staying stuck on "active").
  const reconcilePanelStatuses = useTaskOutputPanelStore((s) => s.reconcileStatuses);
  useEffect(() => {
    if (!projectId) return;
    if (!initialTasks.length) return;
    const updates: Array<{ taskId: string; status: PanelTaskStatus; title?: string }> = [];
    for (const task of initialTasks) {
      if (!task.task_id) continue;
      let next: PanelTaskStatus;
      switch (task.status) {
        case "in_progress":
          next = "active";
          break;
        case "done":
          next = "completed";
          break;
        case "failed":
          next = "failed";
          break;
        default:
          // backlog / to_do / pending / ready / blocked — the server does
          // not consider this task "running", so a previously-active
          // panel row represents a run that was cut off.
          next = "interrupted";
          break;
      }
      updates.push({ taskId: task.task_id, status: next, title: task.title });
    }
    reconcilePanelStatuses(updates);
  }, [projectId, initialTasks, reconcilePanelStatuses]);

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

  const handleArchive = useCallback(async () => {
    if (!displayProject) {
      return;
    }

    try {
      await api.archiveProject(displayProject.project_id);
      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.root });
      navigate("/projects");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to archive");
    }
  }, [displayProject, navigate, queryClient]);

  const navigateToExecution = useCallback(() => {
    if (!displayProject) {
      return;
    }

    navigate(`/projects/${displayProject.project_id}/execution`);
  }, [displayProject, navigate]);

  useEffect(() => {
    if (!displayProject) { unregister(); return; }

    register({
      project: displayProject,
      setProject: setProjectSafe,
      message,
      handleArchive,
      navigateToExecution,
      initialSpecs,
      initialTasks,
    });
  }, [
    displayProject,
    initialSpecs,
    initialTasks,
    message,
    register,
    setProjectSafe,
    handleArchive,
    navigateToExecution,
    unregister,
  ]);

  // Preserve the registered project actions across query/cache updates so the
  // sidekick does not briefly lose context and blink out between re-renders.
  useEffect(() => unregister, [unregister]);

  return { displayProject, initialSpecs, initialTasks, loading, loadingProjects, projects };
}

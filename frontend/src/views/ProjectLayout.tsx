import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Outlet } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";
import type { EngineEvent } from "../types/events";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { useProjectRegister } from "../context/ProjectContext";
import { PageEmptyState, Spinner } from "@cypher-asi/zui";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [message, setMessage] = useState("");
  const { subscribe } = useEventContext();
  const sidekick = useSidekick();
  const genAbortRef = useRef<AbortController | null>(null);
  const { register, unregister } = useProjectRegister();

  useEffect(() => {
    const unsubs = [
      subscribe("spec_gen_completed", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setGenLoading(false);
        }
      }),
      subscribe("spec_gen_failed", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setGenLoading(false);
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [projectId, subscribe]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  useEffect(() => {
    if (!project) return;

    const handleGenerateSpecs = async () => {
      const controller = new AbortController();
      genAbortRef.current = controller;
      setGenLoading(true);
      setMessage("");
      sidekick.startStreaming("Generating Specs");
      sidekick.setActiveTab("specs");
      await api.generateSpecsStream(project.project_id, {
        onProgress(stage) {
          sidekick.setStreamStage(stage);
        },
        onDelta(text) {
          sidekick.appendDelta(text);
        },
        onGenerating(tokens) {
          sidekick.setTokenCount(tokens);
        },
        onSpecSaved(spec) {
          sidekick.appendSavedSpec(spec);
        },
        onTaskSaved(_task) {
          sidekick.incrementTaskCount();
        },
        onComplete(specs) {
          genAbortRef.current = null;
          setMessage(`Generated ${specs.length} spec files`);
          setGenLoading(false);
          sidekick.finishStreaming();
        },
        onError(msg) {
          genAbortRef.current = null;
          setMessage(msg);
          setGenLoading(false);
          sidekick.finishStreaming();
        },
      }, controller.signal);
    };

    const handleStopGeneration = () => {
      genAbortRef.current?.abort();
      genAbortRef.current = null;
      setGenLoading(false);
      setMessage("");
      sidekick.finishStreaming();
    };

    const handleArchive = async () => {
      try {
        const updated = await api.archiveProject(project.project_id);
        setProject(updated);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to archive");
      }
    };

    const navigateToExecution = () => {
      navigate(`/projects/${project.project_id}/execution`);
    };

    register({
      project,
      setProject,
      genLoading,
      message,
      handleGenerateSpecs,
      handleStopGeneration,
      handleArchive,
      navigateToExecution,
    });
  }, [project, genLoading, message, navigate, register, sidekick]);

  if (loading) return <Spinner />;
  if (!project) {
    return <PageEmptyState title="Project not found" />;
  }

  return <Outlet />;
}

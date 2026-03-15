import { useEffect, useState, useCallback, type SetStateAction } from "react";
import { useParams, useNavigate, Outlet } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";
import type { EngineEvent } from "../types/events";
import { useProjectRegister } from "../context/ProjectContext";
import { useEventContext } from "../context/EventContext";
import { PageEmptyState, Spinner } from "@cypher-asi/zui";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProjectRaw] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
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
    if (!projectId) return;
    setLoading(true);
    api
      .getProject(projectId)
      .then(setProjectRaw)
      .catch(() => setProjectRaw(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    return subscribe("spec_gen_completed", (e: EngineEvent) => {
      if (e.project_id === projectId) {
        api.getProject(projectId).then(setProjectRaw).catch(() => {});
      }
    });
  }, [projectId, subscribe]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  useEffect(() => {
    if (!project) return;

    const handleArchive = async () => {
      try {
        await api.archiveProject(project.project_id);
        navigate("/");
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
    });
  }, [project, message, navigate, register]);

  if (loading) return <Spinner />;
  if (!project) {
    return <PageEmptyState title="Project not found" />;
  }

  return <Outlet />;
}

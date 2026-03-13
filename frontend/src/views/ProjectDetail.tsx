import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";
import type { EngineEvent } from "../types/events";
import { useEventContext } from "../context/EventContext";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader, PageEmptyState, Panel, Button, Spinner, Tabs, Text } from "@cypher-asi/zui";
import { Play, Archive } from "lucide-react";
import styles from "./aura.module.css";

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [genStage, setGenStage] = useState("");
  const [genTokens, setGenTokens] = useState(0);
  const [extractLoading, setExtractLoading] = useState(false);
  const [message, setMessage] = useState("");
  const { subscribe } = useEventContext();

  useEffect(() => {
    const unsubs = [
      subscribe("spec_gen_started", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setGenStage("Starting spec generation...");
        }
      }),
      subscribe("spec_gen_progress", (e: EngineEvent) => {
        if (e.project_id === projectId && e.stage) {
          setGenStage(e.stage);
        }
      }),
      subscribe("spec_gen_completed", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setGenStage("");
        }
      }),
      subscribe("spec_gen_failed", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setGenStage("");
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

  if (loading) return <Spinner />;
  if (!project) {
    return <PageEmptyState title="Project not found" />;
  }

  const handleGenerateSpecs = async () => {
    setGenLoading(true);
    setGenStage("");
    setGenTokens(0);
    setMessage("");
    await api.generateSpecsStream(project.project_id, {
      onProgress(stage) {
        setGenStage(stage);
      },
      onGenerating(tokens) {
        setGenTokens(tokens);
      },
      onComplete(specs) {
        setMessage(`Generated ${specs.length} spec files`);
        setGenLoading(false);
        setGenStage("");
        setGenTokens(0);
      },
      onError(msg) {
        setMessage(msg);
        setGenLoading(false);
        setGenStage("");
        setGenTokens(0);
      },
    });
  };

  const handleExtractTasks = async () => {
    setExtractLoading(true);
    setMessage("");
    try {
      const tasks = await api.extractTasks(project.project_id);
      setMessage(`Extracted ${tasks.length} tasks`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to extract tasks");
    } finally {
      setExtractLoading(false);
    }
  };

  const handleArchive = async () => {
    try {
      const updated = await api.archiveProject(project.project_id);
      setProject(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to archive");
    }
  };

  return (
    <div>
      <PageHeader title={project.name} subtitle={project.description} />

      <Panel variant="solid" border="solid" borderRadius="md" style={{ padding: "var(--space-5)", marginBottom: "var(--space-5)" }}>
        <div className={styles.infoGrid}>
          <Text variant="muted" size="sm" as="span">Status</Text>
          <span><StatusBadge status={project.current_status} /></span>
          <Text variant="muted" size="sm" as="span">Folder</Text>
          <Text size="sm" as="span">{project.linked_folder_path || "—"}</Text>
          <Text variant="muted" size="sm" as="span">Requirements</Text>
          <Text size="sm" as="span">{project.requirements_doc_path || "—"}</Text>
          <Text variant="muted" size="sm" as="span">Created</Text>
          <Text size="sm" as="span">{new Date(project.created_at).toLocaleString()}</Text>
        </div>
      </Panel>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center", marginBottom: "var(--space-5)" }}>
        <Button variant="primary" size="sm" onClick={handleGenerateSpecs} disabled={genLoading}>
          {genLoading ? <><Spinner size="sm" /> Generating...</> : "Generate Specs"}
        </Button>
        {genLoading && genStage && (
          <span className={styles.progressStage}>
            {genStage}{genTokens > 0 ? ` — ${genTokens.toLocaleString()} tokens generated` : ""}
          </span>
        )}
        <Button variant="primary" size="sm" onClick={handleExtractTasks} disabled={extractLoading}>
          {extractLoading ? <><Spinner size="sm" /> Extracting...</> : "Extract Tasks"}
        </Button>
        <Button variant="filled" size="sm" icon={<Play size={14} />} onClick={() => navigate(`/projects/${project.project_id}/execution`)}>
          Start Dev Loop
        </Button>
        {project.current_status !== "archived" && (
          <Button variant="danger" size="sm" icon={<Archive size={14} />} onClick={handleArchive}>
            Archive
          </Button>
        )}
      </div>

      {message && <Text variant="secondary" size="sm" style={{ marginBottom: "var(--space-4)" }}>{message}</Text>}

      <Tabs
        tabs={[
          { id: "specs", label: "Specs" },
          { id: "tasks", label: "Tasks" },
          { id: "progress", label: "Progress" },
        ]}
        onChange={(id) => navigate(`/projects/${project.project_id}/${id}`)}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useMatch, Outlet } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";
import type { EngineEvent } from "../types/events";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { StatusBadge } from "../components/StatusBadge";
import { PageEmptyState, Button, Spinner, Tabs, Text } from "@cypher-asi/zui";
import { Play, Archive, FileText, ListChecks, Info } from "lucide-react";
import styles from "./aura.module.css";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const match = useMatch("/projects/:projectId/:tab/*");
  const activeTab = match?.params.tab ?? "specs";

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);
  const [message, setMessage] = useState("");
  const { subscribe } = useEventContext();
  const sidekick = useSidekick();
  const genAbortRef = useRef<AbortController | null>(null);

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

  if (loading) return <Spinner />;
  if (!project) {
    return <PageEmptyState title="Project not found" />;
  }

  const handleGenerateSpecs = async () => {
    const controller = new AbortController();
    genAbortRef.current = controller;
    setGenLoading(true);
    setMessage("");
    sidekick.startStreaming("Generating Specs");
    let navigated = false;
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
        if (!navigated) {
          navigated = true;
          navigate(`/projects/${project.project_id}/specs`);
        }
      },
      onComplete(specs) {
        genAbortRef.current = null;
        setMessage(`Generated ${specs.length} spec files`);
        setGenLoading(false);
        sidekick.finishStreaming();
        if (!navigated) {
          navigate(`/projects/${project.project_id}/specs`);
        }
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
      {message && <Text variant="secondary" size="sm" style={{ marginBottom: "var(--space-4)" }}>{message}</Text>}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <Tabs
          tabs={[
            { id: "specs", label: "Specs" },
            { id: "tasks", label: "Tasks" },
            { id: "progress", label: "Progress" },
          ]}
          value={activeTab}
          onChange={(id) => navigate(`/projects/${project.project_id}/${id}`)}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
          {genLoading ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={
                <span className={styles.stopIcon}>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <circle className={styles.stopRing} cx="14" cy="14" r="12" stroke="var(--color-danger, #ef4444)" strokeWidth="2" strokeDasharray="22 54" strokeLinecap="round" />
                    <circle cx="14" cy="14" r="8.5" stroke="var(--color-danger, #ef4444)" strokeWidth="1" opacity="0.25" fill="none" />
                    <rect x="9.5" y="9.5" width="9" height="9" rx="0.75" fill="var(--color-danger, #ef4444)" />
                  </svg>
                </span>
              }
              onClick={handleStopGeneration}
              title="Stop Generation"
            />
          ) : (
            <Button variant="ghost" size="sm" iconOnly icon={<FileText size={16} />} onClick={handleGenerateSpecs} title="Generate Specs" />
          )}
          <Button variant="ghost" size="sm" iconOnly icon={extractLoading ? <Spinner size="sm" /> : <ListChecks size={16} />} onClick={handleExtractTasks} disabled={extractLoading} title="Extract Tasks" />
          <Button variant="filled" size="sm" iconOnly icon={<Play size={16} />} onClick={() => navigate(`/projects/${project.project_id}/execution`)} title="Start Dev Loop" />
          {project.current_status !== "archived" && (
            <Button variant="danger" size="sm" iconOnly icon={<Archive size={16} />} onClick={handleArchive} title="Archive" />
          )}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Info size={16} />}
            onClick={() => sidekick.toggleInfo(
              "Project Info",
              <div className={styles.infoGrid}>
                <Text variant="muted" size="sm" as="span">Status</Text>
                <span><StatusBadge status={project.current_status} /></span>
                <Text variant="muted" size="sm" as="span">Folder</Text>
                <Text size="sm" as="span">{project.linked_folder_path || "—"}</Text>
                <Text variant="muted" size="sm" as="span">Requirements</Text>
                <Text size="sm" as="span">{project.requirements_doc_path || "—"}</Text>
                <Text variant="muted" size="sm" as="span">Created</Text>
                <Text size="sm" as="span">{new Date(project.created_at).toLocaleString()}</Text>
              </div>,
            )}
            title="Project Info"
          />
        </div>
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <Outlet context={{ project, setProject }} />
      </div>
    </div>
  );
}

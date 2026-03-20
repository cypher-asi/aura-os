import { Button, Text } from "@cypher-asi/zui";
import { Bot, CheckSquare, FolderOpen, MessageSquare } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useProjectContext } from "../context/ProjectContext";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { projectAgentRoute, projectFilesRoute, projectWorkRoute } from "../utils/mobileNavigation";
import { AgentSelectorModal } from "../components/AgentSelectorModal";
import type { AgentInstance } from "../types";

interface ProjectEmptyViewProps {
  mode?: "project" | "agent";
}

/**
 * Shown in the main area when a project is selected but has no agent yet.
 * Matches the empty-state style of the right sidebar ("No specs yet").
 */
export function ProjectEmptyView({ mode = "project" }: ProjectEmptyViewProps) {
  const navigate = useNavigate();
  const { isMobileLayout } = useAuraCapabilities();
  const ctx = useProjectContext();
  const { setAgentsByProject } = useProjectsList();
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);

  const handleAgentCreated = (instance: AgentInstance) => {
    setAgentsByProject((prev) => {
      const existing = prev[instance.project_id] ?? [];
      if (existing.some((agent) => agent.agent_instance_id === instance.agent_instance_id)) {
        return prev;
      }
      return {
        ...prev,
        [instance.project_id]: [...existing, instance],
      };
    });
    setAgentSelectorOpen(false);
    navigate(`/projects/${instance.project_id}/agents/${instance.agent_instance_id}`);
  };

  if (isMobileLayout && ctx) {
    const { project } = ctx;

    return (
      <>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
            padding: "var(--space-5)",
            maxWidth: 720,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Text size="xs" variant="muted" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Project
            </Text>
            <Text size="xl" style={{ fontWeight: 700 }}>
              {project.name}
            </Text>
            <Text variant="muted" size="sm">
              {mode === "agent"
                ? "No agent is assigned yet. Add one now, or continue working in Tasks or Files."
                : (project.description?.trim() || "Choose how you want to work in this project.")}
            </Text>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "var(--space-3)",
            }}
          >
            {mode === "agent" ? (
              <Button
                variant="primary"
                icon={<Bot size={16} />}
                onClick={() => setAgentSelectorOpen(true)}
                style={{ justifyContent: "flex-start" }}
              >
                Add Agent
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<MessageSquare size={16} />}
                onClick={() => navigate(projectAgentRoute(project.project_id))}
                style={{ justifyContent: "flex-start" }}
              >
                Open Agent
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<CheckSquare size={16} />}
              onClick={() => navigate(projectWorkRoute(project.project_id))}
              style={{ justifyContent: "flex-start" }}
            >
              Open Tasks
            </Button>
            <Button
              variant="secondary"
              icon={<FolderOpen size={16} />}
              onClick={() => navigate(projectFilesRoute(project.project_id))}
              style={{ justifyContent: "flex-start" }}
            >
              Open Files
            </Button>
          </div>
        </div>

        <AgentSelectorModal
          isOpen={agentSelectorOpen}
          projectId={project.project_id}
          onClose={() => setAgentSelectorOpen(false)}
          onCreated={handleAgentCreated}
        />
      </>
    );
  }

  return (
    <EmptyState icon={<Bot size={32} />}>
      {mode === "agent"
        ? "No agent yet. Add one from project navigation, or continue in Tasks."
        : "No agent yet. Add an agent to get started."}
    </EmptyState>
  );
}

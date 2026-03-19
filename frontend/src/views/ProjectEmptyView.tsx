import { Button, Text } from "@cypher-asi/zui";
import { Bot, CheckSquare, FolderOpen, MessageSquare } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { useNavigate } from "react-router-dom";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useProjectContext } from "../context/ProjectContext";
import { projectAgentRoute, projectFilesRoute, projectWorkRoute } from "../utils/mobileNavigation";

/**
 * Shown in the main area when a project is selected but has no agent yet.
 * Matches the empty-state style of the right sidebar ("No specs yet").
 */
export function ProjectEmptyView() {
  const navigate = useNavigate();
  const { isMobileLayout } = useAuraCapabilities();
  const ctx = useProjectContext();

  if (isMobileLayout && ctx) {
    const { project } = ctx;

    return (
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
            {project.description?.trim() || "Choose how you want to work in this project."}
          </Text>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <Button
            variant="secondary"
            icon={<MessageSquare size={16} />}
            onClick={() => navigate(projectAgentRoute(project.project_id))}
            style={{ justifyContent: "flex-start" }}
          >
            Open Agent
          </Button>
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
    );
  }

  return (
    <EmptyState icon={<Bot size={32} />}>
      No agent yet. Add an agent to get started.
    </EmptyState>
  );
}

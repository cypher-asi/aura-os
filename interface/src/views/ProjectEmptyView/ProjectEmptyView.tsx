import { Button, Text } from "@cypher-asi/zui";
import { Bot, CheckSquare, BarChart3, MessageSquare } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { useNavigate } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectActions } from "../../stores/project-action-store";
import { projectAgentCreateRoute, projectAgentRoute, projectStatsRoute, projectWorkRoute } from "../../utils/mobileNavigation";
import styles from "./ProjectEmptyView.module.css";

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
  const ctx = useProjectActions();

  if (isMobileLayout && ctx) {
    const { project } = ctx;

    return (
      <>
        <div className={styles.mobileLayout}>
          <div className={styles.headerSection}>
            <Text size="xs" variant="muted" className={styles.uppercaseLabel}>
              Project
            </Text>
            <Text size="xl" className={styles.titleBold}>
              {project.name}
            </Text>
            <Text variant="muted" size="sm">
              {mode === "agent"
                ? "No agent is assigned yet. Add one now, or continue working in Execution or Stats."
                : (project.description?.trim() || "Choose how you want to work in this project.")}
            </Text>
          </div>

          <div className={styles.actionGrid}>
            {mode === "agent" ? (
              <Button
                variant="primary"
                icon={<Bot size={16} />}
                onClick={() => navigate(projectAgentCreateRoute(project.project_id))}
                className={styles.actionButtonStart}
              >
                Add Agent
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<MessageSquare size={16} />}
                onClick={() => navigate(projectAgentRoute(project.project_id))}
                className={styles.actionButtonStart}
              >
                Open Agent
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<CheckSquare size={16} />}
              onClick={() => navigate(projectWorkRoute(project.project_id))}
              className={styles.actionButtonStart}
            >
              Open Execution
            </Button>
            <Button
              variant="secondary"
              icon={<BarChart3 size={16} />}
              onClick={() => navigate(projectStatsRoute(project.project_id))}
              className={styles.actionButtonStart}
            >
              Open Stats
            </Button>
          </div>
        </div>

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

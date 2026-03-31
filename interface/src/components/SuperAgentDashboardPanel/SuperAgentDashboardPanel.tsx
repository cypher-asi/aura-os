import { useState, useEffect } from "react";
import { Text, Badge } from "@cypher-asi/zui";
import type { BadgeVariant } from "@cypher-asi/zui";
import { FolderOpen, Bot, Activity } from "lucide-react";
import { api } from "../../api/client";
import { useProjectsListStore } from "../../stores/projects-list-store";
import type { Agent, SuperAgentOrchestration } from "../../types";
import styles from "./SuperAgentDashboardPanel.module.css";

interface SuperAgentDashboardPanelProps {
  agent: Agent;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: "stopped",
  failed: "error",
  executing: "running",
  planning: "provisioning",
  pending: "pending",
};

export function SuperAgentDashboardPanel({ agent: _agent }: SuperAgentDashboardPanelProps) {
  const [orchestrations, setOrchestrations] = useState<SuperAgentOrchestration[]>([]);
  const projects = useProjectsListStore((s) => s.projects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    api.superAgent.listOrchestrations()
      .then(setOrchestrations)
      .catch(() => {});
  }, []);

  const activeProjects = projects.filter((p) => p.current_status === "active");

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <Text size="sm" weight="semibold">CEO Dashboard</Text>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <FolderOpen size={14} />
          <Text size="xs" weight="medium">Projects</Text>
        </div>
        <div className={styles.statGrid}>
          <div className={styles.stat}>
            <Text size="lg" weight="semibold">{projects.length}</Text>
            <Text size="xs" variant="muted">Total</Text>
          </div>
          <div className={styles.stat}>
            <Text size="lg" weight="semibold">{activeProjects.length}</Text>
            <Text size="xs" variant="muted">Active</Text>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Bot size={14} />
          <Text size="xs" weight="medium">Agent Fleet</Text>
        </div>
        <Text size="xs" variant="muted">
          Use &ldquo;get fleet status&rdquo; to see detailed agent information
        </Text>
      </div>

      {orchestrations.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Activity size={14} />
            <Text size="xs" weight="medium">Recent Orchestrations</Text>
          </div>
          <div className={styles.orchestrationList}>
            {orchestrations.slice(0, 5).map((o) => (
              <div key={o.orchestration_id} className={styles.orchestrationRow}>
                <Text size="xs" className={styles.orchestrationIntent}>
                  {o.intent}
                </Text>
                <Badge variant={STATUS_VARIANT[o.status] ?? "pending"}>
                  {o.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

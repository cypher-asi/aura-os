import { Text, Badge } from "@cypher-asi/zui";
import { FolderOpen, Bot, TrendingUp, Coins, Image } from "lucide-react";
import type { ToolCallEntry } from "../../types/stream";
import styles from "./SuperAgentToolCards.module.css";

interface ToolCardProps {
  entry: ToolCallEntry;
}

export function ProjectCard({ entry }: ToolCardProps) {
  const data = parseResult(entry.result);
  if (!data) return null;
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <FolderOpen size={14} />
        <Text size="sm" weight="medium">{data.name || "Project"}</Text>
        {data.current_status && <Badge variant="info">{data.current_status}</Badge>}
      </div>
      {data.description && (
        <Text size="xs" variant="muted" className={styles.description}>{data.description}</Text>
      )}
      {data.project_id && (
        <Text size="xs" variant="muted">ID: {data.project_id}</Text>
      )}
    </div>
  );
}

export function FleetStatusCard({ entry }: ToolCardProps) {
  const data = parseResult(entry.result);
  if (!data) return null;
  const agents = Array.isArray(data) ? data : data.agents || [];
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Bot size={14} />
        <Text size="sm" weight="medium">Fleet Status</Text>
        <Badge variant="info">{agents.length} agents</Badge>
      </div>
      <div className={styles.statusGrid}>
        {agents.slice(0, 6).map((agent: any, i: number) => (
          <div key={i} className={styles.statusRow}>
            <Text size="xs">{agent.name || agent.agent_name || `Agent ${i + 1}`}</Text>
            <Badge variant={agent.status === "working" ? "success" : agent.status === "error" ? "error" : "pending"}>
              {agent.status || "unknown"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressReportCard({ entry }: ToolCardProps) {
  const data = parseResult(entry.result);
  if (!data) return null;
  const projects = Array.isArray(data) ? data : data.projects || [];
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <TrendingUp size={14} />
        <Text size="sm" weight="medium">Progress Report</Text>
      </div>
      {projects.slice(0, 5).map((project: any, i: number) => (
        <div key={i} className={styles.progressRow}>
          <Text size="xs" weight="medium">{project.name || `Project ${i + 1}`}</Text>
          <Text size="xs" variant="muted">{project.current_status || "unknown"}</Text>
        </div>
      ))}
    </div>
  );
}

export function CreditBalanceCard({ entry }: ToolCardProps) {
  const data = parseResult(entry.result);
  if (!data) return null;
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Coins size={14} />
        <Text size="sm" weight="medium">Credit Balance</Text>
      </div>
      <Text size="lg" weight="bold">{data.balance_formatted || `$${((data.balance_cents || 0) / 100).toFixed(2)}`}</Text>
      {data.plan && <Text size="xs" variant="muted">Plan: {data.plan}</Text>}
    </div>
  );
}

export function GenerateImageCard({ entry }: ToolCardProps) {
  const data = parseResult(entry.result);
  if (!data) return null;
  const imageUrl = data.url || data.image_url;
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Image size={14} />
        <Text size="sm" weight="medium">Generated Image</Text>
      </div>
      {imageUrl && (
        <img src={imageUrl} alt="Generated" className={styles.generatedImage} />
      )}
      {data.prompt && (
        <Text size="xs" variant="muted">Prompt: {data.prompt}</Text>
      )}
    </div>
  );
}

const SUPER_AGENT_CARD_MAP: Record<string, React.ComponentType<ToolCardProps>> = {
  create_project: ProjectCard,
  get_project: ProjectCard,
  get_fleet_status: FleetStatusCard,
  get_progress_report: ProgressReportCard,
  get_credit_balance: CreditBalanceCard,
  generate_image: GenerateImageCard,
};

export function getSuperAgentCardRenderer(toolName: string): React.ComponentType<ToolCardProps> | null {
  return SUPER_AGENT_CARD_MAP[toolName] || null;
}

function parseResult(result: string | null | undefined): any {
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

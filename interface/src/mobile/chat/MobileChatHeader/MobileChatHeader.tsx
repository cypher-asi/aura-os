import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import styles from "./MobileChatHeader.module.css";

interface MobileChatHeaderProps {
  agentName: string;
  machineType?: "local" | "remote";
  action?: ReactNode;
  onSummaryClick?: () => void;
  summaryTo?: string;
  summaryHint?: string;
  summaryLabel?: string;
  summaryKind?: "details" | "switch";
}

function AgentMark({ name, machineType }: { name: string; machineType?: "local" | "remote" }) {
  const initial = name.trim().charAt(0).toUpperCase() || "A";
  return (
    <span className={styles.agentMark} aria-hidden="true">
      <span>{initial}</span>
      <span className={`${styles.presenceDot} ${machineType === "remote" ? styles.presenceRemote : styles.presenceLocal}`} />
    </span>
  );
}

function HeaderCopy({
  agentName,
  machineType,
  summaryHint,
  isActionable,
}: {
  agentName: string;
  machineType?: "local" | "remote";
  summaryHint?: string;
  isActionable?: boolean;
}) {
  return (
    <>
      <AgentMark name={agentName} machineType={machineType} />
      <span className={styles.copy}>
        <span className={styles.name}>{agentName}</span>
        <span className={styles.hint}>
          {summaryHint
            ?? (isActionable
              ? (machineType === "remote" ? "Open skills and runtime" : "Open agent settings")
              : (machineType === "remote" ? "Remote agent chat" : "Local agent chat"))}
        </span>
      </span>
    </>
  );
}

export function MobileChatHeader({
  agentName,
  machineType,
  action,
  onSummaryClick,
  summaryTo,
  summaryHint,
  summaryLabel,
  summaryKind = "details",
}: MobileChatHeaderProps) {
  const chevron = (
    <span className={styles.chevron} aria-hidden="true">
      {summaryKind === "switch" ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
    </span>
  );

  const content = (
    <HeaderCopy
      agentName={agentName}
      machineType={machineType}
      summaryHint={summaryHint}
      isActionable={Boolean(summaryTo || onSummaryClick)}
    />
  );

  return (
    <div className={styles.header}>
      {summaryTo ? (
        <Link to={summaryTo} className={styles.summaryAction} aria-label={summaryLabel ?? `Open details for ${agentName}`}>
          {content}
          {chevron}
        </Link>
      ) : onSummaryClick ? (
        <button
          type="button"
          className={styles.summaryAction}
          onClick={onSummaryClick}
          aria-label={summaryLabel ?? `Open details for ${agentName}`}
        >
          {content}
          {chevron}
        </button>
      ) : (
        <div className={styles.summaryStatic}>{content}</div>
      )}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

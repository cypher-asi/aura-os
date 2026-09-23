import { Text } from "@cypher-asi/zui";
import { Activity, AlertTriangle, Bot, Clock3, Server } from "lucide-react";
import { useRemoteAgentVm } from "../../apps/agents/components/AgentEnvironment/useRemoteAgentVm";
import { getActionsForState, provisioningPhaseLabel } from "../../apps/agents/components/AgentEnvironment/helpers";
import styles from "../../apps/agents/AgentInfoPanel/AgentInfoPanel.module.css";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60) % 60;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function MobileRemoteRuntimeSection({
  agentId,
  isRemote,
  isOwnAgent,
}: {
  agentId: string;
  isRemote: boolean;
  isOwnAgent: boolean;
}) {
  const {
    vmState,
    remoteStateError,
    remoteStateRecoverable,
    recoveryNotice,
    pendingRecovery,
    actionLoading,
    actionError,
    handleAction,
  } = useRemoteAgentVm({
    isRemote,
    agentId,
  });

  if (!isRemote) {
    return null;
  }

  const actions = remoteStateError
    ? remoteStateRecoverable
      ? [{ action: "recover" as const, label: "Recovery", primary: true, danger: true }]
      : []
    : vmState
      ? getActionsForState(vmState.state)
      : [];
  const busy = Boolean(actionLoading) || pendingRecovery;

  return (
    <div className={styles.section}>
      <Text size="xs" variant="muted" weight="medium">Remote Runtime</Text>
      {!vmState && !remoteStateError ? (
        <Text size="sm" variant="muted">Checking remote agent status…</Text>
      ) : remoteStateError && !vmState ? (
        <div className={`${styles.mobileStatusCard} ${styles.mobileStatusWarning}`}>
          <div className={styles.mobileStatusHeader}>
            <Server size={14} className={styles.mobileStatusIcon} />
            <Text size="sm" weight="medium">Remote agent unavailable</Text>
          </div>
          <Text size="sm" variant="muted">{remoteStateError}</Text>
        </div>
      ) : vmState ? (
        <div className={styles.mobileStatusCard}>
          <div className={styles.mobileStatusHeader}>
            <Server size={14} className={styles.mobileStatusIcon} />
            <Text size="sm" weight="medium">Remote agent is {vmState.state}</Text>
          </div>
          <div className={styles.mobileStatusGrid}>
            <div className={styles.mobileStatusRow}>
              <Clock3 size={12} className={styles.mobileStatusRowIcon} />
              <span className={styles.mobileStatusLabel}>Uptime</span>
              <span className={styles.mobileStatusValue}>{formatUptime(vmState.uptime_seconds)}</span>
            </div>
            <div className={styles.mobileStatusRow}>
              <Activity size={12} className={styles.mobileStatusRowIcon} />
              <span className={styles.mobileStatusLabel}>Sessions</span>
              <span className={styles.mobileStatusValue}>{vmState.active_sessions}</span>
            </div>
            {vmState.endpoint ? (
              <div className={styles.mobileStatusRow}>
                <Server size={12} className={styles.mobileStatusRowIcon} />
                <span className={styles.mobileStatusLabel}>Endpoint</span>
                <span className={styles.mobileStatusValue}>{vmState.endpoint}</span>
              </div>
            ) : null}
            {vmState.runtime_version ? (
              <div className={styles.mobileStatusRow}>
                <Bot size={12} className={styles.mobileStatusRowIcon} />
                <span className={styles.mobileStatusLabel}>Runtime</span>
                <span className={styles.mobileStatusValue}>{vmState.runtime_version}</span>
              </div>
            ) : null}
          </div>
          {vmState.state === "provisioning" || vmState.state === "stopping" ? (
            <Text size="sm" variant="muted">
              {vmState.state === "provisioning"
                ? (pendingRecovery ? "Recovery requested. Starting up…" : provisioningPhaseLabel(vmState))
                : "Shutting down…"}
            </Text>
          ) : null}
          {remoteStateError ? (
            <div className={`${styles.mobileStatusMessage} ${styles.mobileStatusWarning}`} role="alert">
              <AlertTriangle size={12} className={styles.mobileStatusRowIcon} />
              <Text size="xs" variant="muted">{remoteStateError}</Text>
            </div>
          ) : null}
          {vmState.error_message && !remoteStateError ? (
            <div className={`${styles.mobileStatusMessage} ${styles.mobileStatusWarning}`}>
              <AlertTriangle size={12} className={styles.mobileStatusRowIcon} />
              <Text size="xs" variant="muted">{vmState.error_message}</Text>
            </div>
          ) : null}
        </div>
      ) : (
        <Text size="sm" variant="muted">No remote runtime details available yet.</Text>
      )}
      {recoveryNotice ? (
        <div className={`${styles.mobileStatusMessage} ${recoveryNotice.tone === "error" ? styles.mobileStatusWarning : ""}`} role="status">
          <Text size="sm" variant="muted">{recoveryNotice.message}</Text>
        </div>
      ) : null}
      {isOwnAgent && actions.length > 0 ? (
        <div
          className={styles.mobileRuntimeActions}
          role="group"
          aria-label="Remote runtime controls"
        >
          {actions.map((action) => (
            <button
              key={action.action}
              type="button"
              className={`${styles.mobileRuntimeAction} ${action.primary ? styles.mobileRuntimeActionPrimary : ""} ${action.danger ? styles.mobileRuntimeActionDanger : ""}`}
              disabled={busy}
              onClick={() => void handleAction(action.action)}
            >
              {actionLoading === action.action ? `${action.label}…` : action.label}
              {action.hint ? <span>{action.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {actionError ? (
        <div className={`${styles.mobileStatusMessage} ${styles.mobileStatusWarning}`} role="alert">
          <AlertTriangle size={12} className={styles.mobileStatusRowIcon} />
          <Text size="sm" variant="muted">{actionError}</Text>
        </div>
      ) : null}
    </div>
  );
}

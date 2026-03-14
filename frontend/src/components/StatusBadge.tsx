import { Badge } from "@cypher-asi/zui";
import type { BadgeVariant } from "@cypher-asi/zui";

const STATUS_TO_VARIANT: Record<string, BadgeVariant> = {
  pending: "pending",
  ready: "provisioning",
  in_progress: "running",
  done: "stopped",
  failed: "error",
  blocked: "error",
  planning: "pending",
  active: "running",
  paused: "pending",
  completed: "stopped",
  archived: "stopped",
  idle: "stopped",
  starting: "provisioning",
  working: "running",
  stopped: "stopped",
  error: "error",
  rolled_over: "stopped",
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variant = STATUS_TO_VARIANT[status] || "pending";
  const label = status.replace(/_/g, " ");
  const pulse = status === "in_progress" || status === "working" || status === "active" || status === "starting";

  return (
    <Badge variant={variant} pulse={pulse}>
      {label}
    </Badge>
  );
}

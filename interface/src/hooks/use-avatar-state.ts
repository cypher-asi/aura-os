import { useProfileStatusStore } from "../stores/profile-status-store";

const STATUS_MAP: Record<string, string> = {
  running: "running",
  working: "running",
  idle: "idle",
  provisioning: "provisioning",
  hibernating: "hibernating",
  stopping: "stopping",
  stopped: "stopped",
  error: "error",
  blocked: "error",
};

export interface AvatarState {
  status: string | undefined;
  machineType: "local" | "remote";
  isLocal: boolean;
}

/**
 * Single hook for resolving the visual state of any avatar (agent or user).
 * Reads status and machineType from the central profile-status store,
 * normalizes the status string for CSS data-status mapping, and determines
 * whether the entity is local (purple dot) or remote (status-based dot).
 *
 * For local agents without an active status, defaults to "idle" so the
 * purple dot always renders.
 */
export function useAvatarState(id: string | undefined): AvatarState {
  const rawStatus = useProfileStatusStore((s) => (id ? s.statuses[id] : undefined));
  const rawMachineType = useProfileStatusStore((s) => (id ? s.machineTypes[id] : undefined));

  const machineType = rawMachineType ?? "local";
  const isLocal = machineType === "local";
  const normalized = rawStatus ? STATUS_MAP[rawStatus.toLowerCase()] ?? rawStatus : undefined;
  const status = normalized ?? (isLocal ? "idle" : undefined);

  return { status, machineType, isLocal };
}

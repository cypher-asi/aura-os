import { ApiClientError } from "../../../../shared/api/core"
import type { LifecycleAction } from "../../../../shared/api/swarm"
import { getApiErrorMessage } from "../../../../shared/utils/api-errors"

export const POLL_INTERVAL = 15_000
export const STATUS_CARD_GAP = 6
export const STATUS_CARD_MIN_WIDTH = 220
export const STATUS_CARD_VIEWPORT_MARGIN = 8

export interface ActionDef {
  action: LifecycleAction | "recover"
  label: string
  hint?: string
  primary?: boolean
  danger?: boolean
}

export interface RecoveryNotice {
  tone: "info" | "warning" | "error" | "success"
  message: string
}

export const PHASE_NOTICES: Record<string, RecoveryNotice> = {
  deleting: { tone: "info", message: "Deleting old machine..." },
  provisioning: { tone: "info", message: "Provisioning new machine..." },
  waiting_for_ready: { tone: "info", message: "Waiting for machine to come online..." },
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function getRemoteStateErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return "Remote machine state is unavailable. This agent may no longer have an attached remote machine."
    }
    if (error.status === 401) {
      return "Your session expired while loading this remote agent. Sign in again and retry."
    }
  }

  return getApiErrorMessage(error)
}

export function getActionsForState(state: string): ActionDef[] {
  switch (state) {
    case "running":
    case "idle":
      return [
        { action: "hibernate", label: "Hibernate", hint: "stops billing", primary: true },
        { action: "restart", label: "Restart" },
        { action: "stop", label: "Stop" },
      ]
    case "hibernating":
      return [{ action: "wake", label: "Wake", primary: true }]
    case "stopped":
      return [{ action: "start", label: "Start", primary: true }]
    case "error":
      return [
        { action: "recover", label: "Recovery", primary: true, danger: true },
        { action: "stop", label: "Stop" },
      ]
    default:
      return []
  }
}

export function isNodeTarget(target: EventTarget | null): target is Node {
  return typeof Node !== "undefined" && target instanceof Node
}

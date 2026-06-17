import { ApiClientError } from "../../../../shared/api/core"
import type { LifecycleAction } from "../../../../shared/api/swarm"
import type { RemoteVmState } from "../../../../shared/types"
import { getApiErrorMessage } from "../../../../shared/utils/api-errors"

export const POLL_INTERVAL = 15_000
/** Faster poll cadence while the VM is provisioning, for live boot feedback. */
export const PROVISIONING_POLL_INTERVAL = 2_500
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
  starting: { tone: "info", message: "First start failed - auto-recovering..." },
  startup_failed: {
    tone: "error",
    message: "Machine failed to start. Click Recovery to try again.",
  },
}

/**
 * Coarse, at-a-glance boot phase shown under the Provisioning badge. The
 * detailed play-by-play comes from the live VM logs; this is derived from
 * signals already in the state poll: an endpoint (pod IP) means the VM has
 * been scheduled and is booting/attesting, otherwise it is still being placed.
 */
export function provisioningPhaseLabel(vm: RemoteVmState): string {
  return vm.endpoint ? "Booting & attesting…" : "Scheduling machine…"
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Human-readable isolation label. The gateway sends the Debug-lowercased
 * isolation level ("confidentialvm" / "container"); older code only knew
 * "micro_vm", so a confidential SEV-SNP VM was mislabeled as "Container".
 */
export function formatIsolation(isolation: string): string {
  switch (isolation) {
    case "confidentialvm":
    case "confidential_vm":
      return "Confidential VM"
    case "micro_vm":
      return "MicroVM"
    case "container":
      return "Container"
    default:
      return isolation
  }
}

/**
 * Format the VM resource line. When the gateway reports a real pod-VM
 * instance type (confidential agents, whose tier cpu/memory is stripped by
 * the peer-pods webhook), show the actual size as vCPU/GiB plus the instance
 * type. Otherwise fall back to the raw millicore/MB spec.
 */
export function formatResources(vm: RemoteVmState): string {
  const cpu = vm.cpu_millicores
  const mem = vm.memory_mb
  if (vm.vm_instance_type) {
    const parts: string[] = []
    if (cpu) parts.push(`${cpu / 1000} vCPU`)
    if (mem) parts.push(`${Math.round((mem / 1024) * 10) / 10} GiB`)
    const size = parts.join(" · ")
    return size ? `${size} (${vm.vm_instance_type})` : vm.vm_instance_type
  }
  const parts: string[] = []
  if (cpu) parts.push(`${cpu}m CPU`)
  if (mem) parts.push(`${mem}MB RAM`)
  return parts.join(" · ")
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

/**
 * Whether a failed remote-state fetch can be addressed by re-provisioning the
 * machine via the `recover` endpoint. A 401 means the session expired, which
 * recovery cannot fix (the user must re-authenticate), so we hide Recovery in
 * that case. Everything else (404 "machine gone", 5xx, gateway/transport
 * errors) is treated as recoverable.
 */
export function isRecoverableRemoteStateError(error: unknown): boolean {
  if (error instanceof ApiClientError && error.status === 401) {
    return false
  }
  return true
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

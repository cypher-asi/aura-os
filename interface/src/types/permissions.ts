import {
  BookOpen,
  CreditCard,
  Edit3,
  Eye,
  Gamepad2,
  ImagePlus,
  type LucideIcon,
  Megaphone,
  Plus,
  Users,
  Workflow,
} from "lucide-react";
import type { Agent } from "./entities";
import {
  CEO_CORE_CAPABILITY_TYPES,
  type AgentPermissions,
  type Capability,
} from "./permissions-wire";

/**
 * True iff an agent looks like a CEO / super-agent. The canonical signal
 * is a universe-scope permissions bundle that carries every core CEO
 * capability (see `AgentPermissions::ceo_preset`), but we fall back to the
 * `role === "CEO" && name === "CEO"` shape emitted by
 * `ceo_agent_template` so we don't re-trigger bootstrap just because
 * aura-network didn't round-trip the `permissions` column. Callers that
 * need to reason about *capabilities* specifically (e.g. a UI that gates
 * the spawn-agent button) should use `hasSpawnCapability` etc. directly.
 */
export function isSuperAgent(agent: Agent): boolean {
  if (
    hasUniverseScope(agent.permissions) &&
    hasAllCoreCapabilities(agent.permissions)
  ) {
    return true;
  }
  return (
    agent.role?.toLowerCase() === "ceo" &&
    agent.name?.toLowerCase() === "ceo"
  );
}

export function hasUniverseScope(perms: AgentPermissions | undefined): boolean {
  if (!perms) return false;
  const s = perms.scope;
  return (
    (s?.orgs?.length ?? 0) === 0 &&
    (s?.projects?.length ?? 0) === 0 &&
    (s?.agent_ids?.length ?? 0) === 0
  );
}

export function hasAllCoreCapabilities(
  perms: AgentPermissions | undefined,
): boolean {
  if (!perms) return false;
  const present = new Set(perms.capabilities.map((c) => c.type));
  return CEO_CORE_CAPABILITY_TYPES.every((t) => present.has(t));
}

function hasCapabilityType(
  perms: AgentPermissions | undefined,
  type: Capability["type"],
): boolean {
  return !!perms?.capabilities.some((c) => c.type === type);
}

export function hasSpawnCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "spawnAgent");
}

export function hasControlAgentCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "controlAgent");
}

export function hasReadAgentCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "readAgent");
}

/**
 * Human-readable metadata for every `Capability` variant, colocated with the
 * predicates above so the wire types stay the single source of truth and UI
 * surfaces pick up new capabilities by touching only this file.
 */
export const CAPABILITY_LABELS: Record<
  Capability["type"],
  { label: string; description: string; Icon: LucideIcon }
> = {
  spawnAgent: {
    label: "Spawn agents",
    description: "Create new agents.",
    Icon: Plus,
  },
  controlAgent: {
    label: "Control agents",
    description: "Send messages, pause, and stop other agents.",
    Icon: Gamepad2,
  },
  readAgent: {
    label: "Read agents",
    description: "Inspect agent state and transcripts.",
    Icon: Eye,
  },
  manageOrgMembers: {
    label: "Manage org members",
    description: "Invite, remove, and update member roles.",
    Icon: Users,
  },
  manageBilling: {
    label: "Manage billing",
    description: "View and change billing settings.",
    Icon: CreditCard,
  },
  invokeProcess: {
    label: "Invoke processes",
    description: "Run workflows and process nodes.",
    Icon: Workflow,
  },
  postToFeed: {
    label: "Post to feed",
    description: "Publish updates to the org feed.",
    Icon: Megaphone,
  },
  generateMedia: {
    label: "Generate media",
    description: "Produce images and other media.",
    Icon: ImagePlus,
  },
  readProject: {
    label: "Read project",
    description: "View a specific project's contents.",
    Icon: BookOpen,
  },
  writeProject: {
    label: "Write project",
    description: "Edit a specific project's contents.",
    Icon: Edit3,
  },
};

/**
 * Capability variants that carry per-project ids. Everything else is a
 * global toggle and lives in `GLOBAL_CAPABILITY_TYPES`.
 */
export function isProjectScopedCapabilityType(
  t: Capability["type"],
): boolean {
  return t === "readProject" || t === "writeProject";
}

/**
 * The eight non-project-scoped capability variants, in display order. Mirrors
 * `CEO_CORE_CAPABILITY_TYPES` plus `generateMedia`, and is the canonical
 * order the permissions UI renders toggles in.
 */
export const GLOBAL_CAPABILITY_TYPES = [
  "spawnAgent",
  "controlAgent",
  "readAgent",
  "manageOrgMembers",
  "manageBilling",
  "invokeProcess",
  "postToFeed",
  "generateMedia",
] as const satisfies ReadonlyArray<Capability["type"]>;

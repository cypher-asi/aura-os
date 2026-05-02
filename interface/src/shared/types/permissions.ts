import {
  BookOpen,
  CreditCard,
  Edit3,
  Eye,
  Gamepad2,
  ImagePlus,
  List,
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
 * True iff an agent has the explicit CEO bootstrap identity. Do not infer
 * identity from the permissions bundle: ordinary agents can now carry the
 * same full-access capability set as the historical CEO preset.
 *
 * Callers that need to reason about *capabilities* specifically (e.g. a UI
 * that gates the spawn-agent button) should use `hasSpawnCapability` etc.
 * directly.
 */
export function isSuperAgent(agent: Agent): boolean {
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

export function hasListAgentsCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "listAgents");
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
    description: "Create new agents. Enables harness tools: spawn_agent and task.",
    Icon: Plus,
  },
  controlAgent: {
    label: "Control agents",
    description:
      "Send messages, pause, and stop other agents. Enables harness tools: send_to_agent, agent_lifecycle, and delegate_task.",
    Icon: Gamepad2,
  },
  readAgent: {
    label: "Read agents",
    description: "Inspect agent state and transcripts. Enables harness tool: get_agent_state.",
    Icon: Eye,
  },
  listAgents: {
    label: "List agents",
    description: "Discover agents in scope. Enables harness tool: list_agents.",
    Icon: List,
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
  readAllProjects: {
    label: "Read all projects",
    description: "View every project in the org.",
    Icon: BookOpen,
  },
  writeAllProjects: {
    label: "Write all projects",
    description: "Edit every project in the org.",
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
 * The non-project-scoped capability variants, in display order. Mirrors
 * `CEO_CORE_CAPABILITY_TYPES` plus `generateMedia`, and is the canonical
 * order the permissions UI renders toggles in.
 */
export const GLOBAL_CAPABILITY_TYPES = [
  "spawnAgent",
  "controlAgent",
  "readAgent",
  "listAgents",
  "manageOrgMembers",
  "manageBilling",
  "invokeProcess",
  "postToFeed",
  "generateMedia",
] as const satisfies ReadonlyArray<Capability["type"]>;

import type { Project } from "../../shared/types";

/**
 * The reserved "aura-whitepaper" CMS project that backs the public AURA OS
 * whitepaper (`/os`). Mirrors the aura-blog project: the backend gates all
 * writes to this project to system administrators and treats its notes as
 * whitepaper sections (draft/published lifecycle). The id is a fixed
 * reserved UUID so both the API and the client can refer to the same
 * project without a lookup. The note's `blogType` field doubles as the
 * collapsible section key on the public page (e.g. "harness").
 */
export const AURA_WHITEPAPER_PROJECT_ID =
  "00000000-0000-0000-0000-00000000a05a";
export const AURA_WHITEPAPER_PROJECT_NAME = "aura-whitepaper";

/** True when `projectId` is the reserved aura-whitepaper CMS project. */
export function isAuraWhitepaperProject(
  projectId: string | null | undefined,
): boolean {
  return projectId === AURA_WHITEPAPER_PROJECT_ID;
}

/**
 * Build a synthetic `Project` row for the virtual aura-whitepaper CMS
 * project. Like {@link buildAuraBlogProject}, this is never persisted to
 * the projects store — it only exists so the Notes left-nav (which maps
 * over `Project` objects) can render the aura-whitepaper tree for sys
 * admins. Only `project_id` / `name` are read by the nav + tree code; the
 * remaining required fields get sensible defaults so the object satisfies
 * the `Project` shape.
 */
export function buildAuraWhitepaperProject(orgId: string): Project {
  const now = new Date().toISOString();
  return {
    project_id: AURA_WHITEPAPER_PROJECT_ID,
    org_id: orgId,
    name: AURA_WHITEPAPER_PROJECT_NAME,
    description: "AURA OS whitepaper CMS",
    current_status: "active",
    created_at: now,
    updated_at: now,
  };
}

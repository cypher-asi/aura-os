import type { Project } from "../../shared/types";

/**
 * The reserved "aura-docs" CMS project that backs the public documentation
 * site (`/docs`). Mirrors the aura-blog / aura-whitepaper projects: the
 * backend gates all writes to this project to system administrators and
 * treats its notes as documentation pages (draft/published lifecycle). The
 * id is a fixed reserved UUID so both the API and the client can refer to
 * the same project without a lookup. The note's `blogType` field doubles as
 * the collapsible repository/section group key on the public page (e.g.
 * "aura-os-server").
 */
export const AURA_DOCS_PROJECT_ID = "00000000-0000-0000-0000-00000000d0c5";
export const AURA_DOCS_PROJECT_NAME = "aura-docs";

/** True when `projectId` is the reserved aura-docs CMS project. */
export function isAuraDocsProject(
  projectId: string | null | undefined,
): boolean {
  return projectId === AURA_DOCS_PROJECT_ID;
}

/**
 * Build a synthetic `Project` row for the virtual aura-docs CMS project.
 * Like {@link buildAuraWhitepaperProject}, this is never persisted to the
 * projects store — it only exists so the Notes left-nav (which maps over
 * `Project` objects) can render the aura-docs tree for sys admins. Only
 * `project_id` / `name` are read by the nav + tree code; the remaining
 * required fields get sensible defaults so the object satisfies the
 * `Project` shape.
 */
export function buildAuraDocsProject(orgId: string): Project {
  const now = new Date().toISOString();
  return {
    project_id: AURA_DOCS_PROJECT_ID,
    org_id: orgId,
    name: AURA_DOCS_PROJECT_NAME,
    description: "AURA documentation CMS",
    current_status: "active",
    created_at: now,
    updated_at: now,
  };
}

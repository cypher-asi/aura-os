/**
 * One-time seeding routine for the aura-whitepaper CMS (the public `/os`
 * page). Mirrors {@link seedAuraBlog}: it runs entirely in the
 * authenticated browser session (the logged-in sys admin's JWT is threaded
 * automatically by `apiFetch`), so it needs no tokens or DB access.
 *
 * For each section that does not already exist (matched by slug) it:
 *   1. creates the note row under the aura-whitepaper project,
 *   2. uploads the markdown body to S3 via the presign flow,
 *   3. updates the row with the section key (`blogType`), sortOrder, and
 *      excerpt,
 *   4. transitions it to `published`.
 *
 * The public `/os` page groups published sections by `blogType` into the
 * collapsible left-nav, ordered by `sortOrder` (ascending).
 */

import { api } from "../../../api/client";
import { uploadMarkdown } from "../../../api/upload";
import type { Note } from "../../../shared/api/notes";
import { AURA_WHITEPAPER_PROJECT_ID } from "../aura-whitepaper";
import { WHITEPAPER_SECTIONS } from "./sections";

export type SeedStatus = "created" | "updated" | "skipped" | "error";

export interface SeedResult {
  slug: string;
  title: string;
  status: SeedStatus;
  message?: string;
}

/** Count whitespace-separated words for the note's `wordCount` field. */
function wordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

/**
 * Create and publish the AURA OS whitepaper sections. Idempotent: sections
 * whose slug already exists in the project have their metadata refreshed
 * rather than duplicated, so re-running heals/updates in place. Per-section
 * failures are captured in the result list instead of aborting the run.
 */
export async function seedAuraWhitepaper(): Promise<SeedResult[]> {
  const projectId = AURA_WHITEPAPER_PROJECT_ID;
  const results: SeedResult[] = [];

  let existingBySlug = new Map<string, Note>();
  try {
    const tree = await api.notes.tree(projectId);
    existingBySlug = new Map(
      tree.notes
        .filter((n): n is Note & { slug: string } => Boolean(n.slug))
        .map((n) => [n.slug, n]),
    );
  } catch {
    // If the tree can't be read, fall through: per-section creates will
    // surface their own errors.
  }

  // Publish in authored order so publishedAt is monotonic with sortOrder.
  const ordered = [...WHITEPAPER_SECTIONS].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  for (const section of ordered) {
    try {
      const markdown = section.body;
      const { url, key } = await uploadMarkdown(
        markdown,
        `${section.slug}.md`,
      );

      const existing = existingBySlug.get(section.slug);
      if (existing) {
        await api.notes.updateNote(projectId, existing.id, {
          title: section.title,
          slug: section.slug,
          bodyUrl: url,
          bodyS3Key: key,
          wordCount: wordCount(markdown),
          excerpt: section.excerpt,
          blogType: section.section,
          sortOrder: section.sortOrder,
        });
        if (existing.status !== "published") {
          await api.notes.transitionNote(projectId, existing.id, "published");
        }
        results.push({
          slug: section.slug,
          title: section.title,
          status: "updated",
        });
        continue;
      }

      const note = await api.notes.createNote(projectId, {
        title: section.title,
        slug: section.slug,
      });

      await api.notes.updateNote(projectId, note.id, {
        title: section.title,
        slug: section.slug,
        bodyUrl: url,
        bodyS3Key: key,
        wordCount: wordCount(markdown),
        excerpt: section.excerpt,
        blogType: section.section,
        sortOrder: section.sortOrder,
      });

      await api.notes.transitionNote(projectId, note.id, "published");

      results.push({
        slug: section.slug,
        title: section.title,
        status: "created",
      });
    } catch (err) {
      results.push({
        slug: section.slug,
        title: section.title,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

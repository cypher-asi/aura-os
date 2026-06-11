/**
 * Shared types for the AURA OS whitepaper seed content. Each core repo
 * contributes its own `sections-<repo>.ts` module exporting an array of
 * {@link WhitepaperSection}; `sections.ts` aggregates them into the published
 * `WHITEPAPER_SECTIONS` list.
 */

/**
 * Markdown fence token. Kept as a double-quoted constant so the section
 * bodies can embed fenced code blocks (ASCII diagrams) via interpolation
 * without escaping every backtick.
 */
export const F = "```";

export interface WhitepaperSection {
  /** Human title; also the left-nav label. */
  title: string;
  /** URL slug (stable, kebab-case). */
  slug: string;
  /** Collapsible section group key (e.g. "harness", "aura-router"). */
  section: string;
  /** Within-section order (ascending). */
  sortOrder: number;
  /** Short summary (shown as the section lede / listing). */
  excerpt: string;
  /** Markdown body. */
  body: string;
}

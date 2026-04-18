/**
 * Discoverability setting for an agent. `closed` keeps the agent private to
 * its creator (and their org); `hireable` lists it in the Marketplace so
 * other users can hire it into their projects.
 *
 * Phase 1 encodes this in the agent's `tags` via `LISTING_STATUS_TAG_PREFIX`;
 * Phase 3 promotes it to a dedicated `listing_status` column on the network
 * agent record.
 */
export type AgentListingStatus = "closed" | "hireable";

export const DEFAULT_LISTING_STATUS: AgentListingStatus = "closed";

export const LISTING_STATUS_TAG_PREFIX = "listing_status:";

export function listingStatusFromTags(
  tags: readonly string[] | undefined,
): AgentListingStatus {
  if (!tags || tags.length === 0) return DEFAULT_LISTING_STATUS;
  for (const tag of tags) {
    if (tag.startsWith(LISTING_STATUS_TAG_PREFIX)) {
      const value = tag.slice(LISTING_STATUS_TAG_PREFIX.length).toLowerCase();
      if (value === "hireable" || value === "closed") {
        return value;
      }
    }
  }
  return DEFAULT_LISTING_STATUS;
}

export function mergeListingStatusTag(
  existing: readonly string[] | undefined,
  listingStatus: AgentListingStatus,
): string[] {
  const kept = (existing ?? []).filter(
    (t) => !t.toLowerCase().startsWith(LISTING_STATUS_TAG_PREFIX),
  );
  if (listingStatus !== DEFAULT_LISTING_STATUS) {
    kept.push(`${LISTING_STATUS_TAG_PREFIX}${listingStatus}`);
  }
  return kept;
}

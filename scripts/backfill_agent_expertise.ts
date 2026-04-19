#!/usr/bin/env -S node --experimental-strip-types
/*
 * One-shot migration helper that walks every agent in an aura-network
 * instance and promotes the Phase 1/2 `listing_status:<x>` and
 * `expertise:<slug>` tag encoding onto the Phase 3 typed columns
 * (`listing_status`, `expertise`).
 *
 * Runs in dry-run mode by default; pass `--apply` to actually write.
 *
 *   AURA_NETWORK_BASE_URL=https://network.example.com \
 *   AURA_NETWORK_ADMIN_TOKEN=... \
 *   node --experimental-strip-types scripts/backfill_agent_expertise.ts [--apply]
 *
 * Requires Node >= 22 (for native TypeScript + global `fetch`).
 */

const LISTING_STATUS_PREFIX = "listing_status:";
const EXPERTISE_PREFIX = "expertise:";
const PAGE_LIMIT = 100;

const ALLOWED_STATUS = new Set(["closed", "hireable"]);
const ALLOWED_SLUGS = new Set([
  "coding",
  "cyber-security",
  "ui-ux",
  "design",
  "strategy",
  "accounting",
  "legal",
  "research",
  "marketing",
  "sales",
  "data-analysis",
  "writing",
  "social-media",
  "devops",
  "ml-ai",
  "product-management",
  "operations",
  "finance",
  "customer-support",
  "education",
  "translation",
  "logistics",
]);

type ListingStatus = "closed" | "hireable";

interface NetworkAgent {
  id: string;
  tags?: string[] | null;
  listing_status?: ListingStatus | null;
  expertise?: string[] | null;
}

interface Summary {
  scanned: number;
  skipped_already_populated: number;
  updated: number;
  would_update: number;
  errors: number;
}

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing required env var ${name}`);
  }
  return value.trim();
}

function deriveListingStatus(tags: readonly string[]): ListingStatus {
  for (const tag of tags) {
    if (tag.startsWith(LISTING_STATUS_PREFIX)) {
      const value = tag.slice(LISTING_STATUS_PREFIX.length).toLowerCase();
      if (ALLOWED_STATUS.has(value)) return value as ListingStatus;
    }
  }
  return "closed";
}

function deriveExpertise(tags: readonly string[]): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!tag.startsWith(EXPERTISE_PREFIX)) continue;
    const slug = tag.slice(EXPERTISE_PREFIX.length);
    if (!ALLOWED_SLUGS.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function alreadyPopulated(agent: NetworkAgent): boolean {
  const hasStatus =
    typeof agent.listing_status === "string" && agent.listing_status.length > 0;
  const hasExpertise = Array.isArray(agent.expertise) && agent.expertise.length > 0;
  return hasStatus && hasExpertise;
}

async function listPage(
  baseUrl: string,
  token: string,
  offset: number,
): Promise<NetworkAgent[]> {
  const url = `${baseUrl}/api/agents?limit=${PAGE_LIMIT}&offset=${offset}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
  }
  const body = (await resp.json()) as NetworkAgent[] | { agents: NetworkAgent[] };
  return Array.isArray(body) ? body : body.agents;
}

async function patchAgent(
  baseUrl: string,
  token: string,
  id: string,
  patch: { listing_status?: ListingStatus; expertise?: string[] },
): Promise<void> {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) {
    throw new Error(`PATCH ${url} failed: ${resp.status} ${await resp.text()}`);
  }
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  const baseUrl = requireEnv("AURA_NETWORK_BASE_URL").replace(/\/+$/, "");
  const token = requireEnv("AURA_NETWORK_ADMIN_TOKEN");

  const summary: Summary = {
    scanned: 0,
    skipped_already_populated: 0,
    updated: 0,
    would_update: 0,
    errors: 0,
  };

  console.log(
    `[backfill] mode=${apply ? "apply" : "dry-run"} base=${baseUrl} page=${PAGE_LIMIT}`,
  );

  let offset = 0;
  while (true) {
    const page = await listPage(baseUrl, token, offset);
    if (page.length === 0) break;

    for (const agent of page) {
      summary.scanned += 1;
      if (alreadyPopulated(agent)) {
        summary.skipped_already_populated += 1;
        continue;
      }

      const tags = Array.isArray(agent.tags) ? agent.tags : [];
      const derivedStatus = deriveListingStatus(tags);
      const derivedExpertise = deriveExpertise(tags);

      const patch: { listing_status?: ListingStatus; expertise?: string[] } = {};
      if (agent.listing_status !== derivedStatus) patch.listing_status = derivedStatus;
      if (!Array.isArray(agent.expertise) || agent.expertise.length === 0) {
        if (derivedExpertise.length > 0) patch.expertise = derivedExpertise;
      }

      if (Object.keys(patch).length === 0) {
        summary.skipped_already_populated += 1;
        continue;
      }

      if (!apply) {
        summary.would_update += 1;
        console.log(`[dry-run] ${agent.id}`, patch);
        continue;
      }

      try {
        await patchAgent(baseUrl, token, agent.id, patch);
        summary.updated += 1;
        console.log(`[update]  ${agent.id}`, patch);
      } catch (err) {
        summary.errors += 1;
        console.error(`[error]   ${agent.id}: ${(err as Error).message}`);
      }
    }

    if (page.length < PAGE_LIMIT) break;
    offset += page.length;
  }

  console.log("[backfill] done", summary);
  if (summary.errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env -S node --experimental-strip-types
/*
 * One-shot repair for agents created before the UI started stamping
 * `org_id` on create (see commit 8a085cc0, "scope agent listing to the
 * active org fleet"). Those rows end up with `org_id IS NULL` in
 * aura-network, and the new org-scoped sidebar filter hides them.
 *
 * The runtime fix in `handlers/agents/crud.rs` keeps those rows visible
 * to their creator via a user-scoped backstop, but they still never
 * appear to teammates. This script patches each NULL-org agent owned
 * by the caller to the caller's chosen org so teammates can see them
 * too.
 *
 * Scope: runs as an authenticated user against aura-network directly;
 * lists their own agents (user-scoped, no `?org_id=`), then PUTs each
 * NULL-org row with `{ org_id }`. Dry-run by default.
 *
 *   AURA_NETWORK_BASE_URL=https://network.example.com \
 *   AURA_NETWORK_USER_JWT=eyJ... \
 *   AURA_TARGET_ORG_ID=org_abc123 \
 *   node --experimental-strip-types scripts/backfill_agent_orgs.ts [--apply]
 *
 * If `AURA_TARGET_ORG_ID` is omitted, the script picks the caller's
 * first org from `GET /api/orgs` and uses that; set it explicitly
 * when you belong to more than one org.
 *
 * Requires aura-network to accept `org_id` on `PUT /api/agents/:id`
 * (not currently exposed via aura-os-server's `UpdateAgentRequest`,
 * so aim this at aura-network directly). If aura-network silently
 * drops the field, no rows will be updated — re-run with `--verify`
 * to detect.
 *
 * Requires Node >= 22 (native TypeScript + global `fetch`).
 */

const PAGE_LIMIT = 100;

interface NetworkAgent {
  id: string;
  name: string;
  user_id?: string | null;
  org_id?: string | null;
}

interface NetworkOrg {
  org_id: string;
  name: string;
}

interface Summary {
  scanned: number;
  skipped_already_scoped: number;
  skipped_not_owned: number;
  updated: number;
  would_update: number;
  verify_mismatched: number;
  errors: number;
}

function parseArgs(argv: string[]): { apply: boolean; verify: boolean } {
  return {
    apply: argv.includes("--apply"),
    verify: argv.includes("--verify"),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing required env var ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

async function listOrgs(baseUrl: string, jwt: string): Promise<NetworkOrg[]> {
  const resp = await fetch(`${baseUrl}/api/orgs`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!resp.ok) {
    throw new Error(`GET /api/orgs failed: ${resp.status} ${await resp.text()}`);
  }
  const body = (await resp.json()) as NetworkOrg[] | { orgs: NetworkOrg[] };
  return Array.isArray(body) ? body : body.orgs;
}

async function listAgentsPage(
  baseUrl: string,
  jwt: string,
  offset: number,
): Promise<NetworkAgent[]> {
  const url = `${baseUrl}/api/agents?limit=${PAGE_LIMIT}&offset=${offset}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!resp.ok) {
    throw new Error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
  }
  const body = (await resp.json()) as NetworkAgent[] | { agents: NetworkAgent[] };
  return Array.isArray(body) ? body : body.agents;
}

async function getAgent(
  baseUrl: string,
  jwt: string,
  id: string,
): Promise<NetworkAgent> {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(id)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!resp.ok) {
    throw new Error(`GET ${url} failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as NetworkAgent;
}

async function patchAgentOrg(
  baseUrl: string,
  jwt: string,
  id: string,
  orgId: string,
): Promise<void> {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ org_id: orgId }),
  });
  if (!resp.ok) {
    throw new Error(`PUT ${url} failed: ${resp.status} ${await resp.text()}`);
  }
}

async function main(): Promise<void> {
  const { apply, verify } = parseArgs(process.argv.slice(2));
  const baseUrl = requireEnv("AURA_NETWORK_BASE_URL").replace(/\/+$/, "");
  const jwt = requireEnv("AURA_NETWORK_USER_JWT");
  let targetOrgId = optionalEnv("AURA_TARGET_ORG_ID");

  if (!targetOrgId) {
    const orgs = await listOrgs(baseUrl, jwt);
    if (orgs.length === 0) {
      throw new Error(
        "caller has no orgs; create one first or set AURA_TARGET_ORG_ID explicitly",
      );
    }
    if (orgs.length > 1) {
      const names = orgs.map((o) => `${o.name} (${o.org_id})`).join(", ");
      throw new Error(
        `caller has multiple orgs — set AURA_TARGET_ORG_ID to one of: ${names}`,
      );
    }
    targetOrgId = orgs[0].org_id;
  }

  const summary: Summary = {
    scanned: 0,
    skipped_already_scoped: 0,
    skipped_not_owned: 0,
    updated: 0,
    would_update: 0,
    verify_mismatched: 0,
    errors: 0,
  };

  console.log(
    `[backfill-orgs] mode=${apply ? "apply" : "dry-run"}${verify ? " (+verify)" : ""} base=${baseUrl} target_org=${targetOrgId} page=${PAGE_LIMIT}`,
  );

  let offset = 0;
  while (true) {
    const page = await listAgentsPage(baseUrl, jwt, offset);
    if (page.length === 0) break;

    for (const agent of page) {
      summary.scanned += 1;
      if (typeof agent.org_id === "string" && agent.org_id.length > 0) {
        summary.skipped_already_scoped += 1;
        continue;
      }

      if (!apply) {
        summary.would_update += 1;
        console.log(`[dry-run] ${agent.id} (${agent.name}) -> org_id=${targetOrgId}`);
        continue;
      }

      try {
        await patchAgentOrg(baseUrl, jwt, agent.id, targetOrgId);
        if (verify) {
          const refreshed = await getAgent(baseUrl, jwt, agent.id);
          if (refreshed.org_id !== targetOrgId) {
            summary.verify_mismatched += 1;
            console.warn(
              `[verify]  ${agent.id}: org_id still ${refreshed.org_id ?? "null"} after PUT — aura-network likely drops org_id on update`,
            );
            continue;
          }
        }
        summary.updated += 1;
        console.log(`[update]  ${agent.id} (${agent.name}) -> org_id=${targetOrgId}`);
      } catch (err) {
        summary.errors += 1;
        console.error(`[error]   ${agent.id}: ${(err as Error).message}`);
      }
    }

    if (page.length < PAGE_LIMIT) break;
    offset += page.length;
  }

  console.log("[backfill-orgs] done", summary);
  if (summary.errors > 0 || summary.verify_mismatched > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Cleanup script: lists all orgs, identifies test-org-* ones, and tries to delete them.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", ".env");

function loadEnv() {
  try {
    const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

loadEnv();

const BASE = process.env.AURA_NETWORK_URL?.replace(/\/$/, "");
const JWT = process.env.AURA_NETWORK_AUTH_TOKEN;

if (!BASE || !JWT) {
  console.error("Missing AURA_NETWORK_URL or AURA_NETWORK_AUTH_TOKEN in .env");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${JWT}`,
  "Content-Type": "application/json",
};

// 1. List all orgs
console.log(`\nFetching orgs from ${BASE}/api/orgs ...`);
const listRes = await fetch(`${BASE}/api/orgs`, { headers });
if (!listRes.ok) {
  console.error(`Failed to list orgs: ${listRes.status} ${await listRes.text()}`);
  process.exit(1);
}

const orgs = await listRes.json();
console.log(`Found ${orgs.length} total orgs:\n`);

const testOrgs = [];
for (const org of orgs) {
  const isTest = org.name?.startsWith("test-org-");
  const marker = isTest ? " [TEST]" : "";
  console.log(`  ${org.id}  ${org.name}${marker}`);
  if (isTest) testOrgs.push(org);
}

if (testOrgs.length === 0) {
  console.log("\nNo test orgs to clean up.");
  process.exit(0);
}

console.log(`\n${testOrgs.length} test org(s) to delete. Cascade-deleting dependents first...\n`);

async function cascadeDeleteOrg(org) {
  console.log(`--- ${org.name} (${org.id}) ---`);

  // 1. Delete projects belonging to this org
  try {
    const projRes = await fetch(`${BASE}/api/projects?org_id=${org.id}`, { headers });
    if (projRes.ok) {
      const projects = await projRes.json();
      for (const p of projects) {
        const r = await fetch(`${BASE}/api/projects/${p.id}`, { method: "DELETE", headers });
        console.log(`  DELETE project ${p.name} (${p.id}): ${r.status}`);
      }
    }
  } catch (e) {
    console.log(`  (projects cleanup error: ${e.message})`);
  }

  // 2. Delete agents belonging to this org
  try {
    const agentRes = await fetch(`${BASE}/api/agents?org_id=${org.id}`, { headers });
    if (agentRes.ok) {
      const agents = await agentRes.json();
      for (const a of agents) {
        const r = await fetch(`${BASE}/api/agents/${a.id}`, { method: "DELETE", headers });
        console.log(`  DELETE agent ${a.name} (${a.id}): ${r.status}`);
      }
    }
  } catch (e) {
    console.log(`  (agents cleanup error: ${e.message})`);
  }

  // 3. Revoke pending invites
  try {
    const invRes = await fetch(`${BASE}/api/orgs/${org.id}/invites`, { headers });
    if (invRes.ok) {
      const invites = await invRes.json();
      for (const inv of invites) {
        const r = await fetch(`${BASE}/api/orgs/${org.id}/invites/${inv.id}`, { method: "DELETE", headers });
        console.log(`  DELETE invite ${inv.id}: ${r.status}`);
      }
    }
  } catch (e) {
    console.log(`  (invites cleanup error: ${e.message})`);
  }

  // 4. Remove non-owner members
  try {
    const memRes = await fetch(`${BASE}/api/orgs/${org.id}/members`, { headers });
    if (memRes.ok) {
      const members = await memRes.json();
      for (const m of members) {
        if (m.userId === org.ownerUserId || m.user_id === org.owner_user_id) continue;
        const uid = m.userId || m.user_id;
        const r = await fetch(`${BASE}/api/orgs/${org.id}/members/${uid}`, { method: "DELETE", headers });
        console.log(`  DELETE member ${uid}: ${r.status}`);
      }
    }
  } catch (e) {
    console.log(`  (members cleanup error: ${e.message})`);
  }

  // 5. Finally delete the org
  const res = await fetch(`${BASE}/api/orgs/${org.id}`, { method: "DELETE", headers });
  const body = await res.text().catch(() => "");
  console.log(`  DELETE org: ${res.status} ${body.slice(0, 200)}`);
  console.log();
}

for (const org of testOrgs) {
  await cascadeDeleteOrg(org);
}

console.log("\nDone.");

# scripts

Operational helper scripts for aura-os. Each entry here is meant to be
runnable standalone; none are wired into CI.

## `migrate-process-to-project.{sh,ps1}`

Legacy helper for the Process → Project data migration. See the script
source for details.

## `backfill_agent_expertise.ts`

One-shot migration helper that walks every agent in an aura-network
instance and promotes the Phase 1/2 `listing_status:<x>` /
`expertise:<slug>` tag encoding onto the Phase 3 typed columns
(`listing_status`, `expertise`). Companion to
`docs/migrations/2026-04-17-marketplace-agent-fields.md`.

Dry run (default):

```bash
AURA_NETWORK_BASE_URL=https://network.example.com \
AURA_NETWORK_ADMIN_TOKEN=... \
node --experimental-strip-types scripts/backfill_agent_expertise.ts
```

Apply:

```bash
AURA_NETWORK_BASE_URL=https://network.example.com \
AURA_NETWORK_ADMIN_TOKEN=... \
node --experimental-strip-types scripts/backfill_agent_expertise.ts --apply
```

Requires Node >= 22 for native TypeScript parsing and the global
`fetch`. Paginates `GET /api/agents?limit=100&offset=...` until
exhausted; issues `PATCH /api/agents/:id` with the derived fields.
Agents whose typed fields are already populated are skipped. Prints a
per-agent diff in dry-run mode and a final summary either way.

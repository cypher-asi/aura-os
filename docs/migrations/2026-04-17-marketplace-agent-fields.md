# Marketplace agent fields on aura-network

- Date: 2026-04-17
- Author: aura-os-server team
- Status: Proposed

Summary: promote the marketplace listing/expertise/stats fields from the
Phase 1/2 `tags[]` convention to first-class columns on the aura-network
`agents` table so Marketplace listing, filtering, and sorting can be done
with indexed SQL instead of tag-array scans.

## Motivation

Phases 1 and 2 of the Marketplace feature (shipped in aura-os-server and
the desktop client) used the existing `agents.tags TEXT[]` column to
encode marketplace-only state as two tag prefixes:

- `listing_status:<closed|hireable>` — whether the agent is listed for
  hire.
- `expertise:<slug>` — one tag per expertise category (see the canonical
  slug registry in `aura_os_core::expertise::ALLOWED_SLUGS`).

That was the smallest-possible change for the initial UI stub, but it
does not scale. Sorting the Marketplace by `Trending` / `Latest` /
`Revenue` / `Reputation`, and filtering by expertise, both need indexed
reads that the tag convention cannot serve efficiently. Revenue,
reputation, and job-count stats do not even fit the tag shape — they are
scalars with an obvious typed encoding. Phase 3 therefore promotes them
to dedicated columns and adds indexes that match the actual query
shapes.

This artifact describes the schema change, the query/API contract that
aura-os-server expects, and the rollout plan. The aura-network service
lives in a separate repository, so the actual DDL lands there; this
document is the handoff.

## Schema changes

Additive, nullable-with-default, safe to deploy before writers flip.

```sql
ALTER TABLE agents
  ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'closed'
    CHECK (listing_status IN ('closed', 'hireable')),
  ADD COLUMN expertise      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN jobs           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN revenue_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN reputation     REAL NOT NULL DEFAULT 0;
```

Notes:

- `listing_status` is an enum with exactly two values today. Using `TEXT`
  with a `CHECK` constraint avoids a Postgres enum type that is awkward
  to extend; aura-os-server accepts the same two values case-
  insensitively and rejects anything else with `400`.
- `expertise` is modelled as `TEXT[]` rather than JSONB. Array equality
  and `&&` (overlaps) are indexable via GIN, queries are short, and the
  typed shape is opaque to callers anyway. JSONB would only be needed if
  we wanted arbitrary per-slug metadata — we don't.
- `jobs` is a monotonic counter, `revenue_usd` is the lifetime gross
  revenue from hired work, and `reputation` is a 0..5 average scaled to
  `REAL`. All three are computed server-side (see the `agent_stats`
  view below) and are treated as read-only by aura-os-server.
- Defaults keep existing rows valid the moment the migration lands; no
  backfill is required to *read* the new columns.

## Indexes

```sql
-- Trending / Latest sorts on the listable roster.
CREATE INDEX agents_hireable_listed_at_idx
  ON agents (listed_at DESC)
  WHERE listing_status = 'hireable';

-- Expertise filter.
CREATE INDEX agents_expertise_gin_idx
  ON agents USING GIN (expertise);

-- Trending / Revenue / Reputation sorts, partial on the listable roster.
CREATE INDEX agents_hireable_jobs_idx
  ON agents (jobs DESC)
  WHERE listing_status = 'hireable';

CREATE INDEX agents_hireable_revenue_idx
  ON agents (revenue_usd DESC)
  WHERE listing_status = 'hireable';

CREATE INDEX agents_hireable_reputation_idx
  ON agents (reputation DESC)
  WHERE listing_status = 'hireable';
```

Partial indexes are worth the DDL cost here because the non-hireable
partition dwarfs the hireable partition in practice (most agents are
private to their creator).

## `agent_stats` view

`jobs`, `revenue_usd`, and `reputation` are derived, not primary. aura-
network owns the upstream sources (tasks / billing / reviews); this doc
only fixes the shape aura-os-server consumes. Proposal: a materialized
view refreshed nightly.

```sql
CREATE MATERIALIZED VIEW agent_stats AS
SELECT
  a.id                                             AS agent_id,
  COALESCE(COUNT(DISTINCT t.id),             0)    AS jobs,
  COALESCE(SUM(t.billed_amount_usd),         0.0)  AS revenue_usd,
  COALESCE(AVG(r.score)::REAL,               0.0)  AS reputation
FROM agents a
LEFT JOIN tasks   t ON t.completed_by_agent_id = a.id AND t.status = 'done'
LEFT JOIN reviews r ON r.subject_agent_id     = a.id
GROUP BY a.id;

CREATE UNIQUE INDEX agent_stats_agent_id_idx ON agent_stats (agent_id);
```

Refresh cadence: a nightly cron calls
`REFRESH MATERIALIZED VIEW CONCURRENTLY agent_stats;` plus an hourly
refresh for freshly-hireable agents so a flipped listing becomes
visible within an hour. A refresh job propagates the values onto the
`agents` row via:

```sql
UPDATE agents a
SET jobs        = s.jobs,
    revenue_usd = s.revenue_usd,
    reputation  = s.reputation
FROM agent_stats s
WHERE s.agent_id = a.id;
```

Writing the denormalized values onto `agents` lets the API route
return them in one query without a join and keeps the sort indexes
local to the `agents` table.

Acceptable staleness: up to 24 h for closed agents; up to 1 h for
hireable agents. Live/real-time is out of scope for Phase 3.

## API contract — `GET /api/agents`

Query parameters (all optional, additive):

| Param            | Type                                             | Notes |
| ---------------- | ------------------------------------------------ | ----- |
| `listing_status` | `closed` \| `hireable`                           | Exact match. |
| `expertise`      | slug string, repeatable                          | AND semantics across repeats; each value matches if the agent's `expertise` array contains it (`expertise @> ARRAY[$1]`). |
| `sort`           | `trending` \| `latest` \| `revenue` \| `reputation` | See sort semantics in `aura_os_server::handlers::marketplace`. |
| `limit`          | integer, default 50, max 100                     | |
| `offset`         | integer, default 0                               | |

Response per agent (`NetworkAgent` in `aura-os-network`):

```jsonc
{
  "id": "...",
  "name": "...",
  "listing_status": "hireable",
  "expertise": ["coding", "devops"],
  "jobs": 142,
  "revenue_usd": 48200.0,
  "reputation": 4.92,
  // ... existing fields (role, tags, machine_type, …) unchanged
}
```

- Keep the `total_revenue_usd` alias on `PlatformStats` responses; it is
  already aliased to `revenue_usd` for back-compat.
- For a transitional window (see Rollout §1–§3 below), tags containing
  `listing_status:<x>` and `expertise:<slug>` will still exist; the new
  columns are authoritative and the API response is the typed fields.

`PATCH /api/agents/:id` accepts the same typed fields (`listing_status`
and `expertise`) as optional writeable columns; see the backfill script
in `scripts/backfill_agent_expertise.ts` for a concrete client.

## Rollout

1. Deploy schema additive. All columns default to safe values; existing
   writers and readers are unaffected.
2. Backfill: for every row, translate the existing `tags` array to the
   typed columns.
   ```sql
   UPDATE agents
   SET listing_status = CASE
         WHEN tags && ARRAY['listing_status:hireable'] THEN 'hireable'
         ELSE 'closed'
       END,
       expertise = (
         SELECT COALESCE(ARRAY_AGG(split_part(t, ':', 2)), '{}')
         FROM unnest(tags) AS t
         WHERE t LIKE 'expertise:%'
       );
   ```
   An operational alternative is the `scripts/backfill_agent_expertise.ts`
   client (see P3.4); the SQL path is preferred when aura-network can
   run it in a transaction.
3. Deploy writers. aura-os-server already dual-writes the typed fields
   on create/update (Phase 3), and keeps the legacy tag encoding for
   another release so reads from older aura-network instances continue
   to work.
4. Enable the `agent_stats` population job (nightly refresh + update).
5. After ≥ 7 days of steady dual-write with no rollback, flip aura-os-
   server to stop writing `listing_status:*` / `expertise:*` tag forms.
   Drop the legacy values from the tag index in a follow-up cleanup.
   This last step is out of scope for this PR.

## Rollback

The columns are additive and defaulted, so rollback before any writers
deploy is a clean `ALTER TABLE ... DROP COLUMN`. After writers deploy,
keep the columns but stop reading them; the old tag convention still
carries the same semantics. Data loss risk is zero because the writers
continue to emit the tag form alongside the typed form.

## Out of scope

- Full-text search on `role` / `system_prompt` — tracked separately.
- Per-user pricing / availability — a future phase.
- A real-time `agent_stats` path (current design is up to 1 h stale for
  hireable agents, up to 24 h for the long tail).

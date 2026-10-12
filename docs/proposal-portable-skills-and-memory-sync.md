# PR Proposal: Portable Agent Skills + Cloud-Synced Memory

**Status:** Draft / RFC
**Scope:** cross-repo — `aura-network`, `aura-storage`, `aura-harness`, `aura-swarm`, `aura-os`
**Authors:** _tbd_

---

## 1. Summary

Today an agent's **memory** and **skills** are trapped on whatever machine authored them:

- **Memory** lives only in the harness's local RocksDB (`aura-context-memory`, column families `memory_facts` / `memory_events` / `memory_procedures` / `memory_event_index`), keyed by `AgentId` alone. There is no cloud copy and no cross-device sync.
- **Skills** live only on the local filesystem (the 5-tier `SkillLoader`: workspace → agent-personal → personal → extra → bundled) plus per-agent install records in the RocksDB `agent_skills` CF. Skill **names** travel over the wire (`RuntimeRequest.agent_identity.skills: Vec<String>`); the **bodies are resolved locally**. Cloud/swarm agents therefore only ever see skill *names as prompt text* — they cannot execute them.

This proposal makes both **portable and available on every device and in the cloud**, while preserving the harness's existing offline-first behavior, by:

1. Placing **memory** in `aura-network` (structured, agent-identity, read-heavy registry data) with the harness RocksDB as a local write-through cache.
2. Modeling **skills as immutable, content-addressed bundles** whose bytes live in a content store, whose identity/ownership lives in `aura-network`, and whose file/execution references live in `aura-storage`.
3. Pinning each agent's skill set into a portable **`agent_skill_manifest`** owned by the agent identity, so the agent keeps its skills when **hired by another user**, gated by an explicit **entitlement** layer.
4. Adding a **provisioner** that materializes bundles by digest into the local skills directory the existing loader already reads — on every device and at swarm microVM boot.

---

## 2. Motivation / Problem Statement

- **Skills are stuck locally.** A skill authored or installed on device A is invisible to device B and to cloud swarm agents. This is the `project_swarm_skill_support_status` gap: swarm gets names-as-prompt-text only; full execution is unbuilt.
- **Memory is single-device.** An agent's accumulated knowledge cannot follow the user across machines or into the cloud.
- **Agents are not self-contained.** Agents exist in the social layer (`aura-network.agents`) and are meant to be discoverable and **hireable** by other users/orgs. But an agent's value is largely its attached skills and memories — and those currently do not travel with it.
- **Hiring transports skill *names*, never skill *content*.** The marketplace + hire flow already exists (`agents.listing_status` → `createAgentInstance` → `project_agents`), but the instance snapshot's `skills: Vec<String>` is **names only** — there is no body, no `source_url`, no digest, no link to the actual skill files. The bytes stay on the authoring machine's `~/.aura/skills/` + harness `agent_skills` record and never reach the hirer. **A hired agent therefore cannot execute its own skills.** The hiring socket exists; the content-linkage plug is what this proposal adds.
- **No content/blob store exists.** Verified: neither `aura-storage` nor `aura-network` stores file bytes. `aura-storage.artifacts` (`asset_url`) and `process_artifacts` (`file_path`, `size_bytes`, `metadata`) are **reference rows only** — *"metadata is stored here; file content remains on the local machine."* The only content layer today is the Skill Shop's `source_url` → GitHub.

---

## 3. Goals / Non-Goals

**Goals**

- Skills and memory available on all of a user's devices and in cloud swarm runs.
- Offline-first preserved: once cached locally, an agent runs with no network.
- An agent's skills are **portable on hire** — they follow the agent identity, not the user.
- Deterministic, conflict-free skill distribution (immutable, content-addressed).
- Entitlement-correct distribution for paid/marketplace skills (fail-closed).

**Non-Goals (this PR)**

- Real-time collaborative skill editing.
- A general-purpose file sync engine for arbitrary user files.
- Memory sharing *between distinct agents* (memory stays agent-scoped).
- Replacing the local 5-tier `SkillLoader` (we populate the dirs it already reads).

---

## 4. Architecture Overview

Four planes, each mapped to a home that already fits its nature:

| Plane | Responsibility | Home |
| --- | --- | --- |
| **Identity / ownership / entitlement** | which skills exist, who authored them, each **user's skill library**, who may use them, each **agent's pinned skill set**, agent memory | **aura-network** (Postgres registry; users + agents/profiles already live here; swarm connects here) |
| **File references / execution bindings** | digest → content location, per-running-instance skill bindings + approved paths/commands, skill-usage lineage | **aura-storage** (the file-reference + execution layer; swarm connects here too) |
| **Content bytes** | the actual immutable skill bundle bytes, addressed by digest | **content store** behind a `ContentStore` trait — S3/MinIO (Phase 1); `the-grid` a future backend for private bundles (§13) |
| **Local cache / runtime** | materialized skill dirs, memory hot cache, offline operation | **aura-harness** local fs + RocksDB (already the offline-first store) |

**Join key across planes:** the bundle **digest** (`sha256:…`). Network knows the digest is owned/entitled; storage knows where the digest's bytes live; the content store serves the bytes; the harness caches them by digest.

---

## 5. Memory → aura-network

Memory is bounded, structured, agent-identity state, **read-heavy on the hot path** (retrieval injects into the prompt every turn; writes are batched post-turn and capped at 100 facts / 500 events / 50 procedures per agent). That matches the registry layer that already owns the agent record, and colocating memory with the agent solves the ownership/scoping mapping for free.

### 5.1 Schema (aura-network)

```sql
-- Add owner/tenant scoping the harness lacks today (AgentId-only).
CREATE TABLE agent_memory_facts (
    fact_id        UUID PRIMARY KEY,
    agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    owner_user_id  UUID,            -- resolved via agent ownership; NULL for org-owned
    owner_org_id   UUID,
    key            TEXT NOT NULL,
    value          JSONB NOT NULL,
    confidence     REAL NOT NULL,
    source         TEXT NOT NULL,   -- extracted | user_provided | consolidated
    importance     REAL NOT NULL,
    access_count   INTEGER NOT NULL DEFAULT 0,
    last_accessed  TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, key)
);

CREATE TABLE agent_memory_events (
    event_id    UUID PRIMARY KEY,
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,
    summary     TEXT NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}',
    importance  REAL NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TIMESTAMPTZ NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE agent_memory_procedures (
    procedure_id    UUID PRIMARY KEY,
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    trigger         TEXT NOT NULL,
    steps           JSONB NOT NULL,        -- Vec<String>
    context_constraints JSONB NOT NULL DEFAULT '{}',
    success_rate    REAL NOT NULL,
    execution_count INTEGER NOT NULL DEFAULT 0,
    skill_name      TEXT,                  -- existing optional linkage
    skill_relevance REAL,
    last_used       TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS on `owner_user_id` / `owner_org_id`. The fields are a 1:1 port of `aura-context-memory::types::{Fact, AgentEvent, Procedure}`, so the harness sync layer maps directly.

### 5.2 Sync model

- **Local source of truth stays the harness RocksDB** (hot path = zero network).
- Writes are **upserts keyed on `fact_id` / `event_id` / `procedure_id` with `updated_at`**; conflict resolution is **last-write-wins per record** (memory rows are independent; no cross-row invariants except consolidation, which produces new rows). Push **async, post-turn** (reuse the existing `MemoryTurnObserver` boundary) — never block a model call.
- Pull on session start / device onboarding; reconcile by `updated_at`.

---

## 6. Skills → content-addressed bundles

### 6.1 Bundle format

A **skill bundle** is the entire skill directory packaged deterministically:

```
<skill-name>/
  SKILL.md            # frontmatter + body (1 MB cap on SKILL.md itself)
  manifest.json       # generated; see below
  scripts/…           # optional executable scripts (run at activation)
  references/…        # optional reference docs loaded on demand (progressive disclosure)
  assets/…            # optional static assets — templates, images, data files
  <any other files>   # anything else the skill ships; resolved via ${SKILL_DIR}
```

The bundle is the **entire skill directory tree**, not just `SKILL.md`. The harness already loads skills from a `dir_path` and exposes `${SKILL_DIR}` for in-skill path references, so `scripts/`, `references/`, and `assets/` must travel together and materialize intact for those paths to resolve.

- **Packaging:** a **canonical tar** of the whole tree — entries sorted by path, normalized mode/uid/gid, zeroed mtime — so the same content always produces the same bytes. The `digest` covers **every file** (SKILL.md + scripts + references + assets), so changing any asset changes the digest.
- **Digest:** `sha256` over the canonical tar → the bundle's immutable ID, written `sha256:<hex>`. Identity = content. Editing anything = a new digest.
- **`manifest.json`** (also denormalized into the registry so it's queryable without unpacking):

```json
{
  "name": "deep-research",
  "version": "1.4.0",
  "digest": "sha256:…",
  "size_bytes": 48213,
  "entry": "SKILL.md",
  "files": [
    "scripts/fetch.mjs",
    "references/api-spec.md",
    "assets/report-template.html"
  ],
  "frontmatter": { "...": "verbatim SKILL.md frontmatter" },
  "requires": { "bins": ["node"], "env": [], "anyBins": [] },
  "permissions": { "paths": ["./research"], "commands": ["node *"], "tools": [] },
  "publisher": { "user_id": "…", "signature": "…" },
  "security_rating": "caution"
}
```

- **Integrity:** any fetcher MUST verify `sha256(bytes) == digest` before unpacking (defends the content store + transport).
- **Trust (marketplace):** optional publisher signature over the digest, surfaced as the existing `security_rating`.

### 6.2 Agent skill package

An **agent skill package** is the set of `(skill_id, version, digest)` an agent ships with. Hashing that set yields an optional **`package_digest`** — a single portable identifier for "this agent's skills," convenient for pinning and cache validation.

---

## 7. Skills schema

### 7.0 Skill provenance: marketplace vs user-defined (and two more)

The **Aura-maintained marketplace** and a **user's own skills** are different things and must stay distinguishable in the data — something the current system loses (today both a Skill Shop install and a hand-authored skill collapse into an identical local `~/.aura/skills/<name>/SKILL.md`, with provenance discarded). The registry models this as one `skills.origin` enum with four classes:

| `origin` | What it is | Owner | Default visibility | Today |
| --- | --- | --- | --- | --- |
| **`bundled`** | ships inside the harness/app binary | Aura (platform) | public | `SkillSource::Bundled` tier |
| **`curated`** | the **Aura-maintained marketplace** — skills Aura blesses and lists | Aura (platform), `curated_by` set | public | `skill-shop-catalog.json` (static JSON → OpenClaw GitHub `source_url`) |
| **`user`** | **user-defined** skills an individual authors | `owner_user_id` | private (publishable) | `CreateSkillModal` → `POST api/skills` → `~/.aura/skills/` |
| **`community`** | _future_ — skills other users publish to a shared marketplace | `owner_user_id`/`owner_org_id` | unlisted/public | does not exist |

Key consequences:

- **The Aura marketplace (`curated`) and user libraries are independent.** A `curated` skill is Aura-owned and public; a `user` skill is private to its author. Both can land in a user's `user_skills` library (§7.1) — curated via *acquire/install*, user-authored via *create* — but they never share ownership.
- **Curated content stays upstream-hosted (DECIDED).** Aura does **not** ingest or host `curated` skill bytes — they remain at the third-party GitHub raw URL, as today. Content-addressing still applies: when a curated skill version is registered, Aura computes a `digest` over the fetched content and **pins it as a snapshot hash**. `skill_versions.content_url` holds the external URL; the provisioner fetches from GitHub and verifies `sha256(bytes) == digest`. This keeps versioning, integrity, and the local offline cache **without Aura hosting the bytes** — and is strictly safer than today, which downloads whatever is at the URL with no verification. Drift (upstream edits the file) shows up as a digest mismatch → surfaced, and re-curation mints a new `skill_versions` row. Trade-off: availability of curated skills depends on GitHub being reachable at first fetch (mitigated only by the local content-addressed cache once pulled; an optional lazy pass-through CDN cache could reduce this without making Aura the authoritative host).

  > **Footnote — multi-file curated skills.** GitHub-passthrough cleanly handles *single-file* curated skills (a lone `SKILL.md` at one raw URL — which is all the current `skill-shop-catalog.json` ships). But a curated skill that bundles `references/`/`assets/`/`scripts/` (§6.1) **cannot** be fetched from one raw-file URL: `content_url` would have to point at a **git tree** (clone / sparse-checkout the skill subdirectory) and the digest is computed over the whole tree, not one file. So curated skills are constrained to whatever shape upstream provides — single-file works today via the existing `reqwest` GET; multi-file requires adding a tree-fetch path to the provisioner. Aura-owned `user`/`community`/`owned_snapshot` bundles don't hit this, since they're tarred into the content store whole. Until the tree-fetch path exists, multi-file curated skills should be rejected at registration with a clear error rather than silently importing only `SKILL.md`.
- **One registry, not three code paths.** Marketplace, bundled, and user-defined are rows differentiated by `origin`/`owner`/`visibility`, served by the same provisioner — instead of today's separate static-JSON-download path vs local-create path.

### 7.1 aura-network — identity, ownership, entitlement, the portable manifest

```sql
-- Catalog of publishable skills (user packages + marketplace).
CREATE TABLE skills (
    id             UUID PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE,            -- lowercase-hyphen name
    origin         TEXT NOT NULL,                   -- bundled | curated | user | community
    owner_user_id  UUID,                            -- author; NULL for bundled/curated (Aura-owned)
    owner_org_id   UUID,
    curated_by     UUID,                            -- Aura/platform actor for origin='curated'
    visibility     TEXT NOT NULL,                   -- private | unlisted | public
    license_kind   TEXT NOT NULL,                   -- bundled | free | paid | agent_embeddable
    latest_version TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- origin distinguishes the FOUR provenance classes (see §7.0). The current
-- Skill Shop = origin 'curated'; CreateSkillModal authoring = origin 'user'.

-- Immutable published versions. digest is the cross-plane join key.
CREATE TABLE skill_versions (
    id              UUID PRIMARY KEY,
    skill_id        UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version         TEXT NOT NULL,                  -- semver
    digest          TEXT NOT NULL UNIQUE,           -- sha256:… of the bundle
    size_bytes      BIGINT NOT NULL,
    manifest        JSONB NOT NULL,                 -- denormalized manifest.json
    security_rating TEXT NOT NULL DEFAULT 'safe',
    signature       TEXT,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (skill_id, version)
);

-- USER LIBRARY: the user → skill-bundle list. What a user OWNS and may
-- attach to their agents. Distinct from authorship (skills.owner_user_id):
-- a library includes both authored skills AND acquired/marketplace skills.
-- The creator gets a row here automatically for their own skill.
CREATE TABLE user_skills (
    id               UUID PRIMARY KEY,
    user_id          UUID NOT NULL,                  -- library owner
    skill_id         UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    skill_version_id UUID NOT NULL REFERENCES skill_versions(id),
    digest           TEXT NOT NULL,                  -- → content store
    acquired_via     TEXT NOT NULL,                  -- authored | purchased | installed | shared
    pinned_version   BOOLEAN NOT NULL DEFAULT false, -- false = follow latest, true = hold this version
    added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, skill_id)
);

-- AGENT PACKAGE: the agent → skill-bundle list, pinned to the AGENT
-- identity (not the user) so it travels on hire. Rows are sourced FROM a
-- user's library at attach time, then frozen by digest.
CREATE TABLE agent_skill_manifest (
    id               UUID PRIMARY KEY,
    agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id         UUID NOT NULL REFERENCES skills(id),
    skill_version_id UUID NOT NULL REFERENCES skill_versions(id),
    digest           TEXT NOT NULL,                 -- pinned; immutable for this agent
    attach_scope     TEXT NOT NULL,                 -- owned_snapshot | catalog_ref
    license_ref      UUID,                          -- → skill_entitlements when paid
    added_by_user_id UUID NOT NULL,
    added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, skill_id)
);

-- Who may FETCH which content (gates paid/marketplace bytes).
CREATE TABLE skill_entitlements (
    id               UUID PRIMARY KEY,
    subject_user_id  UUID,
    subject_org_id   UUID,
    skill_version_id UUID NOT NULL REFERENCES skill_versions(id),
    digest           TEXT NOT NULL,
    grant_source     TEXT NOT NULL,                 -- bundled | purchase | agent_attached | author
    expires_at       TIMESTAMPTZ,
    granted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NO new hires table. The hiring relationship ALREADY EXISTS:
--   • aura-network `agents.listing_status` ('closed'|'hireable') + expertise/
--     jobs/revenue_usd/reputation (migration 0037) gate marketplace discovery.
--   • "Hiring" = createAgentInstance → a `project_agents` row in aura-storage
--     (agent_id → template, created_by = hirer, project_id, source). THAT row
--     is the hire receipt. Entitlement is checked inside the existing
--     create_agent_instance flow (§8.2); no parallel table is warranted.
```

### 7.2 aura-storage — file references + per-run execution bindings

```sql
-- Where a digest's bytes live (mirrors the process_artifacts pattern:
-- reference only, bytes in the content store). Optional if network's
-- skill_versions.digest already carries the location.
CREATE TABLE skill_artifacts (
    id            UUID PRIMARY KEY,
    digest        TEXT NOT NULL UNIQUE,             -- sha256:… (snapshot hash; verified on fetch)
    content_url   TEXT NOT NULL,                    -- object-store key (user/community/owned)
                                                    -- OR external GitHub raw URL (curated, not Aura-hosted)
    size_bytes    BIGINT NOT NULL,
    artifact_type TEXT NOT NULL DEFAULT 'code',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per running agent-instance runtime grants (execution config).
-- This UPGRADES today's split snapshot rather than inventing a wholly new
-- store: currently skill state for an instance is scattered across
-- aura-storage `project_agents.skills` (NAMES only, snapshotted at hire) and
-- the harness RocksDB `agent_skills` CF (approved_paths/commands). This table
-- consolidates them into one digest-pinned per-instance binding.
-- `agent_instance_id` IS the existing `project_agents` instance id.
-- (Alternative: extend `project_agents` in place instead of a sidecar table —
--  see §8.2; chosen shape is a sidecar to avoid widening the hot instance row.)
CREATE TABLE agent_instance_skill_bindings (
    id                 UUID PRIMARY KEY,
    agent_instance_id  UUID NOT NULL,                 -- = project_agents.id
    project_id         UUID,
    skill_slug         TEXT NOT NULL,
    digest             TEXT NOT NULL,
    enabled            BOOLEAN NOT NULL DEFAULT true,
    approved_paths     JSONB NOT NULL DEFAULT '[]',
    approved_commands  JSONB NOT NULL DEFAULT '[]',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_instance_id, skill_slug)
);
```

### 7.3 Content store layout (object-store option)

```
skills/sha256/<aa>/<bb>/<full-digest>.tar      # immutable bundle, content-addressed
```

Access-controlled by the **provisioning grant** (§8.3); the store itself stays dumb (digest in, bytes out).

### 7.4 Harness local cache layout

```
~/.aura/skill-cache/sha256/<digest>/            # unpacked once, immutable, shared
~/.aura/agents/<agent_id>/skills/<name>/  →  symlink to the cache dir
```

`~/.aura/agents/<agent_id>/skills/` is already `SkillSource::AgentPersonal` in the 5-tier loader, so **no loader change is needed** — the provisioner just populates it. (Swarm uses `/state/<user_id>/<agent_id>/skills/<name>/`.)

---

## 8. Agent portability & hiring (the explicitly-required piece)

### 8.0 Two ownership lists, one content store

Ownership is modeled as **two parallel lists in aura-network**, both pointing at the same content-addressed bytes via `skill_versions.digest` → content store:

- **`user_skills`** — the user's library: skills they authored **or** acquired, available to attach to *their* agents.
- **`agent_skill_manifest`** — the agent's package: the specific skills attached to a given agent, pinned by digest, owned by the agent identity.

This separates two distinct rights:

| Right | Granted by | Meaning |
| --- | --- | --- |
| **Reuse / attach** | `user_skills` (library membership) | I can add this skill to my agents, edit (if authored), re-publish |
| **Run-within-agent** | `agent_skill_manifest` (+ entitlement) | This skill executes when this agent runs — and travels when the agent is hired |

A **hired** user gets *run-within-agent* rights (the agent's manifest materializes for them) **without** the skill entering their own library — so hiring an agent does not silently hand its skills to the hirer for reuse elsewhere.

Lifecycle: **create** → lands in `skills`/`skill_versions` + the author's `user_skills` → **add from library to agent** → `agent_skill_manifest` row (snapshot by digest) → **hire** → agent's manifest provisions for the hirer under entitlement.

### 8.1 Snapshot-on-attach

When a user attaches a skill **from their library** to an agent (authored **or** marketplace-acquired):

1. Resolve the skill to a concrete **version + digest** (publishing it first if it's a never-published personal skill: tar → hash → push bytes → insert `skills` + `skill_versions`).
2. Insert an `agent_skill_manifest` row pinning that `digest` to the agent, with `attach_scope`:
   - **`owned_snapshot`** — author's personal skill; the bytes are now an immutable agent-owned bundle. The agent keeps this version forever regardless of later author edits or the author's local fs.
   - **`catalog_ref`** — a published marketplace skill; the agent references the catalog version and carries a `license_ref`.
3. Grant a baseline entitlement (`grant_source = author | agent_attached`).

Because the pin is a **digest**, "the agent owns these skills" is portable by construction: any runner materializes exactly those bytes.

### 8.2 Hiring flow (rides the EXISTING marketplace + instance path)

Hiring is **already implemented** — this design hooks into it rather than adding a table. When **user B hires agent X** (owned by user/org A): B browses `listing_status='hireable'` agents (`GET /api/marketplace/agents`) and the `HireProjectPickerModal` calls `createAgentInstance(project_id, X.agent_id)`, which inserts a `project_agents` row (the hire record: `agent_id`→X, `created_by`=B, `project_id`, `source`).

The skills layer slots into that existing flow:

1. **The `project_agents` instance IS the hire grant** — no `agent_hires` row. `created_by` identifies the hirer; `agent_id` identifies the hired template.
2. The provisioner reads **X's `agent_skill_manifest`** (pinned to the template identity, §7.1) — the skill set is X's, not B's, so it comes along automatically. The existing `project_agents.skills` *names* snapshot is superseded by the digest-pinned `agent_instance_skill_bindings` written here.
3. **`create_agent_instance` gains an entitlement check** before persisting the instance. For each pinned skill, entitlement is resolved by class (fail-closed — skip + warn if unentitled):
   - **bundled / free / `owned_snapshot` author-attached** → materialize freely (the author embedded it in the agent; running the agent is licensed use).
   - **`agent_embeddable` paid license** → license travels with the agent; B inherits run-rights via the hire. No re-purchase.
   - **`paid` catalog_ref without an embeddable license** → B must hold or acquire a `skill_entitlements` grant; otherwise that one skill is skipped and the agent runs degraded (logged, surfaced in UI).

This cleanly separates **agent ownership** (the manifest) from **content-use rights** (entitlements), which is what makes "hired agent keeps its skills" correct rather than a licensing loophole.

### 8.3 Provisioning grant

`aura-network` is the entitlement authority. The provisioner requests a grant for `(agent_id, subject)`; network returns a **short-TTL signed token** = the **allowlist of digests** the subject may fetch. The provisioner presents it to the content store. This gates paid content without making the object store entitlement-aware.

---

## 9. Provisioner flow

One component, three call sites: **local session start**, **device onboarding**, **swarm microVM boot**.

### 9.1 Read / materialize (the common path)

```
provision(agent_id, instance_id?, subject, target_root):           # instance_id absent on bare device-onboarding
  manifest   = network.get_agent_skill_manifest(agent_id)          # pinned (skill, version, digest)
  grant      = network.request_provisioning_grant(agent_id, subject) # signed digest allowlist
  for entry in manifest:
      if entry.digest not in grant.allow:                          # entitlement: fail-closed
          warn("skill {entry.slug} not entitled for {subject}; skipping"); continue
      cache = ~/.aura/skill-cache/sha256/<entry.digest>            # (or VM /state cache)
      if not exists(cache):                                        # immutable → trust if present
          loc   = storage.resolve(entry.digest)  # or network.skill_versions.content_url
          bytes = content_store.fetch(loc, grant)
          assert sha256(bytes) == entry.digest                     # integrity
          unpack(bytes -> cache)
      link(cache -> target_root/skills/<entry.slug>)               # populate AgentPersonal tier
      if instance_id:                                              # bindings are per project_agents instance
          upsert_binding(instance_id, entry.slug, entry.digest,    # → agent_instance_skill_bindings (storage)
                         entry.manifest.permissions.paths,         #   approved paths/commands come from the
                         entry.manifest.permissions.commands)      #   skill manifest + any attach-time approval
  # existing 5-tier SkillLoader now discovers them; offline thereafter.
```

- **Local device:** `target_root = ~/.aura/agents/<agent_id>`. After first pull, fully offline.
- **Swarm microVM:** `target_root = /state/<user_id>/<agent_id>`, run at VM boot → cloud agents now **execute** skills, not just see names.

### 9.2 Write / publish (authoring + attach)

```
publish_personal_skill(dir, user):     # first time a local skill leaves the machine
  bundle = canonical_tar(dir); digest = sha256(bundle)
  content_store.put(digest, bundle)     # idempotent (content-addressed)
  v = network.upsert_skill_version(slug, version, digest, manifest, signature?)
  network.upsert_user_skill(user, v, acquired_via="authored")   # → author's library

acquire_marketplace_skill(user, slug, version):                 # buy/install into library
  v = network.resolve_skill_version(slug, version)
  network.grant_entitlement(user, v, source="purchase")
  network.upsert_user_skill(user, v, acquired_via="purchased")  # → library, no bytes copied

attach_to_agent(agent_id, slug, version, user):
  assert network.in_user_library(user, slug)   # can only attach from YOUR library
  resolve digest
  network.insert_agent_skill_manifest(agent_id, slug, version, digest, attach_scope, license_ref)
```

Offline authoring: the bundle is computed and cached locally with its digest immediately; the `content_store.put` + manifest insert are **queued and flushed on reconnect**. The agent can use the skill locally before it's pushed; it becomes portable once synced.

---

## 10. Wire-protocol changes

Today `RuntimeRequest.agent_identity.skills: Vec<String>` (names only) and `SessionReady.skills: Vec<SkillInfo{name, description}>`.

- Extend the request to carry the **resolved pin set** — `Vec<{ slug, version, digest }>` — **or** keep names on the wire and have the receiving harness resolve `name → (version, digest)` against the network registry. Either way the provisioner must know **digests**, not just names.
- Thread the **provisioning grant** (or a token to request one) so swarm VMs can fetch entitled content.
- `SessionReady` may additionally report which skills materialized vs were skipped (entitlement/degraded), for UI.

---

## 11. Offline behavior

| Action | Offline? |
| --- | --- |
| Run an agent whose skills are already cached by digest | ✅ yes |
| First-time materialize of a new/changed digest | ❌ needs network (content + grant) |
| Author / edit a skill locally | ✅ yes (push queued for reconnect) |
| Memory read (hot path) | ✅ yes (RocksDB local) |
| Memory cross-device sync | ❌ needs network (async, off hot path) |

The harness stays the local-first source of truth; the cloud is the canonical/cross-device tier.

---

## 12. Rollout phases

1. **Content store + bundle format** — stand up the chosen byte backend; implement canonical-tar + digest + integrity verify. (Gating decision: object store vs git.)
2. **Network schema** — `skills`, `skill_versions`, `user_skills` (user library), `agent_skill_manifest` (agent package), `skill_entitlements`, plus `agent_memory_*`. **No hires table** — the marketplace (`agents.listing_status`, migration `0037`) and the `project_agents` instance/hire record already exist and are reused as-is.
3. **Storage schema** — `skill_artifacts`; `agent_instance_skill_bindings` consolidating today's split `project_agents.skills` (names) + harness `agent_skills` (approved paths) into one digest-pinned binding keyed by the existing `project_agents.id`.
4. **Provisioner (local)** — read/materialize + publish/attach against the local harness; populate the existing AgentPersonal tier. Skills become cross-device.
5. **Memory sync** — RocksDB ↔ network upsert with LWW; reuse the post-turn observer.
6. **Swarm provisioning** — run the provisioner at microVM boot; closes the names-only gap (`project_swarm_skill_support_status`).
7. **Entitlement gate on the EXISTING hire flow** — *not new hiring UI.* Insert the per-skill entitlement check into the existing `create_agent_instance` path so a hired agent's pinned skills resolve + materialize (the linkage absent today); add degraded-run surfacing and paid-skill grant prompts. The marketplace browse + `HireProjectPickerModal` + `createAgentInstance` are untouched.

---

## 13. Open decisions

- **Content backend (RESOLVED): S3/MinIO behind a `ContentStore` trait now; `the-grid` as a future pluggable backend.** Phase 1 stands up a strongly-consistent object store (S3/MinIO). The foundation everything else depends on must give **read-after-write + durability** — an object store provides that trivially. All access goes through a narrow `ContentStore` trait (`put(digest, bytes)` / `fetch(digest, grant) -> bytes`, §9) so the byte backend is swappable. The git option (reuse `source_url` history) is **dropped**: heavy fetch primitive, awkward for binary supporting files, and unnecessary once content is content-addressed. Scope unchanged: this backend hosts only Aura-owned/user content — **`curated` skills are NOT hosted here** (they stay at upstream GitHub raw URLs, digest-pinned and verified on fetch; see §7.0).

  > **`../cypher-asi/the-grid` evaluated — deferred, not Phase 1.** the-grid (decentralized, ZK-proof + post-quantum, client-side-encrypted content-addressed storage; crates `grid-core`/`grid-storage`/`grid-sdk`; libp2p + JSON-RPC; **v0.2.0 alpha**) is architecturally the right *primitive* — content-addressed, immutable, replicated — but is not the Phase-1 backend for four reasons: (1) **addressing mismatch** — it keys on `(ProgramId, SectorId, index)` with `Cid = sha256(`*ciphertext*`)`, not our `sha256(`*plaintext canonical tar*`)` digest, so it needs an adapter layer; (2) **mandatory client-side encryption fights shared content** — ZODEs store only opaque ciphertext, so public/marketplace/hired bundles (fetched by many parties) would require broad decryption-key distribution, breaking the "dumb store, digest in / bytes out" model; (3) **alpha maturity** on the layer that gates the whole rollout, and it would be the first aura consumer; (4) **gossip replication is eventually-consistent**, but provisioning needs read-after-write (publish a bundle → a swarm VM fetches it at boot).
  >
  > **Tiered roadmap behind the trait:** `curated` → upstream GitHub (§7.0); public marketplace / `community` → S3/MinIO; **private `user` / `owned_snapshot` bundles → `the-grid` once it reaches ~1.0**, where its client-side encryption + ZK verification flip from liability to asset (Aura's servers never see plaintext for a user's proprietary skill). The `ContentStore` trait is what makes this swap a backend choice rather than a rewrite.
- **Paid-license semantics on hire** — is `agent_embeddable` a distinct purchasable license tier, or does any attach implicitly grant embeddable run-rights? Affects marketplace economics.
- **`package_digest`** — adopt a single agent-package hash for one-shot pinning/validation, or resolve per-skill only?
- **Memory ownership on hire** — does a hired agent's memory travel too, fork per hirer, or stay with the owner? (Default proposed: memory stays owner-scoped; hiring grants run-rights, not memory transfer.)

---

## 14. Affected repos / crates

- **aura-network** — new tables + REST for skills/versions, `user_skills`, `agent_skill_manifest`, `skill_entitlements`, memory; provisioning-grant issuer; entitlement authority. **No hires table** — reuses existing `agents.listing_status` marketplace.
- **aura-storage** — `skill_artifacts`, `agent_instance_skill_bindings` (consolidates the `project_agents.skills` snapshot + harness approved-paths); digest→location resolution.
- **content store** — new service/bucket or git backend.
- **aura-harness** — provisioner; extend `aura-context-skills` to materialize-by-digest into the AgentPersonal tier (loader unchanged); memory sync layer in `aura-context-memory`; carry digests/grant on `RuntimeRequest`.
- **aura-swarm** — invoke the provisioner at microVM boot into `/state/<user_id>/<agent_id>/skills/`.
- **aura-os** — add the **entitlement check inside the existing `create_agent_instance`** flow; degraded-run surfacing; point the Skill Shop install path at publish→manifest instead of raw GitHub `source_url`. **Reuses** the existing marketplace + `HireProjectPickerModal`.

---

## 15. Reuse of existing infrastructure

This is **not greenfield.** The harness already has a skill registry, a per-agent install store with a `source_url` pointer, and a download-by-URL distribution path. Most of the proposal is *promoting* these from local-only to cloud-canonical + content-addressed. The codebase's own docs (`docs/agents-and-skills.html`) already floated the seed idea: *"when `inject_agent_skills` hits an unresolved name, fetch from the install record's `source_url`."* The provisioner is the productionized version of exactly that.

### 15.1 Reuse as-is — the local materialized-view layer (do not touch)

- **`SkillLoader`** (5-tier discovery), **`SkillRegistry`** (in-memory name→`Skill`, precedence dedup, `reload`), **`parser`**, **`activation`** ($ARG substitution), **`prompt`** injection. The provisioner only *populates the directories these already read*, which is why the loader needs no change.
- **`SkillRegistry::add_plugin_roots`** (`registry.rs:146`) — an existing Phase-8 extension hook that registers an arbitrary root dir as `SkillSource::Extra`. The provisioner can point this at the content-addressed cache instead of (or in addition to) symlinking into the AgentPersonal tier. **An extension seam already exists.**

### 15.2 Upgrade — extend existing structures

| Existing | Becomes | Delta |
| --- | --- | --- |
| **`SkillInstallation`** (`install.rs`): `agent_id, skill_name, source_url, version, approved_paths, approved_commands, installed_at` | **`agent_skill_manifest`** row | Add `digest` (pin) + promote from RocksDB-local to the network table. It **already carries version + source pointer + approved permissions** — the durable manifest is this record made portable. |
| **`SkillInstallStore`** (RocksDB `agent_skills` CF, `SkillInstallStoreApi`) | **local write-through cache** of the network manifest | Keep the trait; the store stops being source-of-truth and gains a sync path. |
| **`install_from_shop`** (downloads one `SKILL.md` from `source_url`) | **provisioner fetch step** | Generalize "GET raw URL by name" → "GET bundle by digest, verify `sha256`, unpack." `install_from_shop` is effectively the **v0 single-file provisioner**. |
| **`skill-shop-catalog.json`** (static checked-in catalog → third-party `openclaw/openclaw` GitHub raw URLs; `install_from_shop` downloads a **single `SKILL.md`** and copies it into `~/.aura/skills/`) | **`skills` + `skill_versions`** network tables with `origin='curated'` | Promote the static JSON to a live registry; entry shape already maps onto `skills` + `skill_versions.manifest`. Upgrades: static→live catalog, unversioned→`digest`-pinned + verified on fetch. **Bytes stay at upstream GitHub (decided §7.0)** — the `source_url` becomes `skill_versions.content_url`; Aura registers the snapshot digest but does not host the content. |
| **Harness skill HTTP gateway** (list/get/create/activate, install/uninstall agent skills) | same endpoints, **backed by network registry + content store** | API surface stays; backend swaps local-only for cloud-canonical. |
| **`aura-protocol` `SkillInstallation`** wire mirror | add `digest` | Threads the pin to the harness/swarm (see §10). |
| **Marketplace** (`agents.listing_status` 'hireable', `expertise`/`jobs`/`revenue_usd`/`reputation`, `GET /api/marketplace/agents`, migration `0037`) | **unchanged** — the existing hireable-agent discovery | Skills-portability rides it as-is; **no `agent_hires` table** (§8.2). |
| **`createAgentInstance` / `project_agents`** (the hire flow: inserts a project instance with `agent_id`→template, `created_by`=hirer, a `skills` names snapshot) | **the hire record + entitlement hook** | The instance row IS the hire receipt; add an entitlement check in `create_agent_instance`; upgrade its `skills` snapshot → `agent_instance_skill_bindings` (digest-pinned). |

### 15.3 Net-new — no existing analog

- **`user_skills`** (the user's skill library). Today skills are either filesystem-personal or per-*agent* install records; there is **no user-identity dimension** and no notion of a library that includes acquired marketplace skills.
- **Content-addressed content store (S3/MinIO behind a `ContentStore` trait — §13) + bundle/digest format + integrity verify.** Today distribution is a single `SKILL.md` fetched from a raw URL — no multi-file bundle, no hash, no scripts/supporting-file packaging, no immutability.
- **Skill entitlement** (`skill_entitlements`, provisioning grant). *Note: agent **hiring** is NOT new — it reuses the existing marketplace + `project_agents` instance model (§8.2); only the per-skill entitlement gate is added, inside the existing `create_agent_instance` flow.*
- **Memory cloud sync** (`agent_memory_*` + RocksDB write-through).
- **Swarm microVM provisioning** at VM boot.

### 15.4 Summary

The *shape* is already right — registry + per-agent record-with-pointer + fetch-by-URL. The work is three moves on top of it: **(1)** add a user-library dimension and content-addressing (digest), **(2)** move the source of truth from local RocksDB/static JSON to the network registry + a real content store, and **(3)** add the entitlement/hire and swarm-provisioning planes that have no analog today. The local loader/registry/activation stack survives intact as the runtime view.

# Plan: Aura ? Orbit Integration

Orbit is always an **external, standalone service**. Aura uses a client and a single env variable (`ORBIT_BASE_URL`) to connect; the Orbit API is not run from this repo.

This document is the implementation plan for attaching Aura projects to Orbit repos, using Orbit for Git (clone/push/pull) and for ?who can add people? (repo owner + owner-role collaborators). Orbit is the source of truth for repo membership and roles; Aura does not duplicate that logic.

---

## Implementation phases (overview)

Implement in order; each phase is shippable on its own.

| Phase | Goal | Depends on | Deliverable |
|-------|------|------------|-------------|
| **Phase 1** | Project ? Orbit link | ? | Store and edit `git_repo_url` / `git_branch` on projects; project settings ?Git / Orbit? section; **New Project:** default proposed new Orbit repo (editable), placeholder for ?search existing repos.? No Orbit API or token yet. |
| **Phase 2** | Orbit auth + New Project Orbit | ? | Orbit token (encrypted); settings API + UI; **create repo** and **list/search repos** Orbit client + API; New Project can create new Orbit repo or search/select existing repos user is a member of; use token for Git. |
| **Phase 3** | Collaborators (read) | Phase 1, 2 | Orbit client `list_collaborators`; `GET /api/projects/:id/orbit-collaborators`; optional "Collaborators" UI. |
| **Phase 4** | Session init / runtime | Phase 1, 2 | Send `workspace.git_repo_url` and `workspace.git_branch` in session_init; pass token to runtime for clone/push. |
| **Phase 5** | Aura ? Orbit org sync | Phase 2, 3 | Org Orbit link + user orbit_username; sync members to Orbit repo on invite accept / remove / role update; UI. |

**Dependency graph:** Phase 1 and 2 can be done in parallel; Phase 3 and 4 depend on 1+2; Phase 5 depends on 2 (and reuses Orbit client from 3).

---

## Phase 1: Project ? Orbit link (data + UI)

**Goal:** Projects can store and display a Git/Orbit repo URL and branch. Users can attach or detach an Orbit repo from a project. **New Project screen:** propose a default new Orbit repo (to be created), editable; allow searching and selecting existing repos the user is a member of. No Orbit API calls or token in this phase (UI structure and fields only; ?create repo? and ?search existing? require Phase 2).

**Checklist:**

- [ ] **Core:** Add `git_repo_url`, `git_branch`, and optionally `orbit_base_url`, `orbit_owner`, `orbit_repo` to `Project` in `crates/infra/core/src/entities.rs` with `#[serde(default)]`.
- [ ] **Domain:** Add same optional fields to `CreateProjectInput` and `UpdateProjectInput` in `crates/domain/projects/src/lib.rs`; pass through in `create_project` and `update_project`.
- [ ] **Network types (optional):** If aura-network will persist these, add to `NetworkProject`, `CreateProjectRequest`, `UpdateProjectRequest` in `crates/infra/network/src/types.rs`.
- [ ] **Server:** Add optional git/orbit fields to `CreateProjectRequest` and `UpdateProjectRequest` in `apps/server/src/dto.rs`; in `apps/server/src/handlers/projects.rs`, map in create/update and in `project_from_network`.
- [ ] **Frontend:** Add optional git/orbit fields to `Project` in `interface/src/types/entities.ts` and to `CreateProjectRequest` / `UpdateProjectRequest` in `interface/src/api/client.ts`.
- [ ] **UI ? project settings:** Add "Git / Orbit" section: inputs for Git remote URL and branch; save via `updateProject`.
- [ ] **UI ? New Project:** Add "Orbit repo" section with: (1) **Default proposed new repo** ? e.g. `{orbit_owner}/{slug(project_name)}` or a configurable default; user can edit owner and repo name; this repo will be created on Orbit when the project is created (Phase 2). (2) **Use existing repo** ? control to search existing repos the user is a member of and select one (Phase 2: requires Orbit token + list/search repos API). When token is not yet set, show ?Connect Orbit in settings to create a new repo or choose an existing one.? Store chosen `git_repo_url` / `git_branch` (and optional orbit_owner / orbit_repo) on create.
- [ ] **Tests:** Project CRUD with new fields; existing project tests still pass with fields omitted.

**Done when:** User can open a project, set an Orbit repo URL and branch, save, and see them on reload; New Project screen shows the Orbit repo section with default new-repo proposal (editable) and placeholder for ?search existing? (wired in Phase 2).

---

## Phase 2: Orbit auth (token + Git) + New Project Orbit actions

**Goal:** User can store an Orbit token (PAT or login token) securely. The app uses it for Orbit REST calls and for Git (clone/push/pull) when a project has `git_repo_url`. **New Project:** when creating a project, optionally create the proposed new repo on Orbit and set the project?s link, or search/select an existing repo the user is a member of.

**Checklist:**

- [ ] **Settings:** Add Orbit token storage (encrypted, like API key): e.g. key `orbit_token`; "has / set / get decrypted" only where needed.
- [ ] **Server:** Endpoints e.g. `GET /api/settings/orbit-token` (metadata only) and `PUT /api/settings/orbit-token` with body `{ "token": "..." }`; store encrypted.
- [ ] **Frontend:** Settings UI to add/remove Orbit token (and optional "Connect to Orbit" if login flow exists). When attaching a project to an Orbit repo or on New Project, prompt for token if not set.
- [ ] **Orbit client ? create repo:** Implement `create_repo(base_url, owner, repo, token)` (or equivalent Orbit API to create a new repo). Used when user chooses ?create new repo? on New Project.
- [ ] **Orbit client ? list/search repos:** Implement `list_repos_by_user(base_url, token)` and/or search repos the user is a member of (per Orbit API). Expose e.g. `GET /api/orbit/repos?q=...` that returns repos the current user can use (using their Orbit token).
- [ ] **New Project ? create repo on Orbit:** When user submits New Project with ?create new repo? and has Orbit token, call Orbit create_repo (owner/repo from the proposed default or edited values), then set project?s `git_repo_url` / `git_branch` from the created repo. If create fails, surface error and do not create the Aura project (or create without link per product choice).
- [ ] **New Project ? search existing repos:** Wire the ?Use existing repo? control to the list/search Orbit API; user can search and select a repo, then project is created with that `git_repo_url` / `git_branch`.
- [ ] **Git usage:** When a project has `git_repo_url`, use the user's Orbit token for clone/push/pull (credential helper or URL injection); do not log the token.
- [ ] **Tests:** Settings round-trip; no raw token in responses; test create_repo and list_repos (or mock).

**Done when:** User can set an Orbit token in settings; on New Project they can create a new Orbit repo (proposed by default, editable) or search and select an existing repo they?re a member of, and the project is linked accordingly; Git operations use the token.

---

## Phase 3: Collaborators (read-only)

**Goal:** For a project linked to an Orbit repo, show who the collaborators are and who can add people (repo owner + owner-role). Orbit is the source of truth.

**Checklist:**

- [ ] **Orbit client:** Add HTTP client that takes Orbit base URL + Bearer token; implement `list_collaborators(base_url, owner, repo, token)` calling `GET /repos/{owner}/{repo}/collaborators`. Optionally `GET /api` for discovery.
- [ ] **API:** Add `GET /api/projects/:project_id/orbit-collaborators`: load project; if no Orbit link return 400 or empty; use project's Orbit link + current user's Orbit token to call Orbit; return list with roles; document "can add people" = owner role + repo owner.
- [ ] **UI (optional):** "Collaborators" or "Repo settings" section on project (when link present) that calls the endpoint and shows who can add people.
- [ ] **Tests:** Integration test for orbit-collaborators endpoint (or mock Orbit).

**Done when:** User can open a linked project and see Orbit collaborators and who can add people.

---

## Phase 4: Session init and runtime (workspace from Orbit)

**Goal:** When starting a session for a project with an Orbit link, send `workspace.git_repo_url` and `workspace.git_branch` in session_init and provide the runtime with the Orbit token so it can clone (and push).

**Checklist:**

- [ ] **Locate or add:** Code path that builds and sends session_init (or equivalent) to the runtime (e.g. WebSocket connect or REST workspace init). If missing, document contract and add stub.
- [ ] **Payload:** When project has `git_repo_url` / `git_branch`, set `workspace.git_repo_url` and `workspace.git_branch` in that payload.
- [ ] **Token:** Define and implement how the token is passed to the runtime (env, credential helper, or secure inject); document for runtime implementers.
- [ ] **Tests:** Unit or integration test that payload includes workspace fields when project is linked.

**Done when:** Cloud or empty-workspace sessions receive repo URL and branch and can authenticate to Orbit to clone/push.

---

## Phase 5: Aura ? Orbit org sync

**Goal:** When an Aura org is linked to an Orbit repo, keep org membership in sync: add/remove/update Orbit repo collaborators when users join/leave/change role in the Aura org.

**Checklist:**

- [ ] **Orbit client:** Add `add_collaborator(base_url, owner, repo, username, role, token)` and `remove_collaborator(...)` (and optionally `update_collaborator`).
- [ ] **Org?Orbit link:** Store per org (e.g. `org_orbit_repo:{org_id}`) with `{ orbit_base_url, orbit_owner, orbit_repo }`; API `GET/PUT /api/orgs/:org_id/orbit-repo` (org owner/admin only).
- [ ] **Orbit username per user:** Store per user (e.g. `user:{user_id}:orbit_username`); API `GET/PUT /api/users/me/orbit-username` (or under settings).
- [ ] **Sync on accept_invite:** After adding member, if org has Orbit link and user has orbit_username, call Orbit `add_collaborator` with role from invite; use current user's token; do not fail invite on Orbit errors.
- [ ] **Sync on remove_member:** If org has Orbit link and member has orbit_username, call Orbit `remove_collaborator`.
- [ ] **Sync on update_member_role:** If org has Orbit link and member has orbit_username, call Orbit `add_collaborator` with mapped role.
- [ ] **UI ? org:** Org settings section to set/clear linked Orbit repo (base URL, owner, repo).
- [ ] **UI ? user:** Profile/settings field for Orbit username.
- [ ] **Tests:** Sync logic and API for org link and orbit_username; do not block org ops on Orbit failure.

**Done when:** Adding/removing/changing a member in an Aura org updates the linked Orbit repo's collaborators when the org has an Orbit link and users have orbit_username set.

---

## Detailed spec (reference)

The sections below are the full specification for each area; phases above reference them.

---

## 1. Attach an Aura project to an Orbit repo

### 1.1 Data model (project ? Orbit link)

**Orbit:** No change. Repos and Git are already supported.

**Aura ? add per-project Orbit/Git fields:**

| Layer | File(s) | Change |
|-------|---------|--------|
| Core entity | `crates/infra/core/src/entities.rs` | Add to `Project`: `git_repo_url: Option<String>`, `git_branch: Option<String>`. Optionally: `orbit_base_url: Option<String>`, `orbit_owner: Option<String>`, `orbit_repo: Option<String>` (for REST calls to Orbit without parsing URL). Use `#[serde(default)]` for backward compatibility with existing stored projects. |
| Domain | `crates/domain/projects/src/lib.rs` | Add same optional fields to `CreateProjectInput` and `UpdateProjectInput`. In `create_project` / `update_project`, pass them through to `Project` and persist. |
| Store | `crates/infra/store/` | No schema change. `put_project`/`get_project` serialize/deserialize `Project` via serde; new fields are stored once added to `Project`. |
| Network types | `crates/infra/network/src/types.rs` | Add to `NetworkProject`: `git_repo_url`, `git_branch`, and optionally `orbit_base_url`, `orbit_owner`, `orbit_repo`. Add to `CreateProjectRequest` and `UpdateProjectRequest` (all optional). Only needed if the aura-network backend will persist these; otherwise keep network types as-is and only sync from local. |
| Server DTOs | `apps/server/src/dto.rs` | Add to `CreateProjectRequest`: `git_repo_url`, `git_branch` (optional). Add to `UpdateProjectRequest`: same (optional). |
| Server handlers | `apps/server/src/handlers/projects.rs` | In `create_project`: map new fields from `req` to local `Project` and, when calling network, to `aura_network::CreateProjectRequest` if network supports them. In `update_project`: map from `UpdateProjectRequest` to `UpdateProjectInput` and to `UpdateProjectRequest`. In `project_from_network`: when building `Project` from `NetworkProject`, preserve/copy git/orbit fields from `net` or `local` as appropriate. |
| Frontend types | `interface/src/types/entities.ts` | Add to `Project`: `git_repo_url?: string`, `git_branch?: string`, and optionally `orbit_base_url?`, `orbit_owner?`, `orbit_repo?`. |
| Frontend API | `interface/src/api/client.ts` | Add optional `git_repo_url`, `git_branch` (and optional orbit fields) to `CreateProjectRequest` and `UpdateProjectRequest`. |

**Backend/network:** If projects live on aura-network, add the same fields to the network API (request/response) and persist there; the desktop (and future clients) set and read the link via create/update/get project. If aura-network does not yet store these, the link can live only in the local Aura store (desktop) and still be used for session_init and Git operations from the client.

### 1.2 UI: "Attach to Orbit repo"

- **Project settings / detail:** Add a section "Git / Orbit" with:
  - **Git remote URL** (e.g. `https://orbit.example.com/owner/repo.git`). Optional text input; can be parsed to derive `orbit_base_url`, `orbit_owner`, `orbit_repo` on save, or the user pastes the URL and the app stores it as `git_repo_url`.
  - **Branch** (e.g. `main`). Optional; default `main` when cloning.
- **New Project:** Default proposed new Orbit repo (editable) that will be created when the project is created; option to search and select existing repos the user is a member of. See **?1.2.1** for details.
- **Discovery:** Use Orbit `GET /api` for `base_url` and `git_url_prefix`; list/search repos per Orbit API for "search existing" on New Project.

### 1.2.1 New Project screen ? default new repo and search existing

On the **New Project** screen, include an Orbit repo section with:

1. **Default proposed new repo** ? A new Orbit repo is proposed by default (e.g. `{orbit_owner}/{slug(project_name)}`). The user can **change** the owner and repo name. When they create the project, this repo is **created** on Orbit (Phase 2: Orbit create-repo API) and the project is linked to it (`git_repo_url`, `git_branch`).

2. **Use existing repo** ? The user can instead **search existing repos** they are a member of (Phase 2: Orbit list/search repos API). They search, select a repo, and the project is created linked to that repo (no new repo created).

3. **Flow** ? Either "Create new repo" (default, editable) or "Use existing repo" (search and select). On submit: if new repo, call Orbit create-repo then set the project's `git_repo_url` / `git_branch`; if existing, set from selection. If the user has not connected Orbit (no token), show "Connect Orbit in settings to create or choose a repo" and optionally allow creating the project without an Orbit link.

---

## 2. Orbit auth in Aura (token for Git and REST)

**Orbit:** Auth is already Bearer token (PAT or login token) for REST and Git HTTP.

**Aura:**

- **Storage:** Store an Orbit token per user (or per device if single-user desktop). Options:
  - Reuse the existing settings pattern: add a setting key, e.g. `orbit_token`, and store it encrypted (same approach as API key) if the token is sensitive. Alternatively, a dedicated ?Orbit? section in settings with encrypted storage.
  - Backend: if the server holds settings, add GET/PUT for `orbit_token` (or `settings/orbit-token`) and use the same encryption as API key; do not return the raw token to the client if not needed for direct Git from the client.
- **Usage:**
  - **Git (clone/push/pull):** When a project has `git_repo_url`, use the user?s Orbit token for authenticated Git. Options:
    - **Desktop/local:** Configure Git credential helper or inject token into the clone URL (e.g. `https://oauth2:<token>@orbit.example.com/owner/repo.git`) when running `git clone` / `git push` / `git pull` from the app or from a runtime that the app drives. Ensure the token is not logged.
    - **Cloud runtime:** Pass token to the runtime via a secure channel (e.g. env var or secure credential mechanism) so the runtime can clone (and push) to Orbit; see ?4.
  - **REST (e.g. collaborators):** When calling Orbit?s API (e.g. `GET /repos/{owner}/{repo}/collaborators`), send `Authorization: Bearer <orbit_token>`.
- **Acquiring the token:** Either:
  - User pastes a PAT from Orbit (settings ? ?Orbit? ? ?Personal access token?), or
  - ?Connect to Orbit? / ?Orbit login? flow that returns a token (if Orbit supports OAuth or login API); then store that token as above.

**Concrete tasks:**

- **Settings service / store:** Add support for an Orbit token (key `orbit_token` or similar). Prefer encrypted-at-rest like API key; expose ?has orbit token? / ?set orbit token? / ?get decrypted orbit token? only where needed (Git, Orbit REST client).
- **Server:** If the server performs Git or Orbit API calls on behalf of the user, add an endpoint or reuse settings: e.g. `GET /api/settings/orbit-token` (metadata only, e.g. ?configured: true?) and `PUT /api/settings/orbit-token` with body `{ "token": "..." }` that stores encrypted. Server uses the decrypted token only in backend code (Git, Orbit client).
- **Frontend:** Settings UI to add/remove Orbit token (and optionally ?Connect to Orbit? if there is a login flow). When attaching a project to an Orbit repo, prompt for Orbit token if not set.

---

## 3. Who is authorized to add people to the repo

**Orbit:** Already encodes this: only repo owner and collaborators with `owner` role can add/remove collaborators (`PUT`/`DELETE` on collaborators). `GET /repos/{owner}/{repo}/collaborators` returns the list with roles.

**Aura:**

- **Source of truth:** Orbit. Do not duplicate permission logic in Aura; ?can add people? = repo owner + users with `owner` role from Orbit.
- **Backend:** Add an optional ?Orbit client? or reuse HTTP client that:
  - Takes Orbit base URL and Bearer token.
  - Calls `GET /repos/{owner}/{repo}/collaborators` (and optionally `GET /api` for discovery). Use `orbit_base_url` + `orbit_owner` + `orbit_repo` from the project, or parse from `git_repo_url`.
- **API:** Expose a route, e.g. `GET /api/projects/:project_id/orbit-collaborators`, that:
  - Loads the project; if no `git_repo_url` or Orbit link, return 400 or empty.
  - Resolves Orbit base URL and owner/repo from the project.
  - Uses the current user?s Orbit token (from settings) to call Orbit?s `GET /repos/{owner}/{repo}/collaborators`.
  - Returns the list; optionally mark which ones have `owner` role (and thus ?can add people?).
- **Frontend:** Optionally add a ?Repo settings? or ?Collaborators? view for a project that has an Orbit link: show collaborators and roles, and indicate ?Can add people? for owner-role users (and the repo owner). This can be a simple list from `GET /api/projects/:project_id/orbit-collaborators` or a dedicated Orbit-backed UI.

**Concrete tasks:**

- Add an Orbit REST client (or extend existing HTTP client) with method `list_collaborators(orbit_base_url, owner, repo, bearer_token)`.
- Add `GET /api/projects/:project_id/orbit-collaborators` that uses project?s Orbit link + user?s Orbit token and returns collaborators with roles.
- (Optional) UI: ?Collaborators? tab or section on project settings that calls this endpoint and displays ?can add people? for owner-role users.

---

## 4. Session init and cloud runtime (workspace from Orbit)

**Orbit:** Clone URL + Bearer token is enough for the runtime to clone (and later push).

**Aura:**

- **Local mode:** Keep using the local agent instance workspace. Optionally set the Git remote to `git_repo_url` so push/pull go to Orbit (using the user's Orbit token when running Git from the app).
- **Cloud mode (or any mode where the workspace is empty):** When starting a session for a project that has an Orbit link:
  - Send in `session_init` (or equivalent) something like:
    - `workspace.git_repo_url` = project?s `git_repo_url`
    - `workspace.git_branch` = project?s `git_branch` (e.g. `main`)
  - Provide the runtime a way to authenticate to Orbit (e.g. inject token via env like `GIT_CREDENTIAL` or a secure credential helper) so it can clone and, after work, push to Orbit.
- **Where to implement:** Wherever the app builds the payload for the runtime (e.g. desktop?s session start, or a future cloud gateway): if `project.git_repo_url` is set, include `workspace.git_repo_url` and `workspace.git_branch` in that payload, and include the Orbit token via the chosen secure mechanism. The runtime contract is already described in `docs/aura-runtime-requirements.md` (R9/R10).

**Concrete tasks:**

- Locate or add the code path that sends `session_init` (or equivalent) to the runtime (e.g. WebSocket connect, or REST workspace init). If it does not exist yet, document the contract and add a stub that will later set `workspace.git_repo_url` and `workspace.git_branch` from the project when present.
- When building that payload for a project with `git_repo_url`/`git_branch`, set `workspace.git_repo_url` and `workspace.git_branch`.
- Define how the token is passed to the runtime (env, credential helper, or secure inject) and implement that on the Aura side (and document for runtime implementers).

---

## 5. Sync Orbit orgs and Aura orgs

Sync Aura org membership with Orbit repo collaborators so that when users join or leave an Aura org (or their role changes), they are added/updated/removed as collaborators on the Orbit repo linked to that org.

### 5.1 Design

- **Link:** One ?default? Orbit repo per Aura org. When an org has this link set, all Aura org members are kept in sync as collaborators on that Orbit repo.
- **Direction:** Aura ? Orbit (one-way sync). When we add/remove/update a member in an Aura org, we call Orbit?s API to add/remove/update that user as a collaborator on the org?s linked Orbit repo. Reverse sync (Orbit ? Aura) can be added later (e.g. webhooks or periodic diff).
- **User mapping:** Orbit identifies collaborators by **username**. Aura has `user_id` (UUID) and `display_name`. We need a stable **Orbit username** per Aura user. Options:
  - **Preferred:** Store `orbit_username` on the user (e.g. in aura-network user profile, or in Aura settings as `user:{user_id}:orbit_username`). When syncing, look up orbit_username for each org member; if missing, skip that user and optionally log or surface ?Link Orbit account? in UI.
  - **Alternative:** Convention-based (e.g. normalize `display_name` or email prefix to a slug). Only reliable if Orbit usernames match that convention.
- **Role mapping:** Aura has `OrgRole`: Owner, Admin, Member. Orbit has roles: reader, writer, owner. Map:
  - Aura **Owner** or **Admin** ? Orbit **owner** (so they can add/remove people on the repo).
  - Aura **Member** ? Orbit **writer** (or **reader** if you prefer read-only members).
- **Token:** The user performing the sync (e.g. org owner adding a member, or the user accepting an invite) must have an Orbit token with permission to manage collaborators on the linked repo. Use the **current user?s** Orbit token (?2); no need for a separate ?org bot? token unless you want to sync in the background without a user action.

### 5.2 Data model

- **Org?Orbit link:** Store per Aura org the linked Orbit repo so we know where to sync members.
  - **Option A (Aura store):** In Aura?s store, add a key per org, e.g. `org_orbit_repo:{org_id}` with value `{ "orbit_base_url": "...", "orbit_owner": "...", "orbit_repo": "..." }`. No change to aura-network.
  - **Option B (aura-network):** If aura-network supports it, add `orbit_base_url`, `orbit_owner`, `orbit_repo` (optional) to the org resource and API; Aura reads them when syncing.
- **Orbit username per user:** Store per user the Orbit username for sync.
  - **Option A (Aura store):** Setting `user:{user_id}:orbit_username` (or a small ?user_identities? table keyed by user_id). Set via profile/settings UI ?Link Orbit account? or ?Orbit username.?
  - **Option B (aura-network):** If user profile in aura-network has `orbit_username` (or `external_identities.orbit`), Aura uses it when calling Orbit.

### 5.3 When to sync

| Event | Aura side | Orbit side |
|-------|-----------|------------|
| User **accepts invite** to Aura org | `accept_invite` ? new org member | If org has Orbit link and user has orbit_username, call Orbit `PUT /repos/{owner}/{repo}/collaborators/{orbit_username}` with role from invite. |
| User **removed** from Aura org | `remove_member` | If org has Orbit link, call Orbit `DELETE /repos/{owner}/{repo}/collaborators/{orbit_username}`. |
| User **role updated** in Aura org | `update_member_role` | If org has Orbit link, call Orbit `PUT /repos/{owner}/{repo}/collaborators/{orbit_username}` with mapped role. |

- **Add member (direct):** If Aura/aura-network supports ?add member by user_id? (without invite), same as accept_invite: after add, sync to Orbit.
- **Bulk / backfill:** Optional: endpoint or job ?Sync org X to Orbit? that lists Aura org members and ensures each (with orbit_username) is present on the Orbit repo with the right role; removes Orbit collaborators that are no longer in the Aura org.

### 5.4 Implementation tasks

1. **Orbit client (extend):** Already need `list_collaborators`. Add:
   - `add_collaborator(base_url, owner, repo, username, role, token)` ? `PUT .../collaborators/{username}` with body `{ "role": "writer"|"owner"|"reader" }`.
   - `remove_collaborator(base_url, owner, repo, username, token)` ? `DELETE .../collaborators/{username}`.
   - `update_collaborator` = same as add (PUT with new role).
2. **Org?Orbit link storage:** Implement Option A (Aura store) unless aura-network is updated: e.g. `put_org_orbit_repo(org_id, &{ base_url, owner, repo })` and `get_org_orbit_repo(org_id)`. Use a dedicated CF or a settings-style key.
3. **Orbit username per user:** Implement Option A (Aura store): e.g. `put_orbit_username(user_id, username)`, `get_orbit_username(user_id)`. Expose in API: e.g. `GET/PUT /api/users/me/orbit-username` or under settings.
4. **Sync on accept_invite:** In `accept_invite` handler (or immediately after), load org?s Orbit link and the new member?s orbit_username; if both present, call Orbit `add_collaborator` with role from the accepted invite. Use current user?s Orbit token (the one who accepted). If token missing or Orbit returns 4xx, log and optionally return a warning; do not fail the invite accept.
5. **Sync on remove_member:** In `remove_member` handler, load org?s Orbit link and the removed user?s orbit_username; if both present, call Orbit `remove_collaborator`. Use current user?s Orbit token.
6. **Sync on update_member_role:** In `update_member_role` handler, load org?s Orbit link and the target user?s orbit_username; if both present, call Orbit `add_collaborator` (PUT) with mapped role. Use current user?s Orbit token.
7. **UI ? org settings:** In org settings (or team settings), add ?Orbit repo? section: set/clear the org?s linked Orbit repo (base URL, owner, repo). Only org owners/admins can set this. Show ?Sync: Aura org members are synced to this Orbit repo as collaborators.?
8. **UI ? user Orbit username:** In user profile or settings, add ?Orbit username? so sync can map Aura user ? Orbit collaborator. If missing, show ?Add Orbit username to be added to linked Orbit repos when you join a team.?

### 5.5 Edge cases

- **Orbit API errors:** If Orbit returns 403/404 (e.g. token without permission, or repo missing), log and optionally surface ?Could not sync to Orbit? to the user; do not block Aura org operations.
- **Missing orbit_username:** Skip syncing that user; optional UI hint ?Link Orbit account? for the member.
- **Orbit repo missing:** If the org?s Orbit link points to a repo that no longer exists, sync calls will fail; same as above, don?t block Aura.

### 5.6 Optional: reverse sync (Orbit ? Aura)

Later, if desired: when someone is added as collaborator on the Orbit repo (outside Aura), reflect that in Aura (e.g. add to Aura org). Requires either Orbit webhooks or periodic ?diff Orbit collaborators vs Aura members? and an Aura flow to add users (invite by email or link existing user by orbit_username). Out of scope for the first version.

---

## 6. Implementation checklist (summary)

Use the **per-phase checklists** in Phase 1?5 above. Quick index:

| Phase | Section |
|-------|---------|
| Phase 1 | [Phase 1: Project ? Orbit link](#phase-1-project--orbit-link-data--ui) |
| Phase 2 | [Phase 2: Orbit auth](#phase-2-orbit-auth-token--git) |
| Phase 3 | [Phase 3: Collaborators](#phase-3-collaborators-read-only) |
| Phase 4 | [Phase 4: Session init and runtime](#phase-4-session-init-and-runtime-workspace-from-orbit) |
| Phase 5 | [Phase 5: Aura ? Orbit org sync](#phase-5-aura--orbit-org-sync) |

- [ ] **Frontend types:** Add optional git/orbit fields to `Project`, `CreateProjectRequest`, `UpdateProjectRequest` in `interface/src/types/entities.ts` and `interface/src/api/client.ts`.
- [ ] **UI ? attach repo:** Add ?Git / Orbit? section in project settings (and optionally in New Project) to set `git_repo_url` and `git_branch`; optionally ?Browse Orbit repos? using Orbit API discovery.
- [ ] **Orbit token storage:** Add Orbit token setting (encrypted preferred); backend API to set/get (metadata or secure use only); interface settings UI to add/remove or ?Connect to Orbit.?
- [ ] **Git with Orbit token:** When project has `git_repo_url`, use Orbit token for clone/push/pull (credential helper or URL injection); ensure token not logged.
- [ ] **Orbit REST client:** Implement `list_collaborators(orbit_base_url, owner, repo, bearer_token)` and optionally `GET /api` for discovery.
- [ ] **Collaborators API:** Add `GET /api/projects/:project_id/orbit-collaborators`; return list with roles; document ?can add people? = owner role + repo owner.
- [ ] **UI ? collaborators (optional):** ?Collaborators? or ?Repo settings? view for project with Orbit link showing who can add people.
- [ ] **Session init / runtime:** Where session init is built, set `workspace.git_repo_url` and `workspace.git_branch` from project when present; add secure mechanism to pass Orbit token to runtime for clone/push.
- [ ] **Tests:** Unit tests for project CRUD with new fields; integration test for Orbit collaborators endpoint (or mock); update any existing project tests to include optional new fields.

**Orbit ? Aura org sync (?5):**

- [ ] **Orbit client ? collaborators write:** Add `add_collaborator` and `remove_collaborator` (and optionally `update_collaborator`) to the Orbit REST client.
- [ ] **Org?Orbit link storage:** Store per-org Orbit repo link (base_url, owner, repo) in Aura store; API to get/set (e.g. `GET/PUT /api/orgs/:org_id/orbit-repo`), restricted to org owner/admin.
- [ ] **Orbit username per user:** Store and expose orbit_username per user (e.g. `GET/PUT /api/users/me/orbit-username` or under settings).
- [ ] **Sync on accept_invite:** After accept_invite, if org has Orbit link and user has orbit_username, call Orbit add_collaborator with role from invite; use current user?s Orbit token; do not fail invite on Orbit errors.
- [ ] **Sync on remove_member:** In remove_member handler, if org has Orbit link and member has orbit_username, call Orbit remove_collaborator.
- [ ] **Sync on update_member_role:** In update_member_role handler, if org has Orbit link and member has orbit_username, call Orbit add_collaborator with mapped role.
- [ ] **UI ? org Orbit link:** Org settings section to set/clear the org?s linked Orbit repo (base URL, owner, repo).
- [ ] **UI ? user Orbit username:** User profile/settings field for Orbit username so they can be synced when joining orgs.

---

## 7. File reference (quick index)

| Area | Path |
|------|------|
| Project entity | `crates/infra/core/src/entities.rs` |
| Project domain | `crates/domain/projects/src/lib.rs` |
| Network types | `crates/infra/network/src/types.rs` |
| Network client | `crates/infra/network/src/client.rs` (for create/update project and future Orbit calls) |
| Store (projects) | `crates/infra/store/src/store_project.rs` |
| Server DTOs | `apps/server/src/dto.rs` |
| Project handlers | `apps/server/src/handlers/projects.rs` |
| Frontend Project type | `interface/src/types/entities.ts` |
| Frontend API | `interface/src/api/client.ts` |
| New project modal | `interface/src/components/NewProjectModal.tsx` |
| Project settings / detail | (to add or extend; e.g. project settings panel or ProjectLayout) |
| Settings (API key, etc.) | `crates/domain/settings/`, `apps/server/src/handlers/settings.rs` |
| Runtime contract | `docs/aura-runtime-requirements.md` (R9, R10) |
| **Org sync (?5)** | |
| Org handlers (invite, members, roles) | `apps/server/src/handlers/orgs.rs` |
| Org Orbit link storage | New: store module or settings-style keys for `org_orbit_repo:{org_id}` |
| User orbit_username storage | New: settings or store keys for `user:{user_id}:orbit_username` |

This plan leaves Orbit unchanged and adds the minimal Aura-side data, APIs, and UI to attach projects to Orbit repos, use Orbit for Git and for ?who can add people,? support session_init with workspace clone from Orbit, and **sync Aura org membership to Orbit repo collaborators** when an org is linked to an Orbit repo.

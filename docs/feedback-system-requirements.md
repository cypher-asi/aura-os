# Feedback System Requirements

This document defines the current requirements for the Feedback system in Aura OS.

If nearby implementation notes drift, follow this document for product scope, data boundaries, and expected behavior.

## Goal

Aura OS should provide a global Feedback app where users can:

- create feedback posts
- browse and sort feedback posts
- vote posts up or down
- discuss posts in comments
- track the status of each feedback item over time

The Feedback app should feel native to the existing Aura OS app shell and reuse current Feed/Profile patterns wherever practical.

## Product Scope

The Feedback system is a first-class app in the Aura interface.

It must:

- appear as its own app in the existing app registry and navigation
- use the same shell structure as other apps with a left panel, main panel, and right-side detail/comments panel
- behave as a global shared surface similar to Feed, not a project-scoped or org-scoped workspace

The first version is scoped to:

- feedback post creation
- feedback list browsing and sorting
- per-post voting
- per-post comments
- per-post status tracking

The first version does not require:

- threaded comments
- multi-select filters
- attachments
- custom moderation workflows
- role-specific admin dashboards

## User Experience Requirements

### App Structure

The Feedback app must follow the existing Aura app contract and layout conventions already used by apps like Feed and Profile.

The app must provide:

- a left menu with sort/filter options
- a main content area with the composer and feedback list
- a right-side panel for comments and item detail context

### Left Menu

The left menu must expose the following options:

- `Latest`
- `Most Popular`
- `Trending`
- `Most Voted`
- `Least Voted`

These options are mutually exclusive and control the ordering of the visible feedback list.

### Composer

At the top of the main panel, users must be able to create a new feedback post in a prominent composer similar in spirit to X/Twitter.

The composer must support:

- a required primary text body
- optional short title support if needed by the implementation
- category selection
- initial status selection
- submit action

The composer must allow the author to choose one category from:

- `Feature Request`
- `Bug`
- `UI/UX`
- `Feedback`
- `Question`

The composer must allow the author to set one status from:

- `Not Started`
- `In Review`
- `In Progress`
- `Done`
- `Deployed`

### Feedback List

The main list must be visually aligned with existing Feed/Profile list styling and should reuse shared Aura components where that produces a clean implementation.

Each visible feedback item must show, at minimum:

- author identity
- creation time
- title or lead text
- body summary or content preview
- category
- status
- vote totals or score
- comment count

Selecting a feedback item must open the comments/detail experience on the right side, consistent with current Feed behavior.

### Voting

Users must be able to upvote or downvote a feedback post.

Voting requirements:

- each user may have at most one active vote per post
- an upvote and downvote are mutually exclusive
- a user may change their vote from upvote to downvote or from downvote to upvote
- a user may remove their current vote
- vote state must be reflected in the UI for the current viewer

### Comments

Users must be able to:

- open comments for a selected feedback item
- read existing comments
- add a new comment

Comments should follow the same interaction model as current post comments in the repo.

## Data Requirements

### Canonical Feedback Content

Feedback posts and comments should use the existing aura-network social post model already present in Aura OS.

The canonical feedback post should be represented as a post with:

- `event_type = "feedback"`
- `post_type = "post"`
- standard post fields for identity, author, title, summary, and timestamps
- structured `metadata` for feedback-specific attributes

### Feedback Metadata

Feedback-specific data must be represented in structured metadata using these canonical values:

- `feedbackCategory`
  - `feature_request`
  - `bug`
  - `ui_ux`
  - `feedback`
  - `question`
- `feedbackStatus`
  - `not_started`
  - `in_review`
  - `in_progress`
  - `done`
  - `deployed`

### Vote Data

Vote state is required. Since the current upstream social API does not yet expose vote endpoints, vote support must be added to aura-network during development, using the local aura-network database as the canonical store.

For the first version:

- vote data lives in the local aura-network Postgres database, not in Aura OS local persistence
- the aura-network HTTP API exposes vote endpoints that Aura OS can call
- Aura OS acts as a thin proxy and aggregator on top of those endpoints
- production aura-network will be updated later; local dev moves first

Each feedback item returned to the UI must include:

- `upvotes`
- `downvotes`
- `voteScore`
- `viewerVote`

`viewerVote` must represent the current viewer state as one of:

- `up`
- `down`
- `none`

### Local Aura Network Database

During development, aura-network runs locally in Docker with Postgres reachable at:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aura_network
```

This database is the source of truth for feedback posts, comments, and votes while the Feedback system is being built.

Rules:

- local aura-network must be running to develop or test the Feedback system end-to-end
- schema changes must be made as new migrations under the aura-network repo
- Aura OS must not introduce a parallel feedback-specific local store; it uses aura-network instead
- contract changes must be kept backward-compatible until production aura-network adopts them

### Split Aura Network Routing

Aura OS server routes requests to aura-network per-app so Feedback development can target a local aura-network while the rest of the product keeps using the deployed backend:

- `AURA_NETWORK_URL` — production aura-network (`https://aura-network.onrender.com`). Used by every handler except the Feedback app.
- `AURA_NETWORK_FEEDBACK_URL` — optional override used only by `/api/feedback/*` handlers. Point this at the local aura-network during Feedback development.

When `AURA_NETWORK_FEEDBACK_URL` is unset, the Feedback app falls back to `AURA_NETWORK_URL`. Unset it once production aura-network ships the vote and feedback-filter endpoints.

## Integration Requirements

### Aura Network

The Feedback system must reuse existing aura-network post and comment flows for:

- creating feedback posts
- fetching feedback posts
- fetching a single feedback post
- listing comments
- creating comments

Feedback data returned from Aura OS must be filtered so that the Feedback app only surfaces posts that represent feedback items.

Aura-network must be extended to support feedback-specific behavior that does not exist today:

- vote data model
- vote endpoints
- one active vote per user per post
- vote aggregates available in post responses

These changes must land as new aura-network migrations and API surface in the local aura-network repo and be exercised against the local Postgres database before any production schema changes are considered.

### Aura OS Server

Aura OS must expose a Feedback-oriented server surface that adapts the existing post/comment model into a feedback-specific API contract.

The first version should provide endpoints for:

- listing feedback items
- creating feedback items
- reading a single feedback item
- updating feedback status
- listing comments for a feedback item
- adding a comment to a feedback item
- casting or changing a vote on a feedback item

The server is responsible for:

- filtering feedback posts from the broader social feed
- parsing and validating feedback metadata
- forwarding vote operations to aura-network
- passing through vote aggregates returned by aura-network

Enforcement of one-vote-per-user must happen in aura-network, since it owns the canonical vote data.

## Sorting Requirements

The system must support the following sorting semantics:

- `Latest`: newest feedback first
- `Most Popular`: highest combined engagement score using votes and comments
- `Trending`: recent feedback with stronger recent engagement should rank higher than stale feedback with similar totals
- `Most Voted`: highest vote score first
- `Least Voted`: lowest vote score first

The exact trending formula may evolve, but the behavior must prefer recency plus engagement rather than raw lifetime totals alone.

## State And Persistence Requirements

The Feedback system must use aura-network as the canonical persistence boundary for feedback posts, comments, and votes.

Requirements:

- feedback post and comment bodies are owned by aura-network
- vote data is owned by aura-network, backed by its local Postgres database in development
- Aura OS must not introduce a parallel local vote store
- the rule of one active vote per user per feedback item must be enforced in aura-network
- response shaping on Aura OS must keep the UI independent from upstream schema details

## Functional Requirements

### Creation

- A signed-in user can create a feedback item.
- A new feedback item appears in the Feedback list after successful creation.
- Newly created feedback items must be visible to other users through the shared server-backed path.

### Status

- Each feedback item has exactly one status.
- A feedback item can be updated from one status to another.
- Status values must stay within the canonical status enum.

### Visibility

- Feedback is global by default in the first version.
- All signed-in users should see the same shared feedback dataset, subject to the server’s existing auth boundaries.

### Validation

- Required composer fields must be validated before submission.
- Category and status values must be validated on the server.
- Vote input must be validated so unsupported vote values are rejected.

## Non-Functional Requirements

- The implementation must follow existing Rust, TypeScript, and React patterns already established in the repo.
- UI should reuse existing shared components before introducing new abstractions.
- New interfaces and stores should be strongly typed.
- Server behavior should be covered by focused tests.
- UI behavior should be covered by focused tests where nearby patterns already exist.
- Aura-network schema changes must ship with new migrations and be validated against the local aura-network Postgres database before Aura OS integration is considered complete.

## Non-Goals

The first version is not required to support:

- anonymous feedback
- file uploads or screenshots
- nested comment threads
- emoji reactions beyond upvote/downvote
- production aura-network schema rollout; production migration is a later step

## Acceptance Criteria

The Feedback system is acceptable when:

- users can open a dedicated `Feedback` app in the Aura shell
- users can create a feedback post with category and status
- users can browse feedback using all required sort modes
- users can open a feedback item and comment on it
- users can upvote or downvote a feedback item with one active vote per user
- feedback responses include the current viewer’s vote state and aggregate vote counts
- the implementation uses current Aura OS architectural patterns and passes focused verification for server and interface behavior
- aura-network schema changes exist as new migrations in the aura-network repo and are validated against the local `aura_network` Postgres database


# Spec 13 — Product Unification Audit

## Goal

Classify the current Aura surfaces against the unification plan so responsive work lands in shared product patterns instead of one-off mobile patches.

This audit is based on the repo state after the first shared responsive-controls pass for `Feed`, `Leaderboard`, and `Profile`.

## Decision Rules

- `keep`: the surface already follows the shared product model and only needs routine responsive hardening
- `refactor into shared`: the surface works, but its mobile or narrow-screen behavior still lives in app-specific wrappers that should become shared shell or shared control patterns
- `desktop-only by capability`: the entry point should stay visible when helpful, but the behavior must be consistently gated behind shared capability helpers

## Audit Matrix

| Surface | Area | Classification | Notes |
| --- | --- | --- | --- |
| Projects | Project/chat vs execution header | refactor into shared | The mobile project header, tab switcher, and secondary agent selector should move into the same shared responsive-control slot now used by feed/profile/leaderboard. |
| Projects | Left panel / project list access | keep | The shared mobile shell already exposes the left panel through navigation and keeps project creation reachable. |
| Projects | Linked folders / local path authoring | desktop-only by capability | Keep the same entry point, but gate linked-folder flows with shared linked-workspace availability helpers. |
| Projects | Terminal panel | desktop-only by capability | Execution monitoring stays shared, but embedded terminal controls remain desktop-owned. |
| Agents | Agent switcher/header | refactor into shared | The current mobile-only header and agent picker should become another shared responsive sub-navigation pattern. |
| Agents | Agent chat view | keep | The main content remains the same product surface across widths. |
| Feed | Filter scope controls | refactor into shared | Completed in this pass by moving the inline filter chips into the shared shell slot. |
| Feed | Feed content and detail selection | keep | Shared provider state already drives the list, selection, and comments. |
| Leaderboard | Filter scope controls | refactor into shared | Completed in this pass by moving scope filters into the shared shell slot. |
| Leaderboard | Ranking chart and profile details | keep | Main chart and sidekick stay shared; the mobile work is now layout-level. |
| Profile | Project scope selector | refactor into shared | Completed in this pass by moving project scope controls into the shared shell slot. |
| Profile | Activity timeline and profile editing | keep | Core behavior remains shared and provider-backed. |
| Settings / Org / Billing / Integrations | Modal and settings navigation | keep | These flows already map well across widths and mostly need responsive hardening, not route forks. |
| Settings / Org / Billing / Integrations | Native updater | desktop-only by capability | The settings entry point stays shared, but updater controls should only appear when native update capability is available. |
| Settings / Org / Billing / Integrations | Host retargeting | keep | This is capability-driven and should remain consistently exposed on web/mobile surfaces. |
| Preview / Sidekick / Details | Specs / tasks / logs / stats panels | keep | The shared shell already presents these through the same details pattern on desktop and mobile. |
| Preview / Sidekick / Details | File explorer / open in IDE / changed-file open actions | desktop-only by capability | Keep the same product entry points, but gate all file-system and IDE actions through shared capability helpers. |
| Preview / Sidekick / Details | Drawer-only discoverability gaps | refactor into shared | Important sub-controls should continue moving into visible responsive controls where desktop keeps them in a left lane. |

## Initial Rules To Preserve

- `isMobileLayout` changes layout only. It should not own business logic.
- Shared providers and hooks stay authoritative for state and filtering.
- Desktop-only behavior must be explained or hidden consistently through shared capability helpers.
- The mobile shell is a packaging/runtime adaptation of the same product model, not a parallel IA.

## Immediate Follow-Ons

1. Move `Projects` and `Agents` mobile headers into the shared responsive-control slot.
2. Continue collapsing remaining duplicated state around preview/detail selection and settings modals.
3. Harden breakpoints, safe-area spacing, sticky headers, and drawer sizing across the shared shell.

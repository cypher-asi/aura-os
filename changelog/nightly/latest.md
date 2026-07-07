# Cleaner empty chat state and safer session deletion

- Date: `2026-07-07`
- Channel: `nightly`
- Version: `0.1.0-nightly.744.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.744.1

Today's nightly tightens two rough edges: the empty chat panel no longer visually collides with the centered input, and the server now consistently hides and fails closed on deleted sessions across chat history, pinning, and pagination paths.

## 5:42 AM — Empty chat state no longer collides with the centered input

A pair of CSS fixes clean up the first-run chat panel so the greeting, caret, and lead-in text stop stacking on top of each other.

- Lifted the 'What do you want to create?' heading above the textarea's caret layer with an explicit stacking context, so the blinking cursor no longer bleeds through the title text. (`2ffc5a4`)
- Nudged the empty-state icon and 'Ready for the next build.' copy into the upper third of the panel so it reads as a lead-in to the centered input rather than overlapping it. (`2ffc5a4`)

## 10:20 AM — Deleted chat sessions are now filtered and fail closed server-side

The chat server was returning or acting on sessions that storage had already marked deleted, and some storage backends were rejecting deletes outright. This change routes every session read through a shared deleted-check and hardens the delete path itself.

- Introduced a shared storage_session_is_deleted helper and applied it across discovery, history loaders, pin resolution, and session listing so deleted sessions no longer leak into chat history, pinning, or agent discovery. (`9ed391f`)
- Session deletes now handle storage backends that return 405 Unsupported cleanly instead of surfacing a raw error, closing out the original 'delete session storage 405' failure mode. (`9ed391f`)
- Paginated session listings fail closed when a page contains deleted entries, backed by expanded session_delete and empty-filter integration tests to lock the behavior in. (`9ed391f`)

## Highlights

- Empty chat state stops overlapping the centered input
- Deleted sessions consistently filtered across chat, pin, and pagination paths
- Server fails closed on unsupported session deletes


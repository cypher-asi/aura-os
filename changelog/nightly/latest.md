# Public chat goes live with a new Simple shell

- Date: `2026-05-21`
- Channel: `nightly`
- Version: `0.1.0-nightly.548.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.548.1

Today's nightly opens Aura's chat surface to logged-out visitors and reshapes the authenticated experience around a new lightweight Simple shell. The day's work spans guest streaming with cost guardrails, inline image/video/3D rendering on the public surface, mobile-friendly layouts, and a round of fixes that tightened deep links, token recovery, and rate-limit safety.

## 3:10 PM — Public guest chat and the Simple shell land together

Aura's chat surface opens to unauthenticated visitors, and authenticated users get a streamlined Simple shell with a persisted toggle across web and desktop.

- Public chat now streams over SSE for guests: the initial service-key approach was replaced with a clean unauthenticated router path that assigns a public-guest identity with IP-based rate limiting, removing the need for any shared secret. (`637465c`, `b372769`)
- Introduced SimpleShell, a ChatGPT-style sidebar-plus-chat layout for authenticated users, with a persisted simple/advanced preference in localStorage and Welcome/Onboarding modals suppressed in simple mode. Desktop gets parity via a Simple toggle in the titlebar, and the hasDesktopBridge gates were removed so web and desktop share the same shell logic. (`35fe55f`, `240ff82`, `cea4e29`)
- Added a hard global daily ceiling (500 turns) on top of per-guest and per-IP limits, so public mode can't accidentally run up costs even under abuse. (`d49a8e3`)
- Logged-out chat now supports 3D generation from an attached source image — users can upload an image, optionally add a prompt, and send it through Tripo, with the input auto-filled so the send button stays enabled. A small CSS tweak also gives the chat scroller proper clearance above the input bar. (`a8c06dd`, `d91e854`)

## 3:10 PM — Desktop-grade image rendering for assistant messages

Assistant-generated images in public mode now render with the same polish as the desktop ImageBlock.

- MessageBubble gained a dedicated render path for assistant-side image contentBlocks: 520px max width, rounded border frame, and click-to-open in the gallery with download — while user attachment thumbnails stay at their existing 96px size. (`ac0524c`)

## 1:45 AM — Public mode gets streaming feedback, inline media, and mobile layouts

A focused morning pass made the logged-out experience feel production-ready, with inline video and 3D playback, streaming indicators, mobile responsiveness, and recovery from invalid tokens or rate limits.

- Video and 3D generations now render inline in public chat (video player and WebGLViewer) instead of degrading to markdown links. The Tripo glbUrl field is now recognized by both the backend alias normalizer and the frontend SSE extractor, fixing 3D results that previously never appeared. (`eb70771`)
- Public mode now mirrors the desktop streaming feel: the ChatStreamingIndicator (cooking shimmer, progress text, stuck-stream pill) is wired in, and stream errors render as inline 'stream interrupted' banners instead of failing silently. (`230565a`)
- Logged-out and Simple shells become mobile-friendly below 640px with a single-column layout and a slide-in sidebar drawer triggered from a hamburger in the titlebar. Media-only assistant messages no longer show an empty bubble, and the mode pill handles narrow widths more gracefully. (`30dc4c6`)
- Reverted the footer to external marketing links opening in the system browser after React Router navigation proved broken inside the desktop shell — restoring parity between web and desktop. (`3271830`)
- Public chat now self-heals from auth and rate-limit failures: an 'invalid guest token' response clears the cached token so the next send mints a fresh one, and limit_reached responses surface the KeepChattingModal instead of a generic error banner. (`36fbb53`)

## 7:57 AM — Global rate limiter stops leaking budget on rejected retries

Reordered the public rate-limiter checks so the global daily counter isn't drained by requests that were going to be rejected anyway.

- try_reserve now increments the global ceiling only after per-guest and per-IP checks pass, so a guest already at their cap can no longer silently consume global budget on every retry. (`8f90fcf`)

## 8:00 AM — Auth token check restored for non-public harness sessions

Tightened a regression in the harness preflight that had broadened too far when public mode was added.

- The harness now skips the auth token check only when aura_org_id is 'public', restoring the safety net for authenticated sessions and re-greening the validate_rejects_missing_auth_token test. (`09b0d76`)

## 8:08 AM — Simple shell deep links and toggle behavior fixed

An afternoon cleanup made the Simple/Advanced toggle predictable for deep links, bookmarks, and CI.

- SimpleShell no longer redirects every non-chat URL to /chat — it now auto-switches to advanced mode so project deep links, bookmarks, and e2e tests render the full DesktopShell as expected. Toggling back to Simple from a non-chat route correctly routes to /chat, and the workflow e2e test seeds advanced mode in localStorage before navigating. (`dc938bd`, `81fe5af`)
- Tightened the public chat hook by fixing stale-closure dependency arrays around file uploads, limit, and token invalidation, and dropping a dead requiresLogin/useAuth path so the new flows behave consistently. (`65feaf7`, `fd4c0b0`)

## Highlights

- Public guest chat with daily cost ceiling
- New SimpleShell with persisted Simple/Advanced toggle
- Inline image, video, and 3D rendering in public mode
- Mobile-responsive logged-out and Simple shells


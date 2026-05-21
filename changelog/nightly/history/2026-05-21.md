# Public chat goes live with a Simple shell and full media support

- Date: `2026-05-21`
- Channel: `nightly`
- Version: `0.1.0-nightly.549.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.549.1

Today's nightly turns the logged-out experience into a real product surface: guests can stream chats without an account, generate images, video, and 3D models inline, and a new ChatGPT-style Simple shell gives signed-in users a lighter layout across web and desktop. The rest of the day went into hardening the public mode — mobile layout, error states, rate-limit accounting, and a server-side auth safety net.

## 3:10 PM — Public guest chat and the Simple shell launch

The logged-out surface becomes a first-class product: guests can stream chats without credentials, a new SimpleShell offers a ChatGPT-style layout, and public mode picks up 3D image attachments plus a global cost cap.

- Guests can now stream public chats end-to-end over SSE: the interim login redirect is gone, and after a brief service-key approach the router was switched to an unauthenticated public-guest identity with IP-based rate limiting so no keys or env vars are needed. (`637465c`, `b372769`)
- New SimpleShell gives authenticated web users a sidebar-plus-chat layout, with a persisted simple/advanced preference in localStorage, an Advanced toggle in its titlebar and a matching Simple toggle in DesktopShell — and the hasDesktopBridge gates were removed so Desktop, web, and future mobile share the same shells. (`35fe55f`, `cea4e29`, `240ff82`)
- Public mode picks up 3D generation from a source image: a file picker on the logged-out shell uploads an image, auto-fills a default prompt so send enables, and routes the request to Tripo without changing the shared input bar. (`a8c06dd`)
- An atomic global daily ceiling (500 turns / 24h) now caps total public usage across all guests and IPs before per-guest or per-IP limits, protecting cost exposure for the open surface. (`d49a8e3`)
- Minor polish on the public chat scroller adds bottom padding so messages clear the input bar. (`d91e854`)

## 3:10 PM — Desktop-quality assistant images in chat

Assistant-generated images now render with the same framing as desktop ImageBlock, giving public mode a polished media surface.

- MessageBubble gained a dedicated assistant-image render path: generated images display at up to 520px with a rounded border frame and click-to-gallery with download, while 96px user attachment thumbnails are unchanged. (`ac0524c`)

## 1:45 AM — Public chat hardening: inline media, mobile layout, and error UX

Through the morning the logged-out shell got the missing pieces to feel real — inline video and 3D playback, streaming indicators, mobile layout, and proper handling of expired tokens and rate-limit responses.

- Video and 3D outputs now render inline in public mode using the same player and WebGLViewer as the rest of the app, after fixing a missing glbUrl field in both the backend payload normalizer and the frontend SSE extractor that had been hiding Tripo results. (`eb70771`)
- Logged-out users now see the same ChatStreamingIndicator (cooking shimmer, progress text, stuck-stream pill) as the rest of the app, and stream failures surface as inline "stream interrupted" banners instead of failing silently. (`230565a`)
- Logged-out and Simple shells become mobile-friendly below 640px: single-column layout, a slide-in sidebar drawer with hamburger and backdrop, scrollable mode pills, and suppression of empty assistant bubbles on media-only messages. (`30dc4c6`)
- Public chat now recovers from server-side auth and rate failures: invalid guest tokens are auto-invalidated so the next send mints a fresh one, and limit_reached responses open the KeepChattingModal instead of a generic error banner. (`36fbb53`)
- Marketing footer links were briefly switched to React Router and then reverted to external target=_blank URLs so they work in the Desktop shell as well as on the web. (`3271830`)

## 7:57 AM — Rate limiter no longer leaks global budget on rejected retries

A reordering fix in the public rate limiter stops blocked requests from quietly consuming the global daily ceiling.

- The public rate limiter now increments the global daily counter only after per-guest and per-IP checks pass, so a guest already at their cap can no longer drain the shared 500-turn budget on retry attempts. (`8f90fcf`)

## 8:00 AM — Auth token check restored for non-public sessions

A harness regression that weakened auth on authenticated sessions was closed.

- The aura-os harness once again validates the auth token for all sessions and only skips the check when aura_org_id is public, restoring the safety net for authenticated traffic and unblocking the validate_rejects_missing_auth_token test. (`09b0d76`)

## 8:08 AM — Simple mode deep links, dead code, and CI fixes

Late-day polish made the simple/advanced toggle behave correctly on deep links and got the e2e suites green again.

- SimpleShell no longer hijacks non-chat URLs: project deep links, bookmarks, and CI routes now auto-switch to advanced mode so DesktopShell renders, while toggling Simple from a non-chat URL cleanly redirects to /chat instead of bouncing back. (`dc938bd`, `81fe5af`)
- E2E workflow and core-feature smoke tests now seed advanced mode in localStorage before visiting project routes, matching the new SimpleShell routing behavior. (`81fe5af`, `ed90d5f`)
- Cleaned up the public chat hook by fixing stale closures (handleFileChange, dispatchChatTurn, dispatchMedia dep arrays) and removing the unused requiresLogin path and DisplayContentBlockUnion import. (`65feaf7`, `fd4c0b0`)

## Highlights

- Guest SSE chat with global daily cost ceiling
- New SimpleShell with simple/advanced toggle on web and Desktop
- Inline image, video, and 3D rendering in public chat
- Mobile-friendly logged-out and Simple shells


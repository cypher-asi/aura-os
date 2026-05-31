# Model picker overhaul, private bug reports, and a new public marketing shell

- Date: `2026-05-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.577.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.577.1

A heavy day across the chat experience and the public-facing surface. The model picker grew per-model reasoning effort, credit multipliers, provider grouping, and Gemini support; a new Session Cost view shows what each conversation actually costs; an end-to-end private Bug Reports flow shipped with consent gating and an admin viewer; and the marketing site moved to a centered top nav with a new /code page. Reliability work hardened guest auth, public chat, CI Node setup, and how the changelog stats are produced.

## 9:27 PM — Public chat polish and the first model-picker effort selector

Late-evening fixes tighten the public chat layout and marketing hero, repair stuck guest sessions, and introduce per-model reasoning effort with credit multipliers in the chat input bar.

- Public chat self-heals when a server-side guest secret rotation invalidates cached tokens: a 401 now triggers a silent re-mint and retry across desktop, mobile, and the dispatch-media boundary instead of leaving visitors permanently stuck. (`72f8ed3`)
- Project Tasks tab checkmarks now update in real time during dev runs by subscribing the always-mounted project layout to task_updated edges, so completed tasks no longer wait for a manual refresh. (`567338e`)
- Introduced a credit-multiplier badge per chat model and a hover flyout for picking a reasoning effort (Low through Max), persisted per model and forwarded as reasoning_effort on the chat stream. (`b135e7a`)
- Marketing got a tangible upgrade: three looping mobile chat mockups now animate inside the /product agent section, and the product hero video fades cleanly into the page instead of being clipped mid-fade. (`4f9d48d`, `05a3554`)

## 10:32 PM — Session Cost, private Bug Reports, and a centered public top nav

The day's largest batch wires reasoning effort end-to-end, ships a Session Cost view, lands a full private bug-report pipeline with admin tooling, and rebuilds the public marketing chrome around a centered top nav and new /code page. Several reliability fixes around CI, public chat, auth, and the changelog stats card also land here.

- Chat gained a Session Cost section in the context popover showing cumulative input/output/cached tokens, a weighted cost-per-token with per-type rate overlay, and a dollar total that matches what aura-router actually bills; backend now exposes cumulative tokens, model, and provider so the panel survives reloads. (`f697368`, `cfb232a`)
- Model picker reorganized into collapsible Anthropic / OpenAI / Open Source sections with hover submenus showing cost multiple, context window, and a thinking-effort selector whose effort-scaled credit cost is surfaced before selection; reasoning_effort is now a typed enum threaded through the harness wire contract. (`e54c97e`, `22d102c`, `8b535cc`, `0c1fe62`, `d0aa429`)
- Image mode now exposes a per-model quality selector (low/medium/high/auto) for GPT Image with a saner medium default, with model and quality dropdowns made mutually exclusive in the input bar. (`1d7d864`, `db26a43`)
- Anthropic per-token rates were resynced (Opus 4.7 to $5/$25, Haiku 4.5 to $1/$5), every model's credit multiplier was rebased against Haiku 4.5 = 1x, and the catalog grew Fireworks open-weight models (MiniMax M2.7, GLM 5.1, Qwen3.6 Plus, Gemma 4) plus per-provider picker headers. (`a0f8c6a`, `bb51dba`)
- End-to-end private Bug Reports shipped: client collects a full diagnostic bundle (prompt, transcript, model, breadcrumbs, env) behind a required consent modal, the server stores it privately and generates an Opus 4.8 triage summary asynchronously, and an admin-only Bug Reports app lets sys admins view reports, resolve linked feedback in one click, and spin up fix tasks; reports are also mirrored as public Bug posts in Feedback. (`a0d3a16`, `0abe66c`, `a81296a`, `a1cfda1`, `db00a3c`, `f3496c5`)
- Public marketing navigation was rebuilt around a centered PublicTopNav (Agents / Code / Pricing + Resources dropdown) with the AURA wordmark as the home link, /product renamed to /agents with a redirect, a new /code page splitting out the product-screen sections, and a Chat <-> back toggle on the bottom-left taskbar. (`7054547`, `4052336`)
- Public chat now proxies turns straight to aura-router's /v1/messages instead of a non-existent local harness, fixing 'public demo agent failed to start a session' on the aura.ai Render deployment; the public /models page is also populated from bundled model constants so it no longer renders empty. (`5687850`, `cb59c9f`, `cdcc01f`)
- Hardened auth and session handling: a sys_admin allowlist (SYS_ADMIN_EMAILS) was introduced and made robust across email sources, logout now closes lingering modals and lands users on the public page, and out-of-org sessions in the chat-app sidebar now open by their true owner agent id instead of 404ing. (`7b5e6a6`, `2d78b37`, `a043143`, `e2e1549`, `59d528a`)
- Short-lived WebSocket connect tickets replace ?token= JWTs in URLs for events, terminal, browser, and remote-agent terminal connections, keeping long-lived JWTs out of Render access logs. (`3775739`)
- Stop dev-run executor agents from piling up in the projects sidebar by tracking system-minted instance IDs in a storage-independent SettingsStore ledger that the janitor can drain even when storage strips role columns. (`c895064`)
- CI setup-node was made resilient to transient DNS failures on self-hosted runners via a new composite action that polls api.github.com and nodejs.org with backoff, with subdirectory-checkout jobs reverted to the upstream action. (`4e4d177`, `36fc5ac`)
- Changelog commit counts moved off live unauthenticated GitHub fan-out: first behind a cached server proxy, then a published commit-stats.json snapshot generated by CI with the workflow token, retiring the /api/public/commit-stats endpoint and ending the recurring '0 this month' degradation. (`a889c25`, `472ee9f`)
- Quality-of-life polish: generated chat images fade in after img.decode rather than painting in progressively, the media generation placeholder uses a canvas ripple loop, autofill popups are suppressed on chat composers, the streaming indicator paints above the input gradient, and the boot splash drops in favor of a direct reveal. (`64a35d8`, `c5b5017`, `d3adb7d`, `ab5623d`, `dfc17de`)
- Pricing page lost the Crusader plan and Mortal was renamed to Free at $0/mo, and a new personal 'You' section is now the default first entry in Settings with Appearance renamed to Theme. (`108ef6e`, `a0f8c6a`, `a043143`)
- Marketing banner count-ups were reworked to always animate from 0 to the real value on every visit, with a small-magnitude pacing fix so few-step counts no longer snap. (`38e526d`, `456c843`, `8ae820c`, `ce86b37`)
- SwarmHarness was migrated to the new two-step POST /v1/agents/:id/run + WS stream contract, resolving the 'did not emit session_ready within 20s' failures left behind by the removed POST /sessions handshake. (`1d36c7d`)
- OpenAI rejections from oversized prompt_cache_key strings on gpt 5.5 were unblocked by clamping to the 64-char limit, then centralized in the harness so aura-os forwards the raw semantic key. (`3771e44`, `5e74c37`)

## 10:23 PM — Desktop launch lands on the public surface when logged out

A small but visible desktop fix so a logged-out launch no longer flashes a login overlay over the public page.

- Desktop now skips restoring the last route at launch when no baked session exists on disk, so logged-out users land directly on the public surface instead of being bounced to /login by RequireAuth. (`1b13787`)

## 10:27 PM — Mock desktop windows become interactive and the public top nav settles

Late-night tuning of the public landing surface: the mock desktop's DM windows gained working window controls, the marketing scroll column stopped flashing black under Suspense, and the new top-bar Resources menu opens on hover.

- DM windows on the public mock desktop now have working minimize, maximize, and close controls backed by per-thread state in the DMWindowManager reducer, with focus-order kept out of the aria-hidden demo. (`1b68efd`)
- Marketing scroll column now paints with the destination page's background while lazy chunks load, killing the black flash on first visit to /agents, /code, or /pricing. (`182e2c1`)
- Public top-bar nav was pinned to a fixed light color so it no longer re-tints with persona changes, with the Resources dropdown now opening on hover (with a grace period for crossing into the menu) in addition to click and focus. (`9b85466`, `3bce1d2`)
- Bottom-left Chat icon in public mode toggles between /chat and the last non-chat public page, mirroring the authed Desktop button's previous-path behavior. (`9756b2f`)

## 10:38 PM — Fallback titlebar no longer flashes on web refreshes

A targeted boot fix for the browser build's perceived startup polish.

- The static boot-fallback titlebar (min/maximize/close) is now gated behind html.aura-desktop-shell, which the inline boot script only sets when the native window.ipc bridge exists, so the browser build no longer flashes the controls on every refresh. (`709a477`)

## 10:42 PM — Gemini chat models, login-flow polish, and final landing tweaks

Closing batch of the day adds the Google Gemini family to the chat picker, removes lingering public surfaces after login, fixes the profile pill not updating after sign-in, and tightens the login overlay's entrance.

- Seven Google Gemini chat models (Gemini 3.1 Pro, 3.5 Flash, 3 Flash, 3.1 Flash-Lite, 2.5 Pro/Flash/Flash-Lite) joined the picker and the marketing /models page with matching client pricing, including cache-aware cost handling consistent with DeepSeek. (`8151349`)
- Login now fully tears down the public marketing routes and the underlying PublicChatView so the public SSE stream and persona animations stop, and the marketing /agents route no longer shadows the authenticated Agents app index. (`f05cf02`)
- Profile pill now syncs to the authenticated user immediately on LoginOverlay sign-in by subscribing the profile store to auth-store updates, instead of staying on 'Sign in' until a refresh. (`dd97f66`)
- Chat streaming flicker was eliminated by removing a content-visibility paint hint on per-message wrappers that re-evaluated on every token, and the login overlay now uses a darker, blurrier backdrop with a reduced-motion-friendly fade-in. (`7c97241`, `be1636f`)
- Model picker now closes any open effort flyout synchronously when another row's flyout opens, so switching models no longer briefly shows a ghost of the previous submenu. (`0f3ce79`)
- Public mode chrome was reshuffled again: the sidebar drawer toggle moved into the bottom-left taskbar cluster, with the rotating tagline centered in the bottom bar. (`276f61d`)

## Highlights

- Per-model reasoning effort with credit multipliers in the picker
- Session Cost section shows real token spend in chat
- Private bug reports with consent gate and admin viewer
- Public marketing nav moved to a centered top bar with new /code page
- Guest token self-heal and public chat now proxies via aura-router
- WebSocket connect tickets keep JWTs out of URLs


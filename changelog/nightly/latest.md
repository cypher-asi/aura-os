# Agent onboarding wizard, marketing site overhaul, and analytics rescue

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.640.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.640.1

A heavy day across the public surface: a new black-glass "Create your agent" wizard, a full marketing site rebuild in 20 locales with real legal pages and a multi-repo whitepaper, a top-to-bottom mobile public shell, and an analytics fix that restores accurate DAU after weeks of silently-broken desktop telemetry.

## 9:18 AM — Theme-aware mode selector capsule

The input bar's mode selector now picks up the active theme accent and ships with calmer selected-state styling.

- Mode selector capsule and selected-mode label now read from the theme accent, with a softer glow on the active option. (`ec00764`, `4b52616`)
- Stabilized eval fixtures by seeding the Run sidekick tab and mocking transient remote probes so CI assertions stay deterministic. (`34404cf`)

## 9:54 AM — Remote agent turns survive cold microVM wakes

Long-running remote agent turns no longer surface as spurious stalls or 502s when a hibernated microVM is warming up.

- Raised the idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s) instead of a hardcoded 60s, so actively-progressing tool/LLM work isn't killed mid-flight. (`f3a817c`)

## 9:59 AM — Chat typing latency and idle GPU usage fixes

Two performance regressions in the chat surface and agent profile card are resolved, removing app-wide slowdowns on every keystroke and on integrated GPUs.

- Eliminated the full-transcript re-render on every chat keystroke by stabilizing the error-agent context hook and memoizing ChatMessageList, so the whole transcript no longer re-parses markdown on each draft character or streaming token. (`ae002b8`)
- Cut idle GPU cost of the 3D agent profile card by dropping unused antialiasing, halting the render loop under prefers-reduced-motion once transitions settle, and pausing off-screen via IntersectionObserver. (`b562759`)
- Always-on chat input animations now honor the OS prefers-reduced-motion setting. (`ae002b8`)

## 10:10 AM — Server session_active carries real app_version

The daily session_active event no longer gets stamped with a missing app_version when a header-less request wins the dedupe slot.

- Server now remembers the latest non-empty X-App-Version and X-App-Platform per user and falls back to those when the triggering request omits headers, so the once-daily session_active always carries a real version on Mixpanel. (`3d0bef1`)
- Capture-mode tokens are now skipped entirely for session_active, removing a fake DAU user with no version. (`3d0bef1`)

## 10:22 AM — AURA OS whitepaper and full marketing localization

The public /os whitepaper grew an Invariants section and detailed diagrams, and the marketing surface was translated into all 19 non-English locales alongside polish to the trust card and login.

- Reworked the /os whitepaper with per-section summaries, Overview/Internals ASCII diagrams, a new Invariants section, sequence diagrams for user flows, and inline code references that link out to the public aura-harness repo. (`e84938a`, `54f3e01`, `7d9aca5`)
- Generated marketing.json and publicChat.json for all 19 non-English locales (plus expertise detail pages), routed the rotating tagline through i18n, and added reproducible machine-translation and validation scripts so changing site language now actually changes marketing content. (`0d6155a`)
- Login email field is now a dropdown of remembered accounts (up to 5, most-recent first) with an "Add an account" option and per-entry forget. (`886e305`)
- Trust card polish: the "Always on." toggle became clickable with a sequenced knob/label animation, the trust display panel is centered against the card edge, marketing page resize flicker was eliminated, and the trust disc, verified cubes, and paint gallery now keep animating under reduced motion. (`47a76da`, `f942415`, `184024e`, `a6a21a5`, `49c23e0`)

## 11:19 AM — Glass agent onboarding wizard, mobile public shell, and analytics rescue

A wide afternoon thread shipped a brand-new public agent-creation wizard, rebuilt the mobile marketing site around a Creator hero, expanded the whitepaper to every core repo, added real legal pages, and rescued desktop analytics.

- Shipped a six-step "Create your agent" wizard (Identity, Skills, Integrations, Messaging, Automations, Launch) rendered in a reusable black-glass modal with compact selectable tiles, Lucide icons, a footer Create-account CTA, and signup that applies the onboarding draft to a remote-only CEO agent. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `fa244c3`, `7927779`, `87e883e`, `c1c63dc`, `101aece`)
- Rebuilt the mobile public site around a Creator-pinned landing hero with live persona WebGL plasma, a full-screen hamburger menu sharing nav links with desktop, a framed page shell matching desktop chrome, static WebGL posters where canvases are disabled, and a 4x4 skill keypad — plus dedicated /chat routing off the landing page. (`743979e`, `af596ea`, `0c0fe4e`, `98a9925`, `c1cb5e2`, `d36f573`, `c94afcb`, `8e12874`, `ed3e93a`, `7684bcb`, `4e36250`)
- Replaced the placeholder /terms and /privacy heroes with full CYPHER, INC. legal documents in 20 locales, gave them the standard hero/CTA/footer stack, and unified all public pages on a black shell with risen-glass panels plus a two-column Resources nav that includes Docs. (`e29e90c`, `7565b5e`, `46c231e`, `70188ec`, `afc12be`)
- Extended the /os whitepaper to cover aura-os, aura-router, aura-network, aura-storage, and z-billing as their own collapsible nav groups with repo-aware code links, and unified /docs and /os on a shared MarkdownDocSite layout that reads published content from prod in dev. (`6df99cb`, `c045d96`, `41c6000`)
- Restored desktop analytics: VITE_MIXPANEL_TOKEN is now injected into the build-interface job for nightly and stable releases (with a --require-analytics guardrail that fails the build on missing token or 0.0.0 fallback), the web build derives app_version from git describe instead of 0.0.0, and server-emitted session_active now stamps is_authenticated=true so True DAU breakdowns line up. (`6e669ed`, `7790077`, `262e2cf`)
- Hardened agent surfaces for web/mobile: local agents are filtered everywhere there is no desktop bridge, stale or deleted last-agent IDs no longer leave the sidekick empty after login, chat history is warmed on click and post-login redirect, and the env popup links the deployed harness commit. (`599102e`, `166913c`, `29fbc11`, `a792833`, `066fdd7`)
- Disabled Vite 8's AI-agent console forwarding in dev, which had been latching onto a dead websocket and locking the page in an infinite error loop before React mounted. (`b2296e3`)
- Fixed a Windows/WebView2 dead-zone where the centered public top nav left a stale no-drag region beside the menu, by centering the slot with layout instead of a CSS transform so window dragging is reliable on desktop. (`0845a1c`)

## Highlights

- New 6-step glass agent onboarding wizard
- Public marketing site translated into 19 new locales
- Whitepaper expanded to cover all core AURA repos
- Mobile public landing rebuilt around a Creator hero
- Desktop analytics restored: real app_version and authenticated DAU
- Long remote-agent turns no longer trip spurious timeouts


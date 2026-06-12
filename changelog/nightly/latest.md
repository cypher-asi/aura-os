# Agent onboarding wizard, mobile public site, and the new feature health page

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.643.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.643.1

A heavy day across the marketing surface and public product story: a new black-glass agent onboarding wizard, a from-scratch mobile public site, full localization of the marketing UI, real Terms and Privacy pages, an expanded /os whitepaper, and a brand-new feature health status page wired to scheduled probes. Behind the scenes, chat rendering and the agent profile card got significantly faster, remote agent turns no longer time out spuriously, and analytics finally report a real app_version and authenticated DAU.

## 9:18 AM — Theme-aware mode selector capsule

The input bar's mode selector now follows the active theme accent and ships with deterministic eval fixtures.

- Reworked the mode selector capsule to pull from the theme accent and softened the selected-state glow, so the selected mode label and capsule respect custom themes. (`ec00764`, `4b52616`)
- Stabilized project eval fixtures by seeding the Run sidekick tab and mocking transient remote-state probes so CI assertions stop flaking. (`34404cf`)

## 9:54 AM — Remote agent turns survive long tool and cold-start work

Lifted the sliding-idle and cold-open caps that were turning long-but-progressing remote turns into spurious stalls and 502s.

- Raised the default idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the microVM cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s instead of a hardcoded 60s), so waking a hibernated VM or running a long LLM/tool turn no longer aborts mid-flight. (`f3a817c`)

## 9:59 AM — Chat transcript and 3D profile card stop burning frames

Two targeted performance fixes addressed the app-wide messaging slowdown and the idle GPU cost of the agent profile card.

- Fixed the full-transcript re-render that fired on every keystroke and streaming token by memoizing the error-report agent info hook and stabilizing ChatMessageList's empty-state prop, restoring smooth typing in long chats. Also honors prefers-reduced-motion for the attach-button halo. (`ae002b8`)
- Cut idle GPU load on the 3D agent profile card by dropping unused antialiasing, halting the render loop under reduced motion once transitions settle, and pausing off-screen via IntersectionObserver — so integrated GPUs and high-DPI displays no longer throttle the rest of the app. (`b562759`)

## 10:10 AM — session_active keeps a real app_version

Closed a gap where the daily server-side session_active event could land on an empty app_version slice in Mixpanel.

- Remember the latest non-empty X-App-Version / X-App-Platform per user and fall back to it when a header-less request (native WebSocket or ticket redeem) wins the day's session_active slot, and skip the event entirely for capture-mode tokens so they no longer add a fake DAU user with no version. (`3d0bef1`)

## 10:22 AM — Whitepaper, legal pages, and the marketing UI go fully localized

The public marketing surface got its biggest content drop in a while: a restructured /os whitepaper, an Always-on trust card, remembered login emails, and translations for every supported locale.

- Restructured the /os AURA OS whitepaper around per-section summaries, Overview bullets, ASCII architecture diagrams, a new Invariants section, internals diagrams, and user-flow sequence diagrams, with inline code tokens linking out to the cypher-asi/aura-harness repo. Dev now reads the whitepaper from prod so /os shows real content locally. (`e84938a`, `54f3e01`, `748c5b3`, `7d9aca5`, `cfb01e9`)
- Translated the public marketing and publicChat surfaces into all 19 non-English locales (Arabic through Traditional Chinese), routed the rotating tagline through i18n, and added reproducible translate/validate scripts so the site language now actually changes the marketing content. (`0d6155a`)
- Login now remembers previously-used emails as a dropdown of up to five accounts (most-recent first) with an Add-an-account option and per-account forget, replacing the single-field email input. (`886e305`)
- Made the Built-for-trust 'Always on.' toggle a clickable, sequenced switch, recentered the trust display panel against the WebGL device, killed the WebGL background flicker on resize, and unfroze the trust disc, verified cubes, and paint gallery under reduced motion. (`47a76da`, `f942415`, `184024e`, `a6a21a5`, `49c23e0`, `724ee64`)

## 11:19 AM — Agent onboarding wizard, mobile public site, and an Aura status page

The afternoon shipped three big public-facing threads — a six-step agent onboarding wizard, a from-scratch mobile public site, and a feature health status page — alongside whitepaper expansion to all core repos and a long tail of analytics and reliability fixes.

- Shipped the new public 'Create your agent' onboarding wizard: a six-stage flow (Identity, Skills, Integrations, Messaging, Automations, Launch) built around a reusable black-glass modal, compact selectable tiles with hover/tap-revealed descriptions, a six-step stepper, curated personas/skills/integrations, and a footer Create-account CTA that applies the draft to a remote-only CEO agent after signup. Opens from the Create-agent CTA and is mounted globally. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `101aece`, `e937b0f`, `fa244c3`, `7927779`, `87e883e`, `c1c63dc`, `e909ded`)
- Rebuilt the mobile public site: a Creator-pinned landing hero with the live WebGL plasma and persona character video, a full-screen hamburger menu that mirrors the desktop nav, a framed shell that matches the desktop chrome, static WebGL posters where canvases are disabled, a side-scrolling mobile changelog, and dozens of mobile-only reflow fixes for marketing sections (skill keypad, trust rail, model picker, terminal feed). The inline composer moved to /chat. (`743979e`, `af596ea`, `0c0fe4e`, `98a9925`, `c1cb5e2`, `d36f573`, `278133b`, `c94afcb`, `21a3ad0`, `9d3e281`, `8e12874`, `bba733a`, `3f0c9a4`, `f30a66e`, `7684bcb`, `ed3e93a`)
- Launched the Aura feature health status page: a new /status view backed by a scheduled aura-observability GitHub workflow that runs every 30 minutes, hits a single observability route plus desktop release probes, and publishes a public status.json snapshot. Includes hardened probe shape, split-then-merged public/desktop lanes, and consistent AURA brand casing. (`5bd0ba0`, `69782ef`, `e95237d`)
- Added real Terms of Service and Privacy Policy pages for CYPHER, INC. via a shared LegalDocument component, machine-translated into all 20 locales, and folded them into the standard marketing page composition (hero, body, ChangelogPreview, CTA, footer). The black-shell color convention now extends to /terms, /privacy, and /docs. (`e29e90c`, `7565b5e`, `46c231e`, `70188ec`, `afc12be`)
- Extended the /os whitepaper beyond AURA Harness to aura-os, aura-router, aura-network, aura-storage, and z-billing, each with its own collapsible nav group and repo-aware code-reference links. The sidebar now stays pinned while reading, the empty-state flash is gone, and /docs and /os share a single MarkdownDocSite layout with an 'On this page' TOC, both pinned to prod content in dev. (`6df99cb`, `530311a`, `8c12fa2`, `41c6000`, `c045d96`)
- Restored analytics integrity end-to-end: re-injected VITE_MIXPANEL_TOKEN into the desktop build-interface step (it had silently dropped out in the June 4–5 CI refactor, leaving the SDK no-op since), added a --require-analytics guardrail that fails the build if the token isn't baked in or app_version is the '0.0.0' fallback, derived a real app_version from git describe for the Render web build, logged a loud server warning when MIXPANEL_TOKEN is unset, and stamped is_authenticated=true on server-emitted session_active so True DAU breakdowns stop dropping backstop users. (`6e669ed`, `7790077`, `262e2cf`)
- Hardened the standalone Agents experience: auto-select a valid agent on login by clearing the cached lastAgentId for logged-out or deleted agents, warm chat history on click and post-login redirect to skip the cold-load gate, hide local (machine_type="local") agents from every web/mobile surface (sidebar, project picker, agent switcher, menu cycling) since they need the desktop bridge, link the deployed harness commit from the env popup, and drop the dead host-settings button from the web titlebar. (`599102e`, `166913c`, `29fbc11`, `a792833`, `066fdd7`, `e937b0f`)
- Disabled Vite 8's auto console forwarding in dev to prevent an infinite error loop that locked the page before React mounted, and fixed a titlebar drag dead zone caused by transform-based centering of the public nav by switching to a transform-free centered slot. (`b2296e3`, `0845a1c`)

## Highlights

- New black-glass agent onboarding wizard
- Mobile public site with framed shell and WebGL landing
- Public marketing UI translated into 19 locales
- Terms, Privacy, and an /os whitepaper for all core repos
- Aura feature health status page wired to scheduled probes
- Faster chat transcript rendering and lighter agent profile card
- Analytics: real app_version and authenticated session_active restored
- Remote agent turns no longer trip spurious 180s/60s timeouts


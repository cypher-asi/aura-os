# Agent onboarding wizard, marketing site overhaul, and analytics recovery

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.642.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.642.1

A big day across the public surface and reliability stack: a new black-glass "Create your agent" wizard, a top-to-bottom rebuild of the mobile and marketing experience, a full whitepaper for the core repos, and a series of fixes that restore accurate DAU analytics and resilience for long-running remote agent turns.

## 9:18 AM — Theme-aware mode selector capsule

The input bar's mode selector now follows the active theme and ships with calmer selected-state styling.

- Repainted the mode selector capsule to draw from the active theme accent and softened the selected glow, so the picker no longer clashes with custom themes. (`ec00764`, `4b52616`)
- Stabilized the project eval suite by seeding the Run sidekick tab and mocking transient remote probes, keeping CI assertions deterministic. (`34404cf`)

## 9:54 AM — Longer remote-agent turn and cold-open windows

Remote agents waking from hibernation or running long tool/LLM work no longer trip spurious stalls and 502s.

- Raised the sliding idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s, up from a hardcoded 60s) so microVM wake-ups have room to finish. (`f3a817c`)

## 9:59 AM — Chat transcript and 3D profile card performance fixes

Two targeted perf fixes addressed the recent app-wide messaging slowdown and idle GPU burn from the agent profile card.

- Stopped the full chat transcript from re-rendering on every keystroke by stabilizing the error-report agent info hook and memoizing ChatMessageList, eliminating per-token markdown re-parsing across memoized message bubbles. (`ae002b8`)
- Cut idle GPU cost of the 3D agent profile card by dropping unused antialias allocation, pausing the render loop under prefers-reduced-motion once transitions settle, and resuming via IntersectionObserver so off-screen cards no longer composite bloom every frame. (`b562759`)

## 10:10 AM — Server session_active keeps a real app_version

Header-less requests can no longer poison the daily DAU event with a missing app version.

- The server now caches the latest X-App-Version and X-App-Platform per user and falls back to them when the request that wins the daily session_active slot omits the headers, and skips the event entirely for capture-mode tokens so synthetic users no longer inflate DAU on the (not set) version slice. (`3d0bef1`)

## 10:22 AM — Whitepaper expansion, global marketing translations, and remembered logins

The /os whitepaper got a structural rebuild and richer diagrams, the public marketing UI now translates into all supported locales, and Sign In remembers previously-used accounts.

- Restructured the /os whitepaper around per-section summaries, ASCII architecture and internals diagrams, an Invariants section with the §1–§15 architectural rules, and detailed sequence diagrams for the user flows; inline code tokens now link out to the public cypher-asi repos. (`e84938a`, `54f3e01`, `7d9aca5`, `cfb01e9`)
- Pointed /os at the prod-pinned public-content host in dev so the whitepaper renders real production content locally instead of an empty seed. (`748c5b3`)
- Translated the public marketing and publicChat namespaces into all 19 non-English locales, routed the rotating tagline through i18n, and added reproducible translate/validate scripts so changing site language now actually changes marketing copy. (`0d6155a`)
- Added a remembered-accounts dropdown to Sign In, with up to five accounts persisted to localStorage and a per-account forget action. (`886e305`)
- Polished marketing motion and layout: the Always on toggle is now clickable with a sequenced knob-and-label animation, the trust display panel centers in its gap, WebGL backgrounds no longer flicker on resize, the footer copyright became a column-aligned badge, and trust/verified/paint ambient animations are unfrozen under reduced motion. (`47a76da`, `f942415`, `184024e`, `a6a21a5`, `724ee64`, `49c23e0`)

## 11:19 AM — Agent onboarding wizard, mobile landing rebuild, and analytics restoration

A new public Create-your-agent wizard, a desktop-parity mobile public site, full Terms/Privacy/Docs content, the new Aura status page, and a critical recovery of Mixpanel analytics for desktop and web.

- Shipped a six-step Create-your-agent onboarding wizard built on a new reusable black-glass modal: identity, skills, integrations, messaging, automations, and launch, with curated avatars and personalities, a compact tile picker, a footer Create-account CTA wired to LoginForm, and a global mount that opens from the Create-agent button. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `101aece`, `fa244c3`, `7927779`, `87e883e`, `c1c63dc`)
- Rebuilt the mobile public site around a Creator-pinned landing hero with live WebGL plasma and persona video, a full-screen hamburger menu sharing nav-links with desktop, a framed shell that matches the desktop chrome, static posters for hardware scenes on phones, and reflowed agents sections (4×4 skill keypad, stacked trust rail, narrower privacy cards). (`743979e`, `c1cb5e2`, `af596ea`, `0c0fe4e`, `98a9925`, `21a3ad0`, `c94afcb`, `8e12874`, `ed3e93a`, `7684bcb`, `0845a1c`, `278133b`, `bba733a`, `3f0c9a4`, `f30a66e`, `d36f573`, `6e669ed`)
- Replaced placeholder /terms and /privacy with full CYPHER, INC. legal documents rendered via a shared LegalDocument, machine-translated into all 20 supported locales, and slotted into the standard hero/CTA/footer stack so they match every other public page. (`e29e90c`, `7565b5e`, `46c231e`)
- Extended the /os whitepaper to cover aura-os, aura-router, aura-network, aura-storage, and z-billing with full harness-style sections and repo-aware code links, unified /docs and /os onto a shared MarkdownDocSite layout with an On this page TOC, and pinned /docs at prod content in dev to stop the empty-state flash. (`6df99cb`, `530311a`, `8c12fa2`, `41c6000`, `c045d96`, `af596ea`)
- Restored Mixpanel analytics across desktop and web: VITE_MIXPANEL_TOKEN is now baked into the build-interface job for both nightly and stable releases (with a --require-analytics guardrail that fails the build if missing), the web build derives a real APP_VERSION from git when one isn't passed, server-emitted session_active now always stamps is_authenticated=true, and a loud startup warning fires when MIXPANEL_TOKEN is unset. (`6e669ed`, `7790077`, `262e2cf`)
- Added the Aura feature health status page, the scheduled aura-observability workflow that runs probes every 30 minutes and publishes a public status.json, desktop release observability probes wired into the release workflows, and a follow-up fix to keep the live snapshot publishing. (`5bd0ba0`, `69782ef`)
- Tightened agent runtime visibility and post-login routing: local agents are now hidden from every web and mobile surface (project picker, mobile roster, explorer tree, switcher, menu cycling), and the standalone Agents view validates the cached last-agent id, clears it on logout, and warms chat history on click so the first selection no longer flashes the cold-load gate. (`599102e`, `166913c`, `29fbc11`)
- Unified the public site on a black-shell visual system with risen-glass panels across pricing, blog, changelog, downloads, feedback, models, os, docs, terms, and privacy, added Docs to a two-column Resources nav, retired the dead web titlebar host-settings button, and fixed a Chromium drag-region bug that left a dead zone beside the centered nav. (`70188ec`, `afc12be`, `e937b0f`, `0845a1c`, `1cc948b`, `bcf776c`, `238c8c2`, `21b7109`)
- Killed a Vite 8 dev-server lock-up where AI-spawned dev servers auto-enabled console forwarding into a never-connected websocket, looping errors before React could mount; forwarding is now disabled and the three.js manualChunks split keeps three.js out of the entry-critical vendor chunk. (`b2296e3`)
- Surfaced deployed harness commit links inside the agent environment popup, with a capped width and ellipsized error messages so long errors no longer blow out the layout. (`a792833`, `066fdd7`)

## Highlights

- New agent onboarding wizard with black-glass modal
- Full marketing site refresh, mobile landing, and 19-locale translations
- Terms, Privacy, and core-repo whitepaper now live
- Mixpanel analytics restored across desktop and web
- Long remote-agent turns no longer trip false timeouts


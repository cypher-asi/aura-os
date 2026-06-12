# Agent onboarding wizard, mobile public site, and analytics integrity

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.641.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.641.1

A big day across the public surface: a brand-new glass agent onboarding wizard, a full mobile public landing experience, a multi-repo /os whitepaper, and real Terms/Privacy pages translated into 20 locales. Underneath, the team also unstuck two silent analytics regressions, sped up chat and the 3D profile card, and shipped a feature health status page wired to scheduled probes.

## 9:18 AM — Theme-aware mode selector capsule

The input bar mode selector now picks up the active theme accent and softens its selected-state glow, with eval fixtures stabilized alongside.

- Reworked the mode selector capsule to use the theme accent for the selected label and tone down the selected glow, so the chip blends with custom themes instead of locking to a fixed color. (`ec00764`, `4b52616`)
- Stabilized project eval fixtures by seeding the Run sidekick tab and mocking transient remote state probes so CI assertions stay deterministic. (`34404cf`)

## 9:54 AM — Remote agent turns no longer time out mid-work

Long but actively-progressing remote agent turns were tripping the sliding idle and cold-open caps, surfacing as spurious stalls and 502s; the timeouts were raised and made configurable.

- Raised the per-turn idle timeout from 180s to 600s and the first-event timeout from 180s to 300s, and replaced the hardcoded 60s cold-open cap with a configurable AURA_COLD_OPEN_TIMEOUT_SECS (default 180s) so waking a hibernated microVM or running long tool/LLM work no longer surfaces as a fake stall. (`f3a817c`)

## 9:59 AM — Chat keystroke latency and idle GPU cost

Two targeted performance fixes: the chat transcript no longer re-parses markdown on every keystroke, and the 3D agent profile card stops compositing bloom while idle.

- Stopped the full chat transcript from re-rendering on every draft keystroke and streaming token by memoizing the error-agent context hook and ChatMessageList, restoring memoization through MessageBubble and ending the recent app-wide messaging slowdown. (`ae002b8`)
- Cut idle GPU cost of the agent profile card by dropping the unused antialias buffer, halting the THREE.js render loop under prefers-reduced-motion once transitions settle, and re-adding an IntersectionObserver pause for off-screen cards. (`b562759`)

## 10:10 AM — Server session_active keeps a real app_version

Header-less requests could win the daily session_active dedup slot and land it on Mixpanel's app_version = (not set) slice; the server now remembers the latest known version per user.

- Server-emitted session_active now falls back to the latest non-empty X-App-Version / X-App-Platform remembered per user when the triggering request omits headers, so the daily True DAU event always carries a real app version instead of '(not set)'. (`3d0bef1`)
- Skipped session_active entirely for capture-mode tokens so synthetic capture-demo-user traffic stops adding a fake DAU user with no version. (`3d0bef1`)

## 10:22 AM — Whitepaper, legal pages, and 20-locale marketing translations

The /os whitepaper got a structural rework with diagrams and code links, real Terms and Privacy pages replaced the placeholders, and the entire public marketing surface was translated into all 19 non-English locales.

- Restructured the /os whitepaper with two-line section summaries, Overview bullets, ASCII architecture and internals diagrams, an Invariants section, detailed user-flow sequence diagrams, and code-reference tokens that link out to the public cypher-asi/aura-harness repo. (`e84938a`, `54f3e01`, `7d9aca5`, `cfb01e9`)
- Translated the public marketing and publicChat namespaces into all 19 non-English locales (including expertise detail pages) and routed the rotating tagline through i18n, so changing the site language now actually changes marketing content instead of falling back to English. Added reproducible machine-translation and placeholder-validation scripts. (`0d6155a`)
- Added a remembered-accounts dropdown to the Sign In email field that persists up to five recent emails with an 'Add an account' option and per-entry forget control. (`886e305`)
- Polished the Built for Trust card with a clickable, animated 'Always on.' toggle, the trust display panel correctly centered against the device, and the trust disc, verified cubes, and paint gallery animations no longer freezing under prefers-reduced-motion. (`47a76da`, `f942415`, `184024e`, `49c23e0`, `a6a21a5`)

## 11:19 AM — Glass agent onboarding wizard, mobile public site, and feature health page

The largest thread of the day: a brand-new black-glass Create-your-agent wizard, a desktop-equivalent mobile public landing, multi-repo whitepaper coverage, real Terms/Privacy pages, an Aura feature health status page, and two analytics integrity fixes for desktop and web.

- Shipped the public Create your agent wizard end-to-end: a six-stage flow (Identity, Skills, Integrations, Automations, Messaging, Launch) built on a new reusable GlassModal with compact selectable tiles, hover/info-dot descriptions, a personality picker, and a footer Create-account CTA that applies the draft to the user's CEO agent after signup. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `fa244c3`, `7927779`, `87e883e`, `101aece`)
- Rebuilt the mobile public landing to mirror the desktop story: a Creator-pinned hero with persona WebGL plasma and character video, a full-screen hamburger menu sharing the desktop nav, framed shell with shell-stroke border, and mobile-only reflows for the agents sections, trust device rail, skill keypad, and privacy cards. (`743979e`, `af596ea`, `0c0fe4e`, `c1cb5e2`, `c94afcb`, `8e12874`, `7684bcb`, `ed3e93a`, `0845a1c`, `278133b`, `d36f573`)
- Added the Aura feature health status page: a public StatusView, a scheduled GitHub Actions workflow that runs status probes every 30 minutes and publishes a snapshot, desktop-release observability probes wired into the nightly and stable release workflows, and a new observability route on the server. (`5bd0ba0`)
- Replaced the placeholder /terms and /privacy heroes with full Terms of Service and Privacy Policy documents for CYPHER, INC., rendered via a shared LegalDocument component and machine-translated into all 20 supported locales, with the standard changelog/CTA/footer stack underneath. (`e29e90c`, `7565b5e`, `46c231e`)
- Extended the /os whitepaper beyond AURA Harness to cover aura-os, aura-router, aura-network, aura-storage, and z-billing as their own collapsible nav groups with per-section diagrams, made code-reference links repo-aware, and unified /os and /docs onto a shared MarkdownDocSite layout that reads published content from prod in dev. (`6df99cb`, `41c6000`, `530311a`, `8c12fa2`, `c045d96`)
- Restored Mixpanel coverage in desktop builds: the build-interface job now receives VITE_MIXPANEL_TOKEN in both release-nightly and release-stable so the desktop client stops shipping a silently no-op SDK, with a --require-analytics guardrail in desktop-frontend-assets-validate that fails the build if the token or app_version is missing. The web build now derives APP_VERSION from git describe instead of falling back to package.json's '0.0.0', and the server logs loudly when MIXPANEL_TOKEN is unset. (`6e669ed`, `7790077`, `262e2cf`)
- Hid local agents from every web and mobile surface where there is no desktop bridge — main sidebar, project attach picker, project explorer, agent switcher, mobile roster, and menu cycling — via a centralized runtime-visibility predicate, and added a stale-agent recovery path that bounces dead /agents/<id> deep links to a valid agent on login. (`599102e`, `166913c`, `29fbc11`)
- Restyled the public marketing surface around a 'risen black glass' system: unified /pricing, /blog, /changelog, /downloads, /feedback, /models, /os, /docs, /terms, and /privacy on a flat #090909 surface inside the diagonal shell frame, with a two-column Resources nav that adds Docs to the menu. (`70188ec`, `afc12be`, `238c8c2`)
- Unblocked the dev experience by disabling Vite 8's auto-enabled console forwarding, which was latching onto a dead websocket and locking the page in an infinite error loop before React mounted. (`b2296e3`)
- Fixed a Windows/WebView2 dead zone where the centered public top nav left a stale -webkit-app-region hole beside the menu after a layout swap, by centering the slot with justify-content instead of a CSS transform so the draggable rect matches the visual position. (`0845a1c`)

## Highlights

- New black-glass Create-your-agent wizard with 6 stages
- Mobile public landing with Creator hero and full-screen menu
- Public marketing, Terms, and Privacy translated into 20 locales
- Mixpanel token and app_version regression fixed in desktop releases
- Chat transcript no longer re-renders on every keystroke
- Feature health status page with scheduled probes


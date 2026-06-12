# Agent onboarding wizard, public site overhaul, and analytics rescue

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.644.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.644.1

A heavy day on the public surface: a brand-new guided agent onboarding wizard, full marketing site translation into 19 languages, Terms and Privacy content, mobile public landing, an expanded /os whitepaper across the core repos, and a new feature health status page. Under the hood, the team fixed a chat typing slowdown, tamed remote-agent timeouts, restored Mixpanel analytics on desktop builds, and shipped an observability pipeline.

## 9:18 AM — Theme-aware mode selector capsule

The input bar's mode selector now respects the active theme accent with a softer selected state.

- Repainted the mode selector capsule and selected label to pull from the theme accent, and softened the selected glow so it no longer overpowers the input bar. (`ec00764`, `4b52616`)
- Stabilized the Run sidekick and workflow eval fixtures so CI assertions stop flaking on transient remote-state probes. (`34404cf`)

## 9:54 AM — Longer-running remote agent turns no longer time out

Server-side timeouts were raised so actively-progressing remote agent turns and microVM cold opens stop surfacing as spurious stalls.

- Raised the idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the microVM cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s, up from a hardcoded 60s), eliminating false 502s when waking hibernated agents or running long tool/LLM work. (`f3a817c`)

## 9:59 AM — Chat typing slowdown and idle GPU drain fixed

Two targeted perf fixes restored snappy keystrokes in chat and stopped the agent profile card from quietly throttling the system.

- Stopped re-parsing the entire transcript on every keystroke by memoizing the error-agent context hook and stabilizing the ChatMessageList empty-state prop, undoing the app-wide messaging slowdown; also honors prefers-reduced-motion on the attach-button halo. (`ae002b8`)
- Cut the idle GPU cost of the 3D agent profile card by dropping unused antialias, halting the bloom render loop once hover/flip transitions settle under reduced motion, and pausing off-screen via IntersectionObserver. (`b562759`)

## 10:10 AM — Daily session_active events keep their real app_version

Server-emitted analytics no longer land on Mixpanel's '(not set)' app_version slice.

- Server-side session_active now remembers the latest X-App-Version and X-App-Platform headers per user and falls back to them when a triggering request omits them, and skips the event entirely for capture-mode tokens — so daily DAU events always carry a real version instead of a fake user with no version. (`3d0bef1`)

## 10:22 AM — Whitepaper, legal pages, and full marketing translations land

A wave of public-site work: an expanded /os whitepaper, an interactive 'Always on.' toggle, remembered login emails, and machine translations for all non-English locales.

- Reworked the /os whitepaper with two-line section summaries, ASCII architecture diagrams, an Invariants section, request-lifecycle and user-flow sequence diagrams, and GitHub-linked inline code references; dev now pulls content from prod so /os is no longer blank locally. (`e84938a`, `54f3e01`, `748c5b3`, `7d9aca5`, `cfb01e9`)
- Translated the public marketing and publicChat UI into all 19 non-English locales — previously every non-English visitor silently fell back to English — and routed the rotating tagline through i18n, with reproducible translate/validate scripts checked in. (`0d6155a`)
- Added a remembered-accounts dropdown to the Sign In email field, persisting up to five recent emails in localStorage with an 'Add an account' option and per-account removal. (`886e305`)
- Polished the 'Built for trust' card: the 'Always on.' switch is now clickable with a sequenced knob-slide and label-fade animation, the trust display panel centers correctly in the right gap, and the trust disc, verified cubes, and paint gallery animate even under reduced motion. (`47a76da`, `f942415`, `184024e`, `49c23e0`, `724ee64`)
- Fixed the marketing WebGL background flicker on every resize by repainting synchronously after the ResizeObserver clears the drawing buffer. (`a6a21a5`)

## 11:19 AM — Agent onboarding wizard, mobile public site, and observability go live

The day's largest batch shipped the new public 'Create your agent' wizard, a mobile-friendly public landing, Terms/Privacy content, an Aura feature health page, and restored analytics on desktop builds.

- Launched the public agent onboarding wizard — six steps (Identity, Skills, Integrations, Messaging, Automations, Launch) in a reusable black-glass modal with compact selectable tiles, info-dot descriptions, a desktop-pills/mobile-progress stepper, and a footer 'Create account' CTA wired through the onboarding store; the draft applies to a remote-only CEO agent after signup. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `fa244c3`, `7927779`, `87e883e`, `c1c63dc`, `b7ca563`)
- Rebuilt the mobile public site with a Creator-pinned landing hero, persona WebGL plasma background, full-screen hamburger menu mirroring the desktop nav, framed shell with rounded corners, static WebGL posters where canvases are disabled, and dozens of mobile-specific reflow fixes (skill keypad, trust rail, privacy cards, chat-input model picker, terminal feed clipping). (`743979e`, `af596ea`, `0c0fe4e`, `98a9925`, `c1cb5e2`, `d36f573`, `278133b`, `c94afcb`, `21a3ad0`, `9d3e281`, `8e12874`, `bba733a`, `3f0c9a4`, `ed3e93a`, `f30a66e`, `7684bcb`, `d71299d`)
- Replaced the placeholder /terms and /privacy heroes with full CYPHER, INC. legal documents rendered via a shared LegalDocument component, machine-translated into all 20 locales, and wrapped them in the standard hero + changelog + CTA + footer stack on a continuous black surface. (`e29e90c`, `7565b5e`, `46c231e`)
- Shipped the new public Aura feature health status page backed by a scheduled GitHub Actions observability workflow that runs probes every 30 minutes, publishes a snapshot to /observability/status.json, and feeds the /status view; later passes hardened the snapshot, split public vs desktop lanes, and added release-time desktop probes. (`5bd0ba0`, `69782ef`, `e95237d`)
- Expanded /os whitepaper coverage to aura-os, aura-router, aura-network, aura-storage, and z-billing as repo-aware collapsible nav groups, and unified /os and /docs onto a shared MarkdownDocSite layout with an 'On this page' TOC; /docs now reads from prod in dev so it stops rendering empty. (`6df99cb`, `c045d96`, `41c6000`, `8c12fa2`, `afc12be`)
- Restored Mixpanel analytics on desktop and stable builds — the June CI refactor had stopped baking VITE_MIXPANEL_TOKEN into the frontend, silently collapsing True DAU; the token is now injected into the build-interface job, web builds derive a real APP_VERSION from git, the server logs loudly when MIXPANEL_TOKEN is unset, server-emitted session_active stamps is_authenticated=true, and a desktop-frontend-assets validator guards against silent regressions. (`6e669ed`, `7790077`, `262e2cf`)
- Tightened the standalone Agents experience: auto-selects a valid agent on login (clearing stale cached ids on logout and bouncing dead ones), warms chat history on click and post-login redirect, and consistently hides local-only agents from every web/mobile surface (project pickers, mobile roster, explorer, menu cycling) since they require the desktop bridge. (`599102e`, `166913c`, `29fbc11`)
- Reskinned the public marketing shell with a black-glass treatment: pricing, blog, changelog, downloads, feedback, models, os, docs, and legal pages now share the diagonal-gradient outer shell and flat #090909 surface, the Resources dropdown becomes two columns with a new Docs entry, and the agents-page phone mock drops its orange glow for neutral black glass. (`70188ec`, `af596ea`, `238c8c2`, `afc12be`)
- Fixed a subtle dead-zone where window dragging silently failed beside the centered titlebar nav — Chromium computes app-region from the untransformed layout box, so the nav is now centered without a CSS transform. (`0845a1c`)
- Worked around a Vite 8 dev-server infinite error loop by disabling its agent-spawned console forwarding, and gated heavy marketing WebGL scenes (AuraScreenOrb, isolated device) to large screens only while keeping them animating regardless of reduced-motion. (`b2296e3`, `4e36250`, `1cc948b`, `ae2e0cb`)

## Highlights

- New guided agent onboarding wizard with black-glass UI
- Marketing UI translated into all 19 supported locales
- Terms of Service and Privacy Policy now live
- Mobile public landing with full-screen nav and WebGL hero
- Public Aura feature health status page launches
- Mixpanel analytics restored on desktop builds


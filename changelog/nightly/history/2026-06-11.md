# Agent onboarding wizard, whitepaper expansion, and a mobile public site

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.639.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.639.1

Today's nightly is a heavy marketing and onboarding day: a brand-new black-glass "Create your agent" wizard lands on the public site, the /os whitepaper grows to cover five core repos, the full public marketing surface gets translated into 19 locales with proper Terms and Privacy pages, and the mobile public experience is rebuilt around a Creator landing and full-screen nav. Underneath, chat performance, remote-agent timeouts, and desktop analytics all got real reliability fixes.

## 9:18 AM — Theme-aware mode selector capsule

The input bar's mode selector now picks up the active theme accent and rides a softened selected glow, with eval fixtures stabilized to keep CI deterministic.

- Repainted the mode selector capsule and selected-mode label against the theme accent token, softening the selected glow so it adapts to custom themes instead of a hardcoded color. (`ec00764`, `4b52616`)
- Stabilized project eval fixtures by seeding the Run sidekick tab and mocking transient remote state probes so smoke and workflow specs stop flaking. (`34404cf`)

## 9:54 AM — Longer remote agent turn and cold-open timeouts

Long but actively-progressing remote agent turns no longer trip the idle and cold-open caps, eliminating a class of spurious stalls and 502s when waking hibernated microVMs.

- Raised the sliding-idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s, up from a hardcoded 60s), so long tool and LLM work stops being killed mid-turn. (`f3a817c`)

## 9:59 AM — Chat keystroke lag and 3D profile card GPU cost fixed

Two performance regressions that were making the app feel sluggish are gone: every chat keystroke no longer re-renders the full transcript, and the agent profile card stops burning GPU while idle.

- Stopped the full chat transcript from re-parsing markdown on every draft keystroke and streaming token by memoizing the error-report agent info hook and stabilizing the message list's emptyState prop, restoring memoization across React.memo'd MessageBubbles. (`ae002b8`)
- Cut idle GPU cost of the 3D agent profile card by dropping the unused antialiased framebuffer, halting the render loop under prefers-reduced-motion once transitions settle, and pausing off-screen cards via IntersectionObserver. (`b562759`)
- Honored prefers-reduced-motion for the always-on attach-button halo and spin animations in authenticated chat. (`ae002b8`)

## 10:10 AM — Whitepaper, legal i18n, and the Always-on trust toggle

A broad public-site push: the /os whitepaper gains Invariants and per-layer internals diagrams, the full marketing surface is translated into 19 locales, and the Built for Trust card gets a real interactive Always-on toggle. Login also remembers previously-used emails.

- Reworked the /os whitepaper with per-section summaries, Overview bullets, ASCII architecture and internals diagrams, a request-lifecycle diagram, detailed user-flow sequence diagrams, and an Invariants section enumerating the §1–§15 architectural invariants; inline code references now link out to the public cypher-asi/aura-harness repo. (`e84938a`, `54f3e01`, `7d9aca5`, `cfb01e9`)
- Translated the public marketing and publicChat surfaces into all 19 non-English locales (including expertise detail pages), routed the rotating tagline through i18n instead of hardcoded English, and added reproducible translate/validate scripts so changing the site language now actually changes the content. (`0d6155a`)
- Shipped a clickable, sequenced Always-on toggle on the Built for Trust card (knob slides, ON label fades to the open side), centered the trust display panel against the device, and stopped the WebGL page background from flickering black on every resize step. (`47a76da`, `f942415`, `184024e`, `a6a21a5`, `49c23e0`)
- Added a remembered-accounts dropdown on the Sign In email field (up to five recent emails with an Add an account option and per-entry forget), and kept analytics honest by retaining the last X-App-Version per user so the daily server-side session_active never lands on (not set). (`886e305`, `3d0bef1`)

## 11:19 AM — Disabled Vite 8 console forwarding in dev

An infinite error loop that could lock up the dev page before React mounted is fixed by turning off Vite 8's agent-triggered console forwarding.

- Disabled Vite 8's auto-enabled console forwarding when the dev server is spawned by an AI agent, which had been latching onto a non-connecting websocket and re-forwarding every thrown error until the page froze; also split three.js into its own manualChunks bundle so it stays out of the entry-critical vendor chunk. (`b2296e3`)

## 11:22 AM — Black-glass agent onboarding, mobile public site, and Mixpanel restored on desktop

The headline thread of the day: a new "Create your agent" wizard built around a reusable GlassModal, a full mobile public site rebuild with a Creator hero and full-screen menu, whitepaper coverage extended to five core repos, Terms and Privacy content, and a critical fix that restores Mixpanel analytics in desktop release builds.

- Shipped the public Create-your-agent onboarding wizard: six-stage flow (Identity, Skills, Integrations, Messaging, Automations, Launch) built on a new reusable black-glass GlassModal with compact icon+label selectable tiles, hover/info-dot descriptions, a desktop pill stepper and mobile progress, signup-only Launch step with a footer Create account CTA, and post-signup application of the draft to a remote-only CEO agent. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `fa244c3`, `7927779`, `87e883e`, `c1c63dc`, `101aece`)
- Rebuilt the mobile public site around a Creator-pinned landing hero with the persona's live WebGL plasma, a full-screen hamburger menu mirroring the desktop nav, a framed shell perimeter matching the desktop shell, static WebGL posters where canvases are disabled, and a long tail of mobile-only reflows (4×4 skill keypad, horizontal trust service rail, narrower privacy cards, EN language code in the menu header). (`743979e`, `4e36250`, `af596ea`, `0c0fe4e`, `98a9925`, `c1cb5e2`, `d36f573`, `278133b`, `c94afcb`, `21a3ad0`, `9d3e281`, `8e12874`, `bba733a`, `3f0c9a4`, `ed3e93a`, `f30a66e`, `7684bcb`, `d71299d`, `e909ded`)
- Extended the /os whitepaper beyond AURA Harness to aura-os, aura-router, aura-network, aura-storage, and z-billing — each a collapsible nav group with summaries, architecture and internals diagrams, and repo-aware code links — and unified /os and /docs onto a shared MarkdownDocSite with an "On this page" TOC, pinned in dev to the prod content host. (`6df99cb`, `530311a`, `8c12fa2`, `41c6000`, `c045d96`, `afc12be`)
- Replaced the placeholder /terms and /privacy with full CYPHER, INC. legal documents rendered via a shared LegalDocument component, machine-translated into all 20 supported locales, and folded them into the standard marketing page stack (hero, body, changelog preview, CTA, footer) on a continuous black surface. (`e29e90c`, `7565b5e`, `46c231e`)
- Restored desktop analytics by injecting VITE_MIXPANEL_TOKEN into the new standalone build-interface job in both release-nightly and release-stable workflows, and added a --require-analytics guardrail to desktop-frontend-assets-validate that fails the build if the token isn't inlined or app_version falls back to 0.0.0 — preventing another silent DAU collapse. (`6e669ed`)
- Hardened the standalone Agents view: clear the cached last-agent id on logout, validate it against the loaded fleet before redirecting, warm the destination chat history on click and post-login redirect, and centralize a remoteOnly predicate so local (desktop-bridge-only) agents are hidden from every web and mobile surface — sidebar, project picker, mobile roster, explorer tree, switcher, and menu cycling. (`599102e`, `166913c`, `29fbc11`)
- Kept the window draggable beside the centered public top nav on desktop by centering the slot transform-free so Chromium/WebView2 compute the no-drag rect from the real layout box, eliminating a dead-zone bug after mobile→desktop layout swaps; also removed the dead host-settings button from the authenticated web titlebar. (`0845a1c`, `e937b0f`)
- Added a Shell color group to Settings → Theme → Custom colors for titlebar/taskbar chrome, linked the deployed harness commit from the agent environment popup with ellipsized long error messages, and finished the Always-on toggle by driving the knob via compositor transform so it stays smooth under WebGL load. (`9389eb3`, `a792833`, `066fdd7`, `7ab441d`, `a00528d`, `fcab8fc`, `880ad3c`, `6df99cb`)

## Highlights

- New black-glass agent onboarding wizard
- Whitepaper expanded to five core repos
- Public marketing translated into 19 locales
- Mobile public site rebuilt with Creator hero and full-screen nav
- Chat keystroke lag and 3D card GPU cost fixed
- Mixpanel token restored in desktop release builds


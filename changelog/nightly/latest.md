# Public site overhaul, agent onboarding wizard, and analytics rescue

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.645.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.645.1

A heavy day centered on the public web experience: a full-screen mobile landing, a new glass-styled agent onboarding wizard, a translated marketing surface across 19 locales, and real Terms/Privacy pages. Alongside that, server-side analytics got patched after a silent regression, a feature health status page went live, and chat performance and tone were both quieted down.

## 9:18 AM — Theme-aware mode selector in the input bar

The chat mode selector picks up theme tokens instead of a hardcoded purple accent, and eval fixtures were stabilized to keep CI deterministic.

- Recolored the mode selector capsule and selected-label to use the theme accent and a softer glow, so it reads correctly across light and dark themes. (`ec00764`, `4b52616`)
- Stabilized project eval fixtures by seeding the Run sidekick tab and mocking transient remote-state probes so e2e assertions stay deterministic. (`34404cf`)

## 9:54 AM — Longer timeouts for waking remote agents

Remote agent turns no longer trip spurious 502s when a hibernated microVM is waking up or a long tool call is actively making progress.

- Raised the idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s) instead of a hardcoded 60s, eliminating the false stalls operators were seeing on hibernated microVMs. (`f3a817c`)

## 9:59 AM — Chat transcript and agent profile card stop wasting cycles

Two perf fixes target the recent app-wide messaging slowdown and the 3D profile card's sustained GPU draw.

- Stopped the full chat transcript from re-rendering and re-parsing markdown on every keystroke by memoizing the error-agent context hook and the ChatMessageList component, and honored prefers-reduced-motion for the always-on attach-button halo. (`ae002b8`)
- Cut the 3D agent profile card's idle GPU cost: dropped a wasted multisampled framebuffer, halted the render loop under reduced-motion once transitions settle, and re-added IntersectionObserver-based off-screen pausing so integrated GPUs aren't throttled by an unused card. (`b562759`)

## 10:10 AM — Public marketing site rebuilt for mobile, i18n, legal, and onboarding

The bulk of the day reshapes the public web surface: a new mobile landing and nav, the full marketing UI translated into 19 locales, real Terms/Privacy pages, a multi-step agent onboarding wizard, an expanded /os whitepaper across the core repos, and a critical analytics fix that had been silently breaking DAU.

- Restored Mixpanel analytics for shipped builds: re-injected VITE_MIXPANEL_TOKEN into the desktop release's build-interface job (it had been lost in a June 4 CI split, silently no-op'ing the client SDK since), derived a real app_version from git describe for the Render web build instead of the package.json 0.0.0 fallback, stamped is_authenticated on server-emitted session_active so True DAU breakdowns stop bucketing as (not set), kept app_version on header-less server sessions, and added a desktop asset validator that fails the build if the token isn't inlined. (`6e669ed`, `7790077`, `262e2cf`, `3d0bef1`)
- Shipped a public Aura feature health status page at /status, driven by a scheduled GitHub Actions observability workflow that runs public and desktop release probes every 30 minutes and publishes a live status.json snapshot the marketing StatusView reads. (`5bd0ba0`, `69782ef`, `e95237d`)
- Translated the entire public marketing and publicChat surface into all 19 non-English locales (previously every language fell back to English), routed the rotating hero tagline through i18n, and added reproducible translate and validation scripts so future changes stay in sync. (`0d6155a`, `99a0e6d`)
- Replaced the /terms and /privacy placeholders with full CYPHER, INC. legal documents rendered via a shared LegalDocument component, machine-translated into all 20 locales, and folded into the standard marketing page stack with hero, changelog preview, CTA, and footer. (`e29e90c`, `7565b5e`, `46c231e`)
- Launched a six-step Create-your-agent onboarding wizard (identity, skills, integrations, messaging, automations, launch) wrapped in a new reusable GlassModal, with compact selectable tiles, a footer Create-account CTA, persona presets, and a portal-based mobile sheet so it works correctly under the mobile shell. (`81ce6f5`, `69a71e7`, `7d5c9d2`, `074dca9`, `e6ffe93`, `641ce07`, `afdb0ab`, `fa244c3`, `7927779`, `87e883e`, `c1c63dc`, `b7ca563`, `101aece`, `e937b0f`)
- Rebuilt the mobile public landing with a Creator-pinned hero (typewriter tagline, live WebGL plasma background, character video, CTA pill), a full-screen hamburger menu mirroring the desktop nav, a framed shell perimeter matching the desktop chrome, captured static posters where WebGL is gated off, and routed the chat composer to a dedicated /chat page. (`743979e`, `af596ea`, `0c0fe4e`, `c1cb5e2`, `c94afcb`, `8e12874`, `3f0c9a4`, `f30a66e`, `7684bcb`, `1a8d07a`)
- Extended the public /os whitepaper from AURA Harness to aura-os, aura-router, aura-network, aura-storage, and z-billing with per-repo collapsible nav groups, added an Invariants section and internals diagrams, made inline code references link out to the right cypher-asi repo, unified /os and /docs on a shared MarkdownDocSite layout with an On-this-page TOC, and pinned both to prod content in dev so locally seeded servers don't show empty states. (`e84938a`, `54f3e01`, `6df99cb`, `748c5b3`, `7d9aca5`, `cfb01e9`, `530311a`, `8c12fa2`, `41c6000`, `c045d96`)
- Polished the Built-for-trust card with a clickable, animated Always on toggle (compositor-driven knob slide, sequenced label fade), a centered LCD display panel, an unfrozen trust disc and verified cubes under reduced motion, and a horizontal service rail on phones. (`47a76da`, `f942415`, `184024e`, `b2296e3`, `fcab8fc`, `880ad3c`, `7ab441d`, `95237c3`, `49c23e0`, `21b7109`, `7684bcb`)
- Hardened the agents experience for web and mobile: hid machine_type=local agents across every surface that bypassed the remote-only rule (project picker, mobile roster, explorer tree, project switcher, menu cycling), auto-selected a valid agent on login while warming chat history, and added a deployed-harness commit link to the env popup. (`599102e`, `166913c`, `29fbc11`, `a792833`, `066fdd7`)
- Added a remembered-accounts dropdown to the login email field (up to 5, most recent first, forgettable), removed the web-only host settings button from the authenticated titlebar, and rerouted the authed Download pill to the in-app Downloads modal. (`886e305`, `e937b0f`, `df00ed1`)
- Unified the public pages on a black shell with risen-glass panels (pricing, blog, changelog, downloads, feedback, models, os, docs, terms, privacy), added a two-column Resources nav with Docs, fixed window-drag dead zones beside the centered titlebar nav, and stopped a Vite 8 dev-server infinite error loop when launched by an AI agent. (`70188ec`, `afc12be`, `0845a1c`, `b2296e3`, `1a8d07a`)
- Gated the heavy AuraScreenOrb and IsolatedDevice WebGL canvases to large screens, removed reduced-motion freezes that had left those scenes static, and stopped the WebGL page background from flickering black on every resize step. (`4e36250`, `1cc948b`, `a6a21a5`, `ae2e0cb`)

## 10:42 PM — Security alerts cleared across every manifest

A sweep through Dependabot alerts on the JS, Rust, and Fastlane stacks closes a batch of known RCE, auth-bypass, and ReDoS issues.

- Upgraded react-router-dom to 7.17.0 (turbo-stream RCE, DoS, XSS, open redirect), bumped jsonwebtoken to 10 (type-confusion auth bypass) on the rust_crypto backend, refreshed promptfoo to 0.121.15 (protobufjs critical RCE and friends), and pulled jwt 2.10.3 plus addressable 2.9.0 into the iOS and Android Fastlane gems; the only remaining open alert is the Linux-only glib 0.18 unsoundness blocked by the wry/webkit2gtk stack. (`4d1a0da`)

## 10:49 PM — Calmer agent activity feed and a wider chat column

Late-night chat work introduces a three-tier severity for tool output and widens the chat reading column.

- Made agent activity feedback plain-language and less alarming: a new done/attention/error severity routes soft tool failures to a quiet amber dot instead of red, command rows lead with a readable description (Check git remotes, Run tests) and collapse to one line when finished, and subagent cards show what they accomplished instead of repeating the prompt. (`60e8254`)
- Widened the chat column cap to 1040px via a shared token across the input bar, message queue, and prompt suggestions. (`fe2fe57`)

## Highlights

- Public marketing translated into 19 locales
- New agent onboarding wizard with glass modal UI
- Mobile public landing rebuilt around a Creator hero and full-screen menu
- Mixpanel analytics restored on desktop and web builds
- Aura feature health status page goes live
- Chat transcript no longer re-renders on every keystroke


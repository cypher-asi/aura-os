# Public whitepaper, fully localized marketing, and chat performance fixes

- Date: `2026-06-11`
- Channel: `nightly`
- Version: `0.1.0-nightly.638.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.638.1

A big day for the public surface of Aura: the /os whitepaper grew from a single Harness outline into a multi-repo reference with diagrams and GitHub-linked code, the marketing site picked up real Terms and Privacy pages plus translations into 19 languages, and the trust card's "Always on." switch became a real animated control. Underneath, chat got noticeably snappier, long-running remote agent turns stopped timing out, and the dev server stopped locking itself into infinite error loops.

## 9:18 AM — Theme-aware mode selector capsule

The input bar's mode selector now picks up the active theme accent instead of a hardcoded glow.

- Repainted the mode selector capsule and selected-mode label using the theme accent token, and softened the selected-state glow so it sits naturally in both light and dark themes. (`ec00764`, `4b52616`)
- Stabilized the eval suite by seeding the Run sidekick tab and mocking transient remote state probes, so CI assertions stay deterministic across runs. (`34404cf`)

## 9:54 AM — Longer remote-agent turn and cold-open budgets

Remote agents waking from hibernation or doing long tool/LLM work no longer trip spurious idle and cold-open timeouts.

- Raised the sliding idle turn timeout from 180s to 600s and the first-event timeout from 180s to 300s, and made the cold-open cap configurable via AURA_COLD_OPEN_TIMEOUT_SECS (default 180s) instead of a hardcoded 60s — eliminating the stalls and 502s that surfaced when waking a hibernated microVM. (`f3a817c`)

## 9:59 AM — Chat typing latency and idle GPU cost fixes

Two targeted performance fixes remove the recent app-wide messaging slowdown and stop the agent profile card from heating up integrated GPUs.

- Stopped the full chat transcript from re-parsing markdown on every keystroke and streaming token by memoizing the error-report agent info hook and the ChatMessageList, restoring memoization across React.memo'd MessageBubbles. (`ae002b8`)
- Cut idle GPU cost of the 3D agent profile card by dropping a wasted multisampled framebuffer, halting the bloom render loop once hover/flip transitions settle under prefers-reduced-motion, and pausing the scene off-screen via IntersectionObserver. (`b562759`)
- Honored the OS prefers-reduced-motion setting for the always-on attach-button halo and spin animations in authenticated chats. (`ae002b8`)

## 10:10 AM — Whitepaper rework, full marketing localization, and the Always-on trust card

The public /os whitepaper was restructured with diagrams and GitHub-linked code refs, the marketing site shipped in 19 new languages, and the trust card's switch became a real interaction.

- Reworked the /os AURA Harness whitepaper around per-section summaries, Overview bullets, and ASCII architecture diagrams; renamed the nav group to "AURA Harness"; and turned inline crate/file/function tokens into GitHub links into cypher-asi/aura-harness. (`e84938a`, `7d9aca5`, `cfb01e9`)
- Added a dedicated Invariants section covering the fifteen §1–§15 architectural invariants, plus per-layer Internals diagrams, a request-lifecycle diagram, and detailed sequence diagrams for the interactive, run-kickoff, headless, error-recovery, and data-lifecycle flows. (`54f3e01`)
- Pointed the dev /os whitepaper at the prod public-content host so local development renders real seeded content instead of the empty state, generalizing the existing blog helpers to serve both surfaces. (`748c5b3`)
- Translated the public marketing and publicChat namespaces into all 19 non-English locales (including expertise detail pages and the rotating tagline), and added reproducible machine-translation and placeholder-validation scripts so the catalogs stay in sync with English. (`0d6155a`)
- Turned the "Always on." trust card switch into a clickable, sequenced animation — the knob slides and the ON label fades back in on the open side — and tightened the card copy so it wraps like its siblings. (`f942415`, `184024e`)
- Polished the marketing surface: centered the trust display panel between the device and card edge, restyled the footer copyright as a column-aligned badge, stopped the full-screen WebGL backgrounds from flickering on resize, and let the trust disc, verified cubes, and paint gallery keep their ambient motion under prefers-reduced-motion. (`47a76da`, `724ee64`, `a6a21a5`, `49c23e0`)
- Added a remembered-accounts dropdown to the Sign In screen: previously-used emails are persisted to localStorage (capped at five, most-recent first) with an "Add an account" option and per-entry forget. (`886e305`)
- Fixed analytics' daily session_active so it always carries the real app_version and platform — falling back to the latest non-empty header per user and skipping capture-mode tokens entirely so they no longer pollute DAU with "(not set)". (`3d0bef1`)

## 11:19 AM — Vite 8 dev console-forwarding loop disabled

Local development no longer locks up before React mounts when Vite is spawned by an AI agent.

- Disabled Vite 8's auto-enabled console forwarding in dev, which had been latching onto a never-connected websocket and turning every forwarded error into an infinite re-forwarding loop. Also kept three.js out of the entry-critical vendor chunk via a manualChunks split. (`b2296e3`)

## 11:22 AM — Whitepaper covers five core repos, legal pages ship, and Agents view stops landing on dead agents

The /os whitepaper now spans the full AURA stack, /terms and /privacy got real localized content with the standard marketing chrome, and the standalone Agents view stops getting stuck on stale or local agents.

- Extended the /os whitepaper beyond AURA Harness to aura-os, aura-router, aura-network, aura-storage, and z-billing — each rendered as its own collapsible nav group with per-section summaries, architecture and internals diagrams — and made inline code-ref links repo-aware so they resolve to the correct cypher-asi/<repo>. (`6df99cb`)
- Tightened the /os reading experience: dropped the sidebar's nested scrollbar now that the nav lists every repo, stopped the brief "no content yet" flash by gating empty states on each query's isFetched. (`530311a`, `8c12fa2`)
- Replaced the placeholder /terms and /privacy heroes with full CYPHER, INC. (Nevada) legal documents rendered through a shared LegalDocument component, machine-translated into all 20 locales, and folded into the standard hero / changelog preview / CTA / footer marketing stack with a matching black background. (`e29e90c`, `7565b5e`, `46c231e`)
- Refined the "Always on." toggle animation across several passes: the ON label now smoothly fades in place while the knob glides on a compositor-driven translateX, returning sooner on the opposite side without the earlier snap. (`a00528d`, `fcab8fc`, `880ad3c`, `7ab441d`, `95237c3`)
- Fixed the standalone Agents view so it no longer lands on a dead agent after login: cached last-agent IDs are cleared on logout, validated against the loaded fleet before redirecting, and stale IDs bounce back to /agents. The destination chat history is also warmed on click and post-login redirect to avoid the cold-load gate flash. (`599102e`)
- Hid local (desktop-bridge-only) agents from the browser's agent list, favorites strip, and standalone deep-link resolution when running remote-only, so the web client only surfaces agents it can actually use. (`166913c`)
- Broadened the English marketing source catalog via a one-time i18n bootstrap script that pulls previously-hardcoded strings (including expertise entries and discipline pills) out of components, then re-translated the expanded catalog into every supported locale. (`99a0e6d`)

## Highlights

- /os whitepaper expanded to cover five core repos with diagrams and GitHub-linked code refs
- Full marketing site, Terms, and Privacy translated into 20 locales
- Chat transcript no longer re-renders on every keystroke
- Remote agent cold-starts and long turns stop hitting spurious 60s/180s timeouts
- Login screen now remembers up to five recent accounts


# Preview/Design modes land, plus universal agent cloning

- Date: `2026-08-10`
- Channel: `nightly`
- Version: `0.1.0-nightly.786.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.786.1

Today's nightly introduces a split Preview/Design experience for the in-app browser, backed by a new CDP inspection path on the server, and reworks agent cloning into a single flow that targets either local or remote machines. A quick follow-up also tightens the compact Preview toolbar so its controls stay legible in narrow panels.

## 3:28 AM — Preview and Design modes for the in-app browser

The browser panel gains a dedicated Design mode with an inspector and toolbar, powered by a new CDP-backed inspection path in the server.

- Added Preview and Design modes to the browser panel with a new BrowserDesignToolbar and BrowserDesignInspector, plus viewport presets and mode-aware viewport rendering. (`fe5f7b0`)
- Wired element inspection end-to-end: a new Inspect client message and InspectionResult event flow through the CDP backend and the browser WebSocket handler, so Design mode can surface inspected nodes from a running Chromium. (`fe5f7b0`)
- Enabled the Chromium/CDP backend on both dev and stable server channels so Preview and Design work in web-server builds alongside the desktop package, while feature-minimal builds can still opt out. (`fe5f7b0`)

## 5:58 AM — Compact Preview toolbar no longer clips in narrow panels

A fast follow-up on the new Design toolbar keeps its controls visible and labeled when the browser panel gets tight.

- Switched the toolbar to a container query at 360px so mode buttons collapse to icons cleanly, and marked viewport and divider groups non-shrinkable to stop clipping in compact layouts. (`de66b3c`)
- Added aria-labels and titles to the Preview and Design mode buttons so the icon-only compact state stays accessible, backed by new regression tests for the toolbar. (`de66b3c`)

## 11:45 AM — Unified agent cloning across local and remote machines

Cloning is no longer a local-only side path — a single API and modal now handle both local and remote destinations, with tighter guardrails on outbound network requests.

- Replaced the local-only clone endpoint with a generalized CloneAgentRequest that takes an explicit machine_type (local or remote), collapsing the previous CloneAgentToLocal flow into one predictable create-only path. (`d031990`)
- Reworked the agent info panel around a single CloneAgentModal (retiring CloneAgentToLocalModal) so users pick the destination in one place instead of navigating separate flows. (`d031990`)
- Restricted authenticated network requests to expected origins in the shared network client, reducing the risk of credentials leaking to unintended hosts. (`d031990`)

## Highlights

- Preview and Design modes for the in-app browser
- Element inspection over CDP wired end-to-end
- Unified agent cloning across local and remote targets
- Compact Preview toolbar no longer clips in narrow layouts


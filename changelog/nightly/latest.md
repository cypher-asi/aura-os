# Preview and Design modes land in the in-app browser

- Date: `2026-08-10`
- Channel: `nightly`
- Version: `0.1.0-nightly.785.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.785.1

Today's nightly introduces a dedicated Preview/Design workflow for Aura's embedded browser, backed by a new CDP inspection path on the server, and follows up with a same-day polish pass to keep the toolbar usable at narrow widths.

## 3:28 AM — Preview and Design modes for the embedded browser

A substantial interface and backend change adds two first-class modes to the in-app browser, with a new design toolbar, an element inspector, and Chromium/CDP-backed inspection plumbed from the Rust backend through to the UI.

- Added Preview and Design modes to the browser panel, including a new BrowserDesignToolbar for switching modes and picking viewport presets (desktop, mobile, fit) and a BrowserDesignInspector surface for inspecting elements inside the page. (`fe5f7b0`)
- Extended the CDP backend with an inspect module and a new Inspect client message so the server can resolve elements by coordinates and stream InspectionResult events back over the browser WebSocket to the UI. (`fe5f7b0`)
- Turned on the Chromium/CDP browser backend for both the dev-channel and stable-channel server builds, so Preview and Design work in web-server deployments as well as the desktop package while feature-minimal builds can still fall back to the stub backend. (`fe5f7b0`)
- Reworked the browser viewport, panel, and input hooks around a shared design-context, and taught the agent chat panel about the new modes so agent interactions stay coherent when switching between Preview and Design. (`fe5f7b0`)

## 5:58 AM — Compact Preview toolbar no longer clips its controls

A quick follow-up to the Preview/Design launch fixes layout clipping in narrow panels and makes the icon-only controls properly accessible.

- Introduced a container query on the design toolbar so mode and viewport controls collapse to icon-only buttons under 360px and stop being clipped, with flex-shrink guards on the viewport group and divider to keep the layout stable. (`de66b3c`)
- Added aria-label and title attributes to the Preview and Design buttons so the compact, icon-only state remains identifiable to screen readers and on hover, locked in by new regression tests for the toolbar. (`de66b3c`)

## Highlights

- New Preview and Design modes for the in-app browser
- CDP-backed element inspection wired end-to-end
- Preview/Design enabled on both dev and stable channels
- Compact toolbar clipping fixed with accessible labels


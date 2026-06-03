# Computer-use demos, a 3D agent card, and a top-to-bottom shell refresh

- Date: `2026-06-03`
- Channel: `nightly`
- Version: `0.1.0-nightly.589.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.589.1

A heavy day across Desktop and Interface: /record_demo grew into a real presentation pipeline with computer-use, agents got a tactile WebGL profile card with a flippable persona screen, the authed shell was reframed as a rounded screen on a gradient backdrop, and Telegram channels began wiring through a new aura-os-channels crate. Reliability work tightened long remote chat sessions and unblocked Linux CI builds.

## 10:03 AM — Record-demo pipeline, computer-use, and a major shell rebuild

A sweeping batch that shipped a real demo-recording pipeline with optional agent control, introduced the WebGL agent profile card, recolored and reframed the authed shell, and scaffolded the Telegram channels stack.

- Rebuilt /record_demo as a two-stage pipeline that captures the demo window and composites it onto a 1920x1080 background with rounded corners and an X-ready H.264 encode, with a typed DemoOptions panel in chat for resolution, target (X/Raw), background, and window-on-background toggle, plus macOS parity via avfoundation cropping and a Screen Recording permission preflight. (`00b0f29`, `6af20f4`, `996f713`, `3bbc69b`)
- Added an end-to-end computer-use capability: a local HTTP executor performs real mouse, keyboard, and screenshot actions via enigo and xcap, the server round-trips image tool-results through Anthropic-compatible history, and /record_demo can opt into it with a Windows global Ctrl+Alt+Q abort hotkey and an on-screen control warning. (`e4b1151`, `3374255`, `9acbcce`)
- Hardened demo recording on Windows: stage-2 composites now terminate cleanly with shortest=1, gdigrab uses DwmGetWindowAttribute for the true visible rect, the new Windows Graphics Capture backend records the window by handle so the clip follows it and survives overlapping windows, and the demo window opens straight into the authed shell with a self-service setup modal for missing ffmpeg or macOS permissions. (`c1e4093`, `7026529`, `34a68ae`)
- Introduced a Three.js metal agent profile card with a beveled AURA silhouette, recessed LCD screen, edge-anchored CRT scan lines, worn-metal edgewear, and a theme-blended backdrop, replacing the earlier DOM/CSS card with a portrait-only WebGL component capped to a fixed width. (`321ce21`, `0e4e38c`, `22d6683`, `5f6167a`, `45074fc`, `9b90fc4`, `a2b250d`, `ebc2c2c`, `780f18f`)
- Collapsed the UIMode trichotomy down to standard/public so authenticated users always get the full shell, deleted the Simple/Advanced ModeToggle and chat-only pin, and migrated persisted values onto the new mode. (`ab9099b`)
- Rebuilt the bottom taskbar as framed pills on a gradient TaskbarShell: a beveled charcoal-to-near-black pill with a gradient inner stroke, a nested-ring gold-then-circular plate for the active app, group dividers, an icon-shadow detail, and a standalone far-left Desktop bubble. (`467287e`, `95b0f36`, `2198dfa`, `a979a95`, `0bb8d29`, `3957409`, `41d9dc1`, `6f6e28e`, `01f57c2`)
- Scaffolded the channels stack: a new aura-os-channels crate with ChannelKind, ChatConnector, and ChannelService, a Telegram transport connector and bridge runtime, and server routes to link, list, and disconnect Telegram alongside an on-behalf agent dispatcher. (`905e55c`, `75561ad`, `4231e59`, `53e4da9`)
- Reworked agent permissions so a renamed CEO defaults to full access via the bootstrap prompt prefix, a per-agent customized sentinel lets explicit user edits (including clear-all) win over defaults, and the CEO Permissions tab unlocked its capability switches. (`fcbe16a`, `c61d954`, `e2bb0a8`, `c027dc7`)
- Fixed several long-standing chat and sidekick papercuts: Stats stayed in the visible sidekick row so evals can find it, subagent transcripts no longer rendered a false dropped-stream banner on clean re-attach, empty cached history is now revalidated on click, and the boot overlay stopped flashing a startup error on benign avatar load failures. (`9db2746`, `ff32fdb`, `5faae68`, `2a02a3c`)
- Added per-panel Glass toggles for left, middle, and sidekick (left default-on, others off), pre-stamped at boot to avoid a first-paint flash, and surfaced the agent smart-wallet address in the Profile tab plus app_version/platform tagging on server-emitted analytics. (`2eff6dc`, `3611060`, `209a7cd`, `519858a`, `29ad235`)

## 10:19 PM — Rounded screen shell, pill chat input, and SidekickList consolidation

The authed desktop became a rounded screen floating on a continuous gradient backdrop, the chat input was rebuilt as a tall gradient pill, and sidekick lists collapsed onto one shared component while remote chat reliability was significantly tightened.

- Reframed the authed desktop as a rounded screen: a gradient screen-frame on .body with the wallpaper clipped to it, the bottom-taskbar gradient promoted to a continuous shell backdrop running behind chrome and panels, and panel corners + perimeter border moved onto the body so nothing gets shaved at the curves. (`de32b5e`, `33688eb`, `f2715b4`, `9dea1a9`, `343ee83`, `0997ba7`, `8219048`)
- Rebuilt the LLM input as a 50px rounded gradient pill with a detached mode-selector tab above it, a ringed attach disc with an accent pulsing glow, a left collapse chevron, abbreviated effort labels on the model picker, and a softening-corners rule when stacked chrome expands the container. (`a21b8fb`, `b1ce331`, `a7f18d0`, `f038d33`, `0a58396`, `8cd300a`, `a512693`, `cce0c06`, `45b2dff`, `07414f5`)
- Built a shared SidekickList component on the zui Item primitive and migrated Memory, Skills, project-binding, capability, Log, and Sessions lists onto it, with a single parent-controlled selection, optional context menu, and trailingAction slots for per-row controls. (`395cc13`, `74f0aa0`, `1b23132`, `7d7061e`, `467475f`, `dc66742`)
- Hardened long remote chat sessions: a supervisor task in ws_bridge now keepalives the upstream socket and can reconnect mid-turn behind AURA_HARNESS_WS_RECONNECT, the cold-start watchdog moves from 90s to 180s, and the client doubles its consecutive auto-retry budget, surfaced via a new harness_ws_reconnect counter. (`4961377`)
- Routed core in-app colors through semantic theme tokens (status, log, diff, credit, surfaces) and added a light-gray light-theme variant for shell pills, AppNavRail plates, and the new chat input pill so every surface flips cleanly between themes. (`609671c`, `7259b1a`, `df3a60c`)
- Added a Messaging sidekick area for agents with a Telegram connect button + QR flow, documented TELEGRAM_BOT_TOKEN / USERNAME in .env.example, and fixed a re-render storm caused by duplicate channel polling between MessagingTab and TelegramConnect. (`0cb4f83`, `2135fab`, `101a32b`)
- New agents now default to the latest frontier model (aura-claude-opus-4-8) and the default_new_agent permission preset (full access minus billing), so headless and remote agents can run commands and build out of the box. (`d436382`)
- Hid sidebar, sidekick, and menu-bar chrome in standard desktop mode for a clean top bar, gated the demo recording window's reveal on the shared shell-ready signal so clips no longer open on a blank frame, and registered the MiniMax M3 chat model with full pricing entries. (`96a522f`, `0f32a98`, `914fb41`, `c130c58`)

## 10:57 PM — Linux CI: libpipewire-0.3-dev for libspa-sys builds

Unblocked Linux desktop and sidecar builds after the xcap screen-capture dependency pulled in pipewire/libspa-sys.

- Added libpipewire-0.3-dev to desktop-validate, release-nightly, and release-stable so libspa-sys' build script can find libpipewire-0.3.pc via pkg-config. (`9760c47`)

## 11:03 PM — Worn-metal agent backplate, flippable persona, and glass invite card

Extended the 3D agent card with a worn-metal info backplate, clickable section links, a click-to-flip persona screen, and a new reusable GlassCard powering a redesigned Invite Friends modal.

- Added a worn-metal backplate behind the agent card with an engraved info readout (name, role pill, status, organization, IP, wallet) using accent-colored Online text that survives ACES tone mapping, plus clickable Skills, Connectors, and Permissions rows that hit-test via raycast and switch sidekick tabs. (`e1294ba`, `7ca03b0`, `80b883a`, `46b2b6f`, `d8128a7`, `3a8d3e2`, `f491102`, `b458d69`, `3b5360f`)
- Made the card flip horizontally on click to reveal a back-face LCD that renders the agent's Personality and System Prompt, factoring face construction into a reusable buildFace() and clipping scan lines to the window outline on both mirrored sides. (`74b7c8e`, `47a64f4`, `86f1d0c`)
- Extracted a reusable GlassCard component (rounded, see-through blurred glass, gradient rim, configurable glow color) and rebuilt the Invite Friends modal around it with an AURA wordmark pill, a single code-display button, and a theme-purple aurora glow. (`3550638`, `91886c4`, `15d60c2`, `111969d`, `aaa47b9`, `98d6888`)
- Renamed the agent sidekick Profile tab to "Agent" while keeping the underlying tab id stable so routing and state continue to work. (`6cc212a`)

## 12:22 AM — Linux CI: libgbm-dev and libxdo-dev for desktop builds

Followed up the earlier pipewire fix with two more Linux native dependencies needed by the desktop and sidecar builds.

- Added libgbm-dev and libxdo-dev to desktop-validate, release-nightly, and release-stable Linux dependency steps. (`1eddffc`)

## 12:22 AM — Remote agent card: real IP, org, and live status

Tied up loose ends from the 3D card work by sequencing the flip animation with the backplate, capping the card size, and fixing wiped poll-only fields on remote agents.

- Restored the worn-metal info backplate's slide-out before the card flips and slide-back after it returns, with a snappier lerp so the swap no longer feels sluggish. (`e3f7006`, `0c7264f`)
- Fixed remote agent cards that showed blank IP and Organization or a misleading "Online": the RemoteAgentStateChanged WS handler now preserves poll-only fields like endpoint, persist_vm_id re-asserts org_id, and the card derives the real VM state so only running counts as online. (`77ad55d`)
- Capped the agent card at 265px so it no longer grows with the sidekick width and removed the obsolete PersonaCard component now that the persona surface lives on the flipped card. (`e456193`, `021c9cf`)

## Highlights

- /record_demo composites window-on-background and gains computer-use control
- New WebGL agent profile card with worn-metal backplate and flip-to-persona
- Authed desktop reframed as a rounded screen with new taskbar chrome
- Telegram channels scaffolded end-to-end (crate, server routes, sidekick UI)
- Hardened remote chat against long-session WebSocket drops


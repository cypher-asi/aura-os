# Computer-use demos, a 3D agent card, and a reshaped desktop shell

- Date: `2026-06-03`
- Channel: `nightly`
- Version: `0.1.0-nightly.591.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.591.1

A heavy build day on nightly: the /record_demo pipeline grew from a window capture into a framed, agent-driven screen recording with a self-service setup flow; the agent profile became a real WebGL "AURA card" with a flippable persona screen; the authed desktop shell was rebuilt around a rounded screen, a beveled taskbar, and a new chat input pill; and Telegram messaging arrived as a first-class agent channel. Release infra also needed two follow-up fixes to keep Linux builds green.

## 10:03 AM — /record_demo gains framed output, computer-use, and a setup flow

The desktop demo recorder evolved from a raw window capture into a configurable, agent-drivable pipeline with in-app setup and Windows-native capture.

- Recordings now ship through a two-stage pipeline: stage 1 captures the demo window's region and stage 2 composites it onto a 1920x1080 background with rounded corners and an X-ready H.264 encode, with raw passthrough still available. (`00b0f29`, `6af20f4`)
- A new DemoRecordSettings panel in the chat input lets users pick resolution, output target, background, and window-on-background framing, with macOS parity that crops the screen-capture device to the window rect and preflights Screen Recording permission. (`996f713`, `3bbc69b`)
- A local computer-use executor (real mouse/keyboard via enigo, screenshots via xcap) plus an image-capable tool-result wire format lets a computer-use agent perceive and drive the desktop during a recording, gated by an env flag and a Windows Ctrl+Alt+Q global abort hotkey. (`e4b1151`, `3374255`, `9acbcce`)
- Demo windows no longer flash the logged-out site on boot, missing ffmpeg or Screen Recording permission now surface as an in-app RecordDemoSetupModal that can locate ffmpeg and retry, and on Windows the recorder uses Windows Graphics Capture so the clip follows the window and includes WebView2 content. (`34a68ae`, `c1e4093`, `7026529`, `914fb41`)
- Telegram messaging lands as a first-class agent channel: a new aura-os-channels crate with a connector and bridge runtime, server-side dispatcher with on-behalf auth and SSE accumulation, link/list/disconnect routes, and a Messaging sidekick area with QR-based connect. (`905e55c`, `75561ad`, `4231e59`, `53e4da9`, `0cb4f83`, `101a32b`, `2135fab`)
- Agents now surface their EIP-7702 smart-wallet address (owner-only) and new agents default to the latest frontier model with a full-access permission preset, while CEO permission toggles become editable and respect user edits instead of being re-defaulted. (`519858a`, `d436382`, `c027dc7`, `c61d954`, `e2bb0a8`, `fcbe16a`)
- Long remote chat sessions stop dying on idle: the harness WS bridge now owns the upstream socket with a configurable keepalive ping and optional mid-turn reconnect, the first-event watchdog is raised to 180s, and the client auto-retry budget doubles to 4. (`4961377`)
- The authed shell is rebuilt as a rounded framed screen: simple/advanced modes collapse to a single 'standard' shell, the bottom taskbar gets a beveled gradient pill rim with a circular selected plate, and the chat input becomes a tall rounded gradient pill with an accent ring around the attach button and a collapsible mode-selector tab. (`ab9099b`, `de32b5e`, `33688eb`, `9dea1a9`, `a21b8fb`, `0997ba7`, `467287e`, `1c0cbaf`, `3942f8d`, `a512693`, `8cd300a`)
- The agent profile becomes a Three.js 'AURA card': a beveled metal shell with an LCD photo, CRT scan lines, worn-edge texture, and an accent-colored backdrop that blends with the sidekick theme, with a DOM fallback when WebGL is unavailable. (`321ce21`, `0e4e38c`, `5f6167a`, `45074fc`, `a2b250d`, `ca35694`, `9b90fc4`, `ebc2c2c`)
- Theme work routes core app colors through semantic tokens for clean dark/light flipping, adds per-panel glass toggles for the left/middle/sidekick panels (default-on for the sidebar), and ships a Downloads link in the Help menu and authed titlebar that opens in-app when signed in. (`609671c`, `3611060`, `2eff6dc`, `7259b1a`, `9032ac4`, `89c67d6`, `c0d8ce4`, `edd991e`)
- A new shared SidekickList primitive replaces hand-rolled collapsible-section lists across Memory, Skills, Sessions, Projects, Permissions, and Sidekick Log, unifying selection, context menus, and row affordances. (`395cc13`, `74f0aa0`, `1b23132`, `7d7061e`, `467475f`, `dc66742`)
- Smaller reliability and analytics fixes: subagent stream interruptions no longer surface as broken-banner errors, empty cached chat history is now revalidated on click, server-emitted session_active events get tagged with app version/platform, and the boot overlay stops flashing 'AURA hit a startup error' on missing avatar images. (`ff32fdb`, `5faae68`, `29ad235`, `2a02a3c`, `1134bd8`)
- A new MiniMax M3 chat model is registered in the picker and pricing tables alongside M2.7. (`c130c58`)

## 10:57 PM — Linux build unblocked for pipewire-backed screen capture

Adds the missing libpipewire dev package across desktop validate and release workflows so xcap-driven screen capture compiles on Linux.

- Install libpipewire-0.3-dev in the Linux dependency steps of desktop-validate, release-nightly, and release-stable so libspa-sys (pulled in by the new xcap screen-capture crate) can build. (`9760c47`)

## 11:03 PM — AURA card grows a worn-metal backplate, navigation links, and a flip-to-persona back

The 3D agent profile gains an info readout with live status, clickable section links, and a horizontal flip that reveals the personality and system prompt on the back face.

- A worn-metal backplate now extends below the card showing the agent's name, role, live status, organization, IP, and wallet, with status text glowing in the theme accent and Online/Idle/Hibernating derived from real VM state. (`e1294ba`, `80b883a`, `46b2b6f`, `d8128a7`, `fe58ee3`, `f491102`)
- Clicking the card flips it horizontally to a back face that mirrors the front frame and renders the agent's Personality and System Prompt on its LCD, with the screen-face geometry shared between sides and scan lines clipped to the real window silhouette. (`74b7c8e`, `47a64f4`, `86f1d0c`)
- The backplate adds clickable Skills, Connectors, and Permissions rows with live counts that switch the sidekick tab on click and glow on hover. (`b458d69`, `3b5360f`)
- The Invite Friends modal is rebuilt on a reusable GlassCard with an AURA wordmark pill, purple aurora glow, and a single button that toggles to the copied invite code, with corner-rounding fixes for backdrop-filter clipping. (`aaa47b9`, `3550638`, `98d6888`, `91886c4`, `111969d`, `15d60c2`, `491663c`)
- A short-lived black-glass PersonaCard with backdrop blur was introduced for Personality and System Prompt and tuned for legibility, scrolling, and theme contrast before being retired the next morning. (`079270e`, `fda7042`, `6158601`, `6db8c43`, `5690f66`)

## 12:22 AM — Linux capture stack gains missing GBM and xdo headers

Follow-up CI fix adding two more dev packages so the desktop and sidecar builds link against the input/capture crates on Linux.

- Add libgbm-dev and libxdo-dev to the Linux build dependencies in desktop-validate, release-nightly, and release-stable workflows. (`1eddffc`)

## 12:22 AM — Image-to-video, remote agent card fixes, and public funnel analytics restored

Trims the agent card after the previous night's experiments, fixes blank fields on remote agents, threads uploaded images through the video pipeline, and restores two public-funnel analytics events.

- Removes the now-unused PersonaCard component and tunes the 3D card: it shrinks to a 265px cap so widening the sidekick no longer enlarges it, and the worn-metal info strip slides out of the way before the card flips and snaps back when it returns. (`021c9cf`, `e456193`, `e3f7006`, `0c7264f`)
- Remote agent profile cards now populate IP, organization, and a truthful live status: the RemoteAgentStateChanged handler preserves poll-only fields, vm_id provisioning carries the org through, and the card derives real VM state instead of collapsing everything to 'Online'. (`77ad55d`)
- Image-to-video plumbing comes online end to end: generateVideoStream accepts source images, the chat hooks forward uploaded attachments as data URLs, and the chat input keeps focus after a file upload across the + button, drag/drop, and paste. (`2b27cfc`, `2048256`, `bb116e4`)
- Restores the public_page_viewed and public_gate_shown analytics events that dropped to zero after recent public-chat refactors, via shared hooks now mounted across PublicChatView, MobilePublicChatView, and PublicMarketingPanel. (`9fe00d1`)
- Removes the skill tag pills from the desktop profile card to declutter it. (`e384cf4`)

## 2:55 PM — AURA Council gains a combine-mechanism picker and image-to-3D

Council requests gain a configurable synthesize/contrast/side-by-side combine mechanism wired from protocol through UI, video and 3D generation accept uploaded source images, and the public share viewer opens at the latest message.

- A new CouncilMechanism (synthesize/contrast/side_by_side, defaulting to synthesize) is added to the protocol and threaded through SessionConfig, the harness, and both agent and instance chat routes so council combine behavior is configurable end to end. (`e919b89`, `79a061a`, `0de5c90`)
- The chat input's council flyout surfaces a Synthesize / Contrast / Side-by-side picker backed by a persisted chat-ui-store field that is sent on every council request from both agent and project send paths. (`d4ccc0f`, `a744c19`, `2430b52`)
- Generate-3D and the public guest video path now use the uploaded image instead of dropping it: data URLs go via image_data, pinned http URLs keep image_url, and PublicVideoRequest forwards an optional source_url upstream. (`525adc2`, `bb92efc`, `c376d28`, `0951dff`)
- The /s/:shareToken public share viewer now lands scrolled to the most recent message instead of opening at the top of the transcript. (`dba4a0b`)

## Highlights

- /record_demo grows a window-on-background pipeline with computer-use
- WebGL agent card with flip-to-persona back face
- Telegram channels and agent smart-wallet wired end-to-end
- Authed shell redesigned: rounded screen, beveled taskbar, pill chat input
- Long remote chat sessions survive idle WS drops via keepalive + reconnect


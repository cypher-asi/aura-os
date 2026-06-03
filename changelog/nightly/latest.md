# Computer-use demos, a 3D agent card, and a redesigned authed shell

- Date: `2026-06-03`
- Channel: `nightly`
- Version: `0.1.0-nightly.590.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.590.1

A massive nightly: the desktop app gains a real computer-use executor and a window-on-background /record_demo pipeline, the authed shell gets a top-to-bottom visual overhaul (rounded screen frame, gradient backdrop, beveled taskbar pills, glass panels), and the Agent profile becomes a full WebGL metal card with a worn backplate and clickable section links. Telegram messaging lands behind a new channels crate, agents default to a frontier model and full permissions, and long remote chat sessions get keepalive + reconnect hardening. Two short CI fixes unblock Linux builds for the new screen-capture stack.

## 10:03 AM — /record_demo gains a framed window-on-background pipeline and computer-use executor

The desktop demo recorder is rebuilt as a two-stage capture-and-composite pipeline with per-recording options, macOS parity, WGC capture on Windows, and a new local executor that lets agents drive the real machine.

- Reworked /record_demo into a two-stage pipeline: stage 1 captures the demo window's region, stage 2 composites it onto a 1920x1080 background with rounded corners and a drop shadow, encoded H.264/yuv420p for X-ready upload, with a DemoOptions config (resolution, target X/Raw, background, max duration, window-on-background toggle) threaded through the HTTP boundary and an in-chat settings panel. (`00b0f29`, `6af20f4`, `996f713`)
- Brought macOS to parity using avfoundation + crop with a detected screen-capture device and a CGPreflightScreenCaptureAccess permission check, and replaced native error dialogs with an in-app RecordDemoSetupModal that can locate ffmpeg or open Screen Recording settings and retry; the demo window now boots with the cached auth snapshot so it no longer flashes the public site. (`3bbc69b`, `34a68ae`, `914fb41`)
- Added a local computer-use HTTP executor that performs real mouse/keyboard input via enigo and full-desktop screenshots via xcap, plus the server-side tool-result protocol for round-tripping image content; /record_demo can now opt into computer-use mode (full-monitor capture, executor URL gated by env vars, Ctrl+Alt+Q abort hotkey on Windows). (`e4b1151`, `3374255`, `9acbcce`)
- Fixed several Windows-only capture bugs: stage-2 composite now actually terminates with shortest=1 overlays, gdigrab uses DwmGetWindowAttribute for the true visible rect, the window-appear animation is suppressed, and framed mode switches to a Windows Graphics Capture backend so recordings follow the window and include GPU-rendered WebView2 content. (`c1e4093`, `7026529`)

## 10:57 PM — Linux CI: pipewire dev headers for the new screen-capture stack

Unblocks Linux desktop and sidecar builds after the xcap dependency landed.

- Added libpipewire-0.3-dev to the desktop validate, nightly, and stable workflows so the libspa-sys build script can find pkg-config metadata. (`9760c47`)

## 11:03 PM — Agent card grows a worn-metal info backplate with clickable section links

The 3D agent profile card gets a stamped info strip below it, live status, navigation links, and a click-to-flip animation revealing a back face with personality and system prompt.

- Added a worn-metal backplate that pokes out below the agent card and renders the agent's name, role pill, live status, organization, IP, and wallet as embossed text on engraved metal, sourced from the org store, remote VM state, and the agent record. (`e1294ba`, `7ca03b0`, `80b883a`, `46b2b6f`, `d8128a7`)
- Extended the backplate with clickable Skills/Connectors/Permissions rows (counts on the right, hover-glow text, raycast hit-test to switch sidekick tabs) and a flip-on-click animation that swaps to a mirrored back face showing the agent's personality and system prompt on the LCD. (`b458d69`, `3b5360f`, `74b7c8e`, `47a64f4`, `86f1d0c`)
- Redesigned the Invite Friends modal into a reusable GlassCard: black smoked-glass body, gradient rim, AURA wordmark pill, single code-to-Copied button, and a purple theme glow, with a fix to keep corners rounded under backdrop-filter. (`aaa47b9`, `d004e57`, `3550638`, `98d6888`, `91886c4`, `111969d`, `15d60c2`)
- Added a black-glass PersonaCard for personality and system prompt with overflow-aware Show more/less, and renamed the agent sidekick Profile tab to Agent. (`079270e`, `fda7042`, `6db8c43`, `6cc212a`)

## 12:22 AM — Linux CI: gbm and xdo headers for the input + capture stack

Second small CI fix needed for the computer-use executor's native dependencies on Linux runners.

- Added libgbm-dev and libxdo-dev to the Linux dependency steps in desktop validate, nightly, and stable workflows. (`1eddffc`)

## 12:22 AM — Remote agent card shows real IP, org, and VM status

Late-night fixes around the new 3D card: drop the standalone PersonaCard, size and sequence the flip animation, and surface real remote-agent metadata.

- Preserved the remote VM's endpoint and other poll-only fields across RemoteAgentStateChanged WS events, propagated org_id through the post-provision vm_id update, and derived the real VM state on the card so remote idle/hibernating agents no longer all read as Online. (`77ad55d`)
- Removed the now-redundant PersonaCard, capped the 3D card at 265px so it stays consistent in narrow and widened sidekicks, and sequenced the info backplate to slide clear before the card flips so it no longer intersects mid-rotation. (`021c9cf`, `e456193`, `e3f7006`, `0c7264f`)

## 9:09 AM — Public funnel analytics restored after chat refactors

Brings back two web-only product metrics that quietly went to zero after the public-chat rebuild.

- Reintroduced public_page_viewed across every public web surface (chat, mobile chat, marketing panel) and public_gate_shown when the turn-count gate trips, via two small reusable hooks with unit-test coverage. (`9fe00d1`)

## Highlights

- Computer-use executor + /record_demo with framed window-on-background pipeline
- WebGL 3D agent profile card with worn-metal backplate and flip-to-persona
- Authed shell redesign: rounded screen frame, beveled taskbar pills, glass panels
- Telegram channel connector and Messaging sidekick tab
- Long-session WebSocket keepalive + reconnect for remote agents
- Simple/Advanced modes collapsed into a single Standard shell


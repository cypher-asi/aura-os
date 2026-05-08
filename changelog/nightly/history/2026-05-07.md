# New chat flow rebuilt and the macOS updater learns to recover itself

- Date: `2026-05-07`
- Channel: `nightly`
- Version: `0.1.0-nightly.483.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.483.1

A heavy day on the chat surface: the "+" new-chat experience was rebuilt end to end, session sidekick rows are now optimistic and live-titled, and a long-standing chat-bubble flicker on send was finally root-caused with a stable clientId rewrite. On the platform side, the macOS updater can now detect read-only / translocated bundles and offer one-click recovery, the Windows installer follows system light/dark mode, and a quietly-broken release default that had been shipping dev binaries to users was closed off.

## 5:47 PM — New-chat lane rebuilt: optimistic sidekick rows, live titles, and stable session switching

A long evening of work on the agents shell turned the "+" button into a real ChatGPT-style fresh-canvas flow, with optimistic placeholders, live-streamed session titles, and a host of session-switching races finally closed.

- Clicking "+" now reliably clears the chat lane and surfaces an optimistic "New chat" row in the sidekick that swaps to the real session id (and live-streamed title) the moment SessionReady arrives — fixing the "first click does nothing, second one works" behavior and the blank-placeholder lock-up. (`c3aeb20`, `fd7a552`, `2c795b8`, `bbee79c`, `6c7012d`, `a579da2`, `186c9ae`)
- Session summaries are now generated as short, human-readable 2–5 word titles the moment the first prompt is persisted, pushed live to the sidekick over the event bus so rows flip from "New chat" to e.g. "Cyberpunk Character Design" before the assistant finishes streaming. The Haiku summarizer prompt was also made content-agnostic so trivial chats no longer get titled with refusal prose. (`44738c8`, `aa14044`, `0d2fe13`, `fff04e7`, `53ab98f`)
- Chat bubble flicker on send is fixed: the prior assistant message stays mounted across the placeholder→persisted swap via an id-alias map, and a snapshot reinstate path keeps it from disappearing for a frame when send-time merges drop it. The desktop chat input bar also no longer re-renders on session switches thanks to stable, ref-backed callbacks. (`81d8b6f`, `91c47d4`, `8e0129c`, `d957b25`, `e3fcec1`)
- Backend session list endpoints now filter zero-event sessions so orphan "New chat" rows from failed first turns disappear, and chat now actually injects the agent's name, role, personality and skills into the system prompt so PersonalityTab edits are felt in conversation. Legacy null-org agents also self-heal on first chat instead of returning 424. (`c16c910`, `9a33549`, `6a7ded1`, `198f5f2`)

## 12:32 AM — Release channel default flipped to stable so the updater can't silently ship dead

A latent regression had been shipping dev-channel binaries — which disable the in-app updater — to real users. Cargo defaults now fail closed.

- Flipped the cargo default on aura-os-desktop and aura-os-server from dev-channel to stable-channel so a plain `cargo build` produces a stable, updater-enabled binary; release workflows keep their explicit `--features stable-channel` flags as belt-and-suspenders. Dev runner scripts now opt into dev-channel explicitly so local development still gets a parallel, isolated build. (`e86897a`)

## 1:58 AM — macOS updater recovery, themed Windows installer, and a from-scratch chat projector

The morning-into-evening session paired big platform fixes (translocation-aware updater, light/dark NSIS installer) with a structural rewrite of how chat transcripts are reconciled, eliminating an entire class of flicker bugs.

- macOS updater now preflights the running bundle and detects App Translocation / read-only mounts before install, surfacing a recovery card in Org Settings with a one-click "Move to /Applications and relaunch" flow (authenticated ditto + quarantine clear + atomic move) instead of the opaque mid-install EROFS failure users were seeing. (`32c4d89`, `649d3bd`)
- The Windows NSIS installer now reads AppsUseLightTheme and swaps to light header/sidebar bitmaps when the system is in light mode, and enables DWMWA_USE_IMMERSIVE_DARK_MODE for a dark title bar in dark mode (Win10 1809+). Bitmap assets are vendored alongside a generation script. (`a59e2da`)
- Replaced the brittle three-store transcript merge with a stable `clientId` on every DisplaySessionEvent and a single pure `conversation-projector` — net −1134 lines, no more `applyTailIdAliases` walks, no more STREAM_FINISH_GRACE_MS race guard, and identical visible behavior with stable React identity end-to-end. The 1157-line AgentChatView was also split into focused components (AgentChatRoute, AgentChatPanel, StandaloneAgentChatPanel, ProjectAgentSwitcher) and hooks. (`0ee8e18`, `7799d95`, `45ea067`, `01f7de0`, `94063f8`, `7e2e6a3`)
- Agent and session switching is now flicker-free: hovering an agent or session row prefetches destination history into the chat-history-store, the previous panel stays mounted while the resolver is pending, and the sessions sidekick uses the ZUI Explorer's new controlled-selection mode so rows no longer remount on every click. (`6b67e64`, `7fcdb90`, `ab0b9f5`, `15ec2b6`, `54017ef`, `f043c71`)
- Chat image attachments are more forgiving: per-file 5 MB and total 10 MB caps that silently rejected uploads are gone, the server now persists `source_url` alongside base64 so images survive history reload, thumbnails no longer disappear after upload, and S3 + IAM bootstrap scripts ship for the production assets bucket. (`f6903cd`, `b9a8fda`, `7f5f0af`, `031d8fb`)
- Optimistic placeholder rows no longer leak into routing or get clobbered by stale loads: cached titles re-attach to materialized rows, optimistic ids are kept out of `?session=` and history fetches, and the sessions list visually distinguishes selected from hovered so the per-day Explorer no longer looks like it's multi-selecting across date buckets. (`b8ed3df`, `30ccaa3`, `c74a9b0`, `7f35aa0`, `49c3b63`)
- Plain `cargo run -p aura-os-desktop` is once again a Dev build (separate window title, data dir, ports, single-instance mutex) so developers can run debug alongside an installed stable AURA — released installers remain safe because every release path passes `--features stable-channel` explicitly. A read of partitioned harness memories also lands so MemoryTab returns the right data. (`43ff6e6`, `3f685dd`)

## 10:06 PM — S3 deploy scripts hardened for missing creds and Windows shells

The new S3 setup tooling now fails loudly on misconfiguration and works correctly under Git Bash on Windows.

- S3 setup and IAM-user scripts verify AWS credentials up front, parse `create-access-key` output with sed (dropping the python3 dependency that broke under Git Bash on Windows), and only swallow the benign "bucket already owned" error so real misconfiguration surfaces instead of silently continuing. (`94432a1`)

## 10:10 PM — Sidekick highlights the new chat row the instant "+" is pressed

A small but meaningful follow-up so users get immediate visual confirmation when starting a new chat.

- Inserted the optimistic session placeholder when "+" is pressed (rather than at first send) so SessionsList's optimistic-fallback branch can immediately highlight the new-chat row; arm() is idempotent so double-clicking "+" doesn't stack rows. (`e827bc9`)

## 10:43 PM — Windows installer template fixes so the themed NSIS wizard actually builds and runs its hooks

Three follow-up fixes to the new themed NSIS template — required for the installer to compile under cargo-packager's Handlebars renderer and for the dark-mode hooks to actually fire.

- Escaped literal `{{...}}` examples in NSI comments so cargo-packager's Handlebars renderer no longer chokes on Tera-style pipe syntax, and surrounding doc references to `{{header_image}}` / `{{sidebar_image}}` no longer get silently substituted with bitmap paths. (`be5fe36`)
- Replaced the bare `.onGUIInit` function with `MUI_CUSTOMFUNCTION_GUIINIT` registering `AuraOnGUIInit`, so it no longer collides with MUI2's auto-generated `.onGUIInit` and aborts makensis with "Function already exists". (`163ca01`)
- Switched the welcome/finish page show callback to the real `MUI_PAGE_CUSTOMFUNCTION_SHOW` hook (re-defined before each page since MUI `!undef`s it after consumption), so the runtime sidebar bitmap swap and dark-mode title-bar attribute on the inner dialog actually run. (`63b3bda`)

## Highlights

- Rebuilt new-chat lane with optimistic sidekick rows and ChatGPT-style auto-titles
- macOS updater preflights translocated bundles and offers one-click relocate
- Stable clientId projector kills the assistant-bubble flicker on send
- Windows NSIS installer now matches system light/dark theme
- Release channel default flipped so dev builds can't silently ship to users


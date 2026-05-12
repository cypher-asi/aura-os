# AURA Video debuts, Windows startup self-heals, and the desktop shell gets a chrome refresh

- Date: `2026-05-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.504.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.504.1

A dense nightly: a brand-new AURA Video generation app lands end-to-end, the Windows desktop client learns to recover from corrupt settings instead of vanishing, and the desktop shell, taskbar, and chat input bar get a coordinated polish pass. Release infrastructure also got tougher against Apple notary blips and dropped GitHub asset uploads.

## 2:24 AM — Invite friends modal and per-panel border tokens

An invite-a-friend entry point lands in the taskbar and the desktop lanes gain their own borderable surfaces.

- Added a pulsing Invite button to the bottom-left taskbar that opens a new modal showing the user's invite code (click to copy) and referral bonus details. (`11dcaf4`)
- Wrapped the sidebar, main panel, and sidekick lanes in a 1px border so they read as discrete surfaces, and introduced separate `--color-border-main-panel` and `--color-border-chrome` tokens exposed in Settings → Appearance → Custom colors for independent tinting. (`3540be2`)

## 9:52 AM — Release pipeline reconciles dropped GitHub asset uploads

A new retry-and-verify step makes transient upload failures recoverable instead of fatal across every release channel.

- Added `upload-release-assets-with-retry.sh`, wired in after every `softprops/action-gh-release` step on nightly, stable, and mobile-nightly workflows. It diffs local artifacts against the published release and re-uploads only the missing or wrong-sized files via `gh release upload --clobber`, so a single dropped stream from GitHub's upload API no longer reds a 40-minute job. (`d08885c`)

## 10:41 AM — Rounded lanes, unified sidekick width, and onboarding-only prompt chips

Three focused shell changes simplify the desktop layout and trim noise from the chat empty state.

- Replaced the inset divider between the main panel and the sidekick with explicit rounded corners on the sidebar, sidekick lane, and main panel host, with the rounding conditional on sidekick visibility. (`7d60929`)
- Unified the sidekick lane to a single shared width across every app, persisted under one `aura-sidekick-width` key and migrated from the legacy shared / projects / per-app entries so existing users keep their preferred size. (`efe1f31`)
- Restricted the empty-thread prompt suggestion chips to onboarding only — they now disappear permanently the moment a user sends their first message. (`d08ec6b`)

## 11:26 AM — AURA Video app, silent-launch Windows fix, and a taskbar refresh

The day's biggest batch ships a new video generation app, rescues Windows users hit by a corrupt settings file, restores agent memory, and cycles the Earn Credits / theme toggle / Invite button placement across the chrome.

- Diagnosed and fixed the silent-launch failure on upgraded Windows installs: the settings store now renames a corrupt `settings.json` aside and continues with an empty store, persists writes through `sync_all` to prevent torn renames after a crash, propagates server-thread failures instead of `.expect`-panicking, and shows a native 'AURA could not start' MessageBox pointing at the crash log and recovery file. (`6591e07`)
- Introduced AURA Video as a full standalone app: a video generation proxy at `/api/generate/video/stream`, a Zustand store with artifact persistence, three Veo models (Fast, Standard, Lite), and a complete shell with main panel, left nav project tree, sidekick thumbnail gallery, and sidekick taskbar tab. (`b56deec`, `d740587`, `f82551b`, `2775e2f`)
- Restored agent long-term memory reads by reverting the partition-key routing back to the bare agent id the harness actually expects, with strongly-typed `Path<AgentId>` extractors so malformed callers fail at the proxy edge. (`a7c70aa`)
- Iterated heavily on chrome placement: restyled the Earn Credits button as an accent pill, moved it to the titlebar, reverted it back to the taskbar, floated it at the bottom of the left sidebar, and finally landed it as a compact 'EARN' pill in the titlebar next to the sidekick toggle; the theme toggle moved from the titlebar into the bottom taskbar, and the right cluster now collapses to a profile-only state by default. (`df125f6`, `a214178`, `3c50616`, `e0f5791`, `aa45bee`, `0338e1d`, `c44941d`, `608603c`)
- Tightened sidebar and selector visuals: inset-pill row highlights with a unified selected color, a chrome-pill PanelSearch with a softer 30%-of-chrome border, fully-tinted accent fills for the active ModeSelector pill (with contrast-aware label color), and equal-width mode segments to eliminate sub-pixel border jitter during the slide animation. (`3ff6733`, `e064f2c`, `f6646fe`, `e34befd`, `6d00de8`, `c039c02`, `e20c9a1`, `815715f`, `677c33f`, `7164b3f`, `3466862`)

## 2:50 PM — macOS packaging retries through Apple notary outages

The macOS release job now treats transient Apple notary errors as flakes instead of build failures.

- Extended the `should_retry_packaging` matcher to recognize `xcrun notarytool` HTTP 429 and 5xx responses in packager.log, so brief Apple notary outages no longer abort the entire macOS packaging job alongside existing hdiutil 'Resource busy' retries. (`d9aaba8`)

## 2:59 PM — Standalone-agent chat pins to Home and the input bar gets icon-hover plates

Standalone agent chats now consistently target a 'Home' project on the wire while keeping the picker simple, and shared icon buttons adopt a tighter rounded hover plate.

- Standalone Agents-app chats now always show a single non-interactive 'Home' label in the project picker — auto-created Home bindings are used directly, legacy agents get a synthesized 'Home' entry pointing at their existing binding, and a new `llmProjectId` prop decouples the wire `project_id` from the picker so fresh canvases ship Home while existing sessions ship their session-of-record's original project. (`5018182`, `758c18f`, `1d75419`)
- Introduced a shared inner-plate hover style for icon buttons driven by new `--icon-hover-inset`, `--icon-hover-radius`, and `--icon-hover-bg` tokens, applied across taskbar icons, the browser address bar, folder picker, onboarding checklist, and the chat input's `+` / send buttons; also added `interface/docs/icon-system.md` as the source-of-truth for icon usage. (`ed75519`, `60fdc4a`, `5d07c04`)
- Tuned taskbar icon centering and sizing — locking `line-height: 0` and `svg { display: block }` to fix sub-pixel off-center hover halos, then settling the lucide glyph at 16px inside a 30×30 hit target after a brief 19→15→16 iteration. (`a102b47`, `abfd57e`, `de29952`)
- Polished the chat input bar: dropped the slash hint button in favor of a `/ for commands, @ for context` Code-mode placeholder, aligned the mode pill with the attach button, extended the mode-bar divider to the right edge, and inset the send/new-chat buttons by 2px to match attach for symmetric corners. Sidebar, project tree, sidekick, and sessions list rows also gained a 1px gap so adjacent highlights no longer touch. (`053f04c`, `43ba1eb`, `64ba005`, `f68b5c6`, `249f6f6`, `b3d6b61`)

## Highlights

- New AURA Video generation app with left nav, sidekick gallery, and Veo models
- Windows installer no longer dies silently on a corrupt settings file
- Release pipeline reconciles dropped GitHub uploads and retries Apple notary outages
- Unified sidekick width, rounded lane corners, and a refreshed icon-hover system


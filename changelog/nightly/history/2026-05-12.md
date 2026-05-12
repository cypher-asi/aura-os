# Invite flow, desktop shell polish, and a Windows startup rescue

- Date: `2026-05-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.501.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.501.1

A busy nightly: a new invite-a-friend entry point landed in the taskbar, the desktop shell got a coherent visual pass around panel borders, corners, and a single shared sidekick width, and the Windows app picked up a self-healing fix for the silent-launch failure some upgraders were hitting. Release infrastructure also got tougher against flaky GitHub asset uploads.

## 2:24 AM — Invite friends modal in the bottom taskbar

A pulsing invite button now lives in the bottom-left of the taskbar and opens a modal with the user's referral code and bonus details.

- Added an invite entry point in the bottom taskbar with a subtle pulse animation that opens a new modal showing a click-to-copy invite code and referral bonus details, wired through the existing invite code store and UI modal store. (`11dcaf4`)

## 9:17 AM — Tintable borders around the desktop lanes

The sidebar, main panel, and sidekick now read as distinct surfaces with their own border token, separate from the topbar and taskbar chrome.

- Added a 1px border around the three desktop lanes so they read as discrete surfaces like the taskbar pills, with lane borders automatically suppressed in desktop wallpaper mode. (`3540be2`)
- Introduced separate `--color-border-main-panel` and `--color-border-chrome` tokens and exposed them in Settings → Appearance → Custom colors so panel borders can be tinted independently from the topbar and bottom-taskbar pills. (`3540be2`)

## 9:52 AM — Release pipeline survives dropped GitHub asset uploads

Nightly, stable, and mobile-nightly release jobs no longer fail outright when GitHub's upload API drops a parallel asset stream mid-flight.

- Added a reconciliation script that diffs local artifacts against the published release and re-uploads only missing or wrong-sized assets with `gh release upload --clobber`, retrying on the known transient errors (`other side closed`, EPIPE, ECONNRESET) and failing only if a real gap remains. (`d08885c`)
- Wired the reconciler after every softprops/action-gh-release@v2 step across the nightly, nightly alias, stable, and mobile-nightly workflows with continue-on-error, so a flaky upload no longer wastes a 40+ minute release run. (`d08885c`)

## 10:41 AM — Rounded panels, one sidekick width, and onboarding-only prompt chips

The desktop shell swapped its inset sidekick divider for rounded panel corners, collapsed per-app sidekick widths down to a single shared value, and stopped showing prompt suggestions to returning users.

- Replaced the inset shadow that separated the main panel from the sidekick with explicit rounded corners on the sidebar, sidekick lane, and (when the sidekick is collapsed) the main panel host, driven by a new visibility-aware modifier. (`7d60929`)
- Unified the sidekick lane to a single shared width across every app, persisted under one `aura-sidekick-width` key and migrated from the legacy shared, projects, and per-app entries so existing users keep their preferred size. (`efe1f31`)
- Prompt suggestion chips on empty chats are now gated on the onboarding `send_message` task, so they disappear the moment a user sends their first message ever and don't reappear in later empty threads. (`d08ec6b`)

## 11:26 AM — Windows startup recovers from a corrupt settings file

The Desktop app no longer vanishes silently when `settings.json` has been torn-written to NUL bytes, and it now shows a clear failure dialog instead of exiting without any UI.

- The settings store now self-heals on load: a corrupt `settings.json` is renamed aside to `settings.json.corrupt-<ts>`, a warning is logged, and the app continues with an empty store instead of panicking on `serde_json::from_str`. (`6591e07`)
- Hardened persistence by writing through `OpenOptions` + `write_all` + `sync_all` before the atomic rename, closing the torn-write window on NTFS that previously left the file at the right length but full of NUL bytes after a crash or power loss. (`6591e07`)
- Fatal startup failures on Windows now surface a native `AURA could not start` message box (with macOS/Linux falling back to stderr) that names the data directory, the crash log path, and the settings file users can rename to recover, instead of the previous invisible exit under `windows_subsystem = "windows"`. (`6591e07`)
- Replaced `.expect` calls in the embedded server's ready channel with a `Result`-carrying signal so the main thread can react to startup errors (and `RecvError`) by showing the new dialog and exiting cleanly. (`6591e07`)

## Highlights

- Invite friends modal in the bottom taskbar
- Unified sidekick width across every app
- Self-healing recovery for corrupt Windows settings
- Release pipeline no longer fails on dropped asset uploads


# Invite friends shortcut, themable lane borders, and a self-healing release pipeline

- Date: `2026-05-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.500.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.500.1

Today's nightly brings a new invite-a-friend entry point into the desktop taskbar, a round of structural polish to how the three desktop lanes are framed, and a meaningful reliability upgrade to the GitHub release pipeline so a single dropped asset upload no longer torpedoes an entire 40-minute build.

## 2:24 AM — Invite friends button arrives in the bottom taskbar

A pulsing invite entry point now lives in the bottom-left of the desktop, opening a modal with the user's referral code and bonus details.

- Added a gift-icon invite button to the bottom taskbar's left group that gently pulses to draw attention and opens a new Invite modal showing the user's referral code (click to copy) and bonus details, wired through the existing invite-code store and a new modal slot on the UI modal store. (`11dcaf4`)

## 9:17 AM — Independent border tokens for desktop lanes vs. chrome pills

The sidebar, main panel, and sidekick lanes now read as discrete surfaces, with new theme tokens letting users tint lane borders separately from the topbar and taskbar pills.

- Drew a 1px border around the sidebar, main panel host, and sidekick lane so the three desktop lanes feel like distinct surfaces alongside the existing taskbar pills, while suppressing those borders in desktop wallpaper mode so the background stays clean. (`3540be2`)
- Introduced --color-border-main-panel and --color-border-chrome tokens (both defaulting to --color-border) and exposed them in Settings → Appearance → Custom colors as "Main panel border" and "Topbar / taskbar border", so lane framing can be tinted independently from chrome. (`3540be2`)

## 9:52 AM — Self-healing GitHub release uploads stop killing the pipeline

A new reconciler re-uploads only the assets that GitHub dropped mid-stream, so transient EPIPE/ECONNRESET failures no longer fail an otherwise successful 40+ minute release job.

- Added infra/scripts/release/upload-release-assets-with-retry.sh, which diffs locally built artifacts against the published release and re-uploads only missing or wrong-sized files via `gh release upload --clobber`, retrying on the known transient "other side closed" / EPIPE / ECONNRESET patterns from softprops/action-gh-release@v2. (`d08885c`)
- Wired the reconciler into the immutable nightly, nightly alias, stable, and mobile-nightly release workflows with continue-on-error on the softprops step, making asset verification the authoritative gate rather than the initial parallel upload. (`d08885c`)

## 10:41 AM — Rounded lane corners replace the inset sidekick divider

The desktop shell drops its inset shadow divider in favor of explicit rounded corners that adapt to whether the sidekick is open.

- Removed the `inset -1px 0 0 0` box-shadow that the main panel host used as a divider against the sidekick, and instead rounded the outer corners of the sidebar (left) and sidekick lane (right) for a cleaner panel silhouette. (`7d60929`)
- Added a `mainPanelHostNoSidekick` modifier, composed via `cn` from @cypher-asi/zui, so the main panel's right edge rounds off only when the sidekick is collapsed — with a DesktopShell test asserting the modifier is absent whenever the sidekick is mounted. (`7d60929`)

## Highlights

- New invite friends button and modal in the bottom taskbar
- Desktop lanes now have their own borders with dedicated theme tokens
- Rounded panel corners replace the inset sidekick divider
- Release pipeline auto-reconciles dropped GitHub asset uploads


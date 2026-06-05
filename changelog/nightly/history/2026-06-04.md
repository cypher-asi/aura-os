# Agent cards, a public blog, and a sidebar that stays put

- Date: `2026-06-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.613.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.613.1

A heavy interface day: the agent profile got a hybrid 3D nameplate + glass spec card, Notes was rebuilt onto a storage-backed ID model that also powers a brand-new public /blog site, and the sidebar gained an Agents/Projects rocker plus a persistent chat surface so switching apps no longer remounts your conversation. Settings grew real theme sub-areas, and several reliability fixes landed for remote agents, geo analytics, and production CSS.

## 7:56 PM — Council mechanism picker and a redesigned agent profile card

The council UI got a clearer mechanism picker that persists across reloads, and the agent profile was split into a slim 3D nameplate plus a separate spec card.

- Replaced the finicky hover flyout on the council count with an always-visible Synthesize / Contrast / Side-by-side menu row, and persisted the chosen mechanism on the parent tool_use block so a reloaded turn shows the correct label on the council panel header. (`1bb3c66`, `7df535d`, `ed30264`)
- Split the agent profile into a shortened WebGL worn-metal nameplate (name, role, engraved status on the frame) and a new DOM ProfileSpecCard carrying Organization, IP, Wallet, channel logos, and Skills/Connectors/Permissions links, with a black-glass treatment and trimmed nameplate sizing. (`ffbd03c`, `913047d`, `aa3e2d4`)
- Remote-agent status card now offers a Recovery action when the VM state fetch fails recoverably (e.g. 404 'machine gone'), instead of stranding the user with only a Report bug button; 401 session-expired still surfaces report-only. (`d3cddc6`)

## 10:36 AM — Frosted glass panels restored in production desktop builds

Pinned the Vite CSS minifier so backdrop-filter and color-mix declarations survive into release bundles.

- Vite 8's default Lightning CSS minifier was stripping the glass panel recipe (backdrop-filter / color-mix) from production CSS, so release desktop builds lost their frosted blur. Pinned cssMinify to esbuild so prod renders the same glass as the dev server. (`e9ff281`)

## 10:38 AM — In-app Changelog/Downloads modals, LOCAL agent badge, and tunable glass

Help menu entries now stay inside the app, local agents are visually distinct on the 3D card, and glass blur/opacity became user-tunable.

- Help → Changelog and Help → Downloads now open inside zui modals (with a 20% wider layout) rather than navigating away, keeping users in the app shell when logged in. (`ca46b05`, `e1c050b`)
- Local agents now render a purple LOCAL badge on the 3D card frame while remote agents keep their live green/red VM status, and the channel bar picks up the LLM input pill gradient. (`8cf913a`)
- Added a tunable glass blur/opacity level exposed through Appearance settings, with a panel glass bridge wiring the new variables into existing surfaces. (`3dc16ec`)
- Mixpanel client init now opts into IP geolocation so events like user_signed_up can be broken down by country, region, and city; DNT/GPC opt-out behavior is unchanged. (`3b7c7ec`)

## 11:26 AM — Typed notes/folders/comments client in aura-os-storage

Added a typed Rust client surface for the storage service's notes entity, unblocking the storage-backed notes rewrite.

- Mirrored the aura-storage notes entity with StorageNote, StorageNoteFolder, and StorageNoteComment models, request types, and a StorageClient method set covering both public and internal note routes, plus in-memory mock coverage for integration tests. (`db40702`)

## 11:30 AM — Storage-backed Notes, aura-blog CMS, and a public /blog site

Notes moved off the filesystem onto a storage-backed ID model with markdown bodies on S3, and that same backend powers a new public blog with a sidebar rocker to flip between Agents and Projects.

- Replaced the filesystem notes layer end-to-end: the server now serves storage-backed, ID-based notes with markdown bodies on S3, the frontend store/UI was rewritten off relPath onto stable UUIDs with autosave via uploadMarkdown, and a sys-admin importer ports legacy filesystem notes over. (`73e86a8`, `4e69b98`, `56187a9`, `ff7640a`)
- Added an aura-blog CMS surface inside Notes (sys-admin gated blog fields, publish, status badges) plus a new public /blog index and /blog/:slug post page styled after cursor.com/blog, fed by anonymous /api/public/blog endpoints and S3 markdown bodies, with a Blog entry in the public top nav and mobile drawer. (`f1849e1`, `09b1f3f`)
- Introduced a neumorphic Agents/Projects rocker switch at the top of the shared sidebar, iterated through several physical models (rigid plate → center-folding rocker → flat plate-mounted toggle), and tuned the shared bright-to-dark border gradient and motion so the selected side reads as raised and the click feels instant. (`7f6a788`, `6f4cf35`, `6c4d5f4`, `2b28b7b`, `9ba2a15`, `ed54694`, `39fee1d`, `1bbc91e`)

## 12:29 PM — Persistent chat surface, Theme drill-down, and remote-agent recovery

A long afternoon of polish around the new sidebar rocker landed a shell-level conversation host, a real Theme settings section, performance work on the agent list, and reliability fixes for stalled remote-agent turns and geo analytics.

- Mounted a shell-level ConversationSurfaceHost keyed by projectId + agentInstanceId so the agent chat survives every Agents ⇄ Projects switch with no remount or refetch, and made AppSwitchToggle resolve the equivalent lane in the target app so the toggle lands on the same mounted chat. (`e2db6de`)
- Made app-switching feel instant: keep both panes mounted via memoized keep-alive wrappers, virtualize the agents list with an O(1) busy index, centralize per-row store reads behind useAgentRowModels so rows are pure props, lazy-load avatars after first paint, and hydrate the agent IndexedDB cache on warm loads so the sidebar paints before the network responds. (`bfb191b`, `ca6e92a`, `dd3e812`, `8ae8c91`, `8399a4f`)
- Rebuilt the sidebar list reveal animation: rows now own their own cascade-in via a useSidebarListReveal hook (Web Animations API, reduced-motion aware) and AgentList rides on the shared LeftMenuTree, so the entrance animation fires reliably on first load and on every Agents ⇄ Projects switch even with virtualization and async hydration. (`1ea05f2`, `c40d4aa`, `92acd4f`, `7e7e2a1`)
- Expanded desktop Settings with a generic drill-down: clicking Theme swaps the left nav for a breadcrumb and sub-areas (Mode & accent with custom hex, Typography, Layout & density, Custom colors, Effects, Motion, Presets), backed by persisted CSS-variable controls pre-stamped in index.html to avoid flash. Desktop right-click now has Theme and Background entries that deep-link straight into the relevant sub-area. (`d82ab04`, `2fd8558`, `812fac6`, `afd46c4`)
- Polished the agent spec card: theme-aware smoked-black glass that flips with light/dark mode, taskbar-matched 90% glass for both the spec and Telegram panels, one-click copy on IP/Wallet rows with a zscan.live wallet link, a centered nameplate in the metal strip, and an 'Org' label trim. (`28d1658`, `cb9bf60`, `10ef33c`, `d8fa793`, `e44448f`, `e2685cc`)
- Reworked the floating chat input: removed the painted backdrop band and instead hard-clip the transcript at the input pill's live-measured midline, align the input to the 680px transcript column, and make the mode selector opaque so chat content no longer bleeds through. (`14b0e5b`, `2755738`)
- Restyled the public marketing surface: Changelog/Feedback/Models banners picked up frosted pricing-style glass, the /blog single-post and index pages were reworked after cursor.com/blog with a featured post, 2-up grid, archive table, drop cap, and real author avatar via an updated aura-blog seed action; Vibecoder persona gained a WebGL flow-field background that drifts under reduced motion. (`ca2a99a`, `0baa2ae`, `c74ecd9`, `f1a2f30`, `cdd0a67`, `b861cf4`, `066337e`)
- Fixed stalled remote/CEO chat turns: the server now evicts warm chat sessions tied to a recycled VM after recover/restart/start/wake/hibernate, and the standalone-agent chat hook forwards the full error payload so stream_stalled and turn_timeout classify as recoverable and auto-retry instead of surfacing a hard 'Chat stream interrupted' bubble. (`a314d2e`)
- Made server-emitted session_active forward the caller's X-Forwarded-For / X-Real-IP to Mixpanel so the authoritative True DAU events geolocate to the user rather than the server; loopback/missing IPs are dropped so no misleading geo is emitted. (`1bc8486`)
- Fixed several sidebar layout issues that surfaced with the rocker: list rows now scroll cleanly under the floating Refer member pill across Agents/Projects/Tasks/Process/Debug/Notes, sidebar items can no longer be text-selected, and the switch plate sits vertically centered between the search pill and the first agent row. (`9757f13`, `0eb072a`, `e7290fb`)
- Hardened the model picker: unified two type styles across the menu, normalized header padding, and extracted a shared useFlyoutAnchor hook so the effort/council hover flyouts recompute position on scroll/resize and stay anchored to their row instead of floating away after layout shifts on Edge. (`0e2a18c`)

## Highlights

- New ProfileSpecCard + 3D nameplate for agents
- Public /blog site backed by storage-backed Notes
- Agents ⇄ Projects rocker with a persistent chat surface
- Settings → Theme drill-down with typography, layout, and motion
- Stalled remote agent turns now auto-recover


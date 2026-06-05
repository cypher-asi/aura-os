# Council mechanics, a public blog, and a smoother Agents↔Projects switch

- Date: `2026-06-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.614.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.614.1

A big nightly: the council picker and panel grew real mechanism awareness, the agent profile card was split into a 3D nameplate plus a glass spec card, Notes moved to a storage-backed ID model that now powers a brand-new public blog at /blog, and the sidebar gained an Agents/Projects rocker switch that triggered a long performance and animation thread to make it feel instant. Settings also picked up a drill-down Theme section with typography, density, motion, and wallpaper.

## 7:56 PM — Council mechanism picker and agent profile card overhaul

The council combine mechanism became a first-class, persisted concept, and the agent profile card was split into a 3D metal nameplate plus a separate DOM spec card.

- Replaced the fiddly hover flyout for Synthesize/Contrast/Side-by-side with an always-visible CouncilMechanismRow under the count, and surfaced the active mechanism as a chip on the council panel header with an accurate subtitle for each mode. (`1bb3c66`, `ed30264`)
- Persisted the council mechanism on the parent tool_use block and SubagentSpawned event so a reloaded council turn rehydrates with the correct mechanism label instead of falling back to a guess. (`7df535d`)
- Split the agent profile card: the WebGL worn-metal plate now carries only name, role, and an engraved status indicator, while Organization, IP, Wallet, channel logos, and nav links moved into a new DOM ProfileSpecCard with a black-glass look. (`ffbd03c`, `913047d`, `aa3e2d4`)
- Remote agent status cards now offer a Recovery action when the machine state fetch fails recoverably (e.g. 404 'machine gone'), instead of leaving Report bug as the only option; auth-expired errors still gate to Report bug. (`d3cddc6`)

## 10:36 AM — Frosted glass restored in production desktop builds

Pinned the Vite CSS minifier so backdrop-filter and color-mix survive into release builds.

- Vite 8's new Lightning CSS minifier was stripping backdrop-filter and color-mix from production bundles, so desktop release builds lost the glass-panel blur that the dev server rendered correctly. Pinned cssMinify to esbuild so prod CSS matches dev. (`e9ff281`)

## 10:38 AM — Help-menu modals, geolocation analytics, and tunable glass

Help shortcuts opened in-app, Mixpanel learned where signups come from, and the glass effect became user-adjustable.

- Help > Changelog and Help > Downloads now open inside zui modals (widened ~20%) when signed in, keeping users in the app shell instead of navigating away. Logged-out Downloads still opens aura.ai/download in a new tab. (`ca46b05`, `e1c050b`)
- Enabled Mixpanel IP-based geolocation so events like user_signed_up can be broken down by country, region, and city; opt-out / DNT / GPC handling is unchanged. (`3b7c7ec`)
- Added a tunable glass blur/opacity level wired through PanelGlassBridge and a new control in Appearance settings, so users can dial the frosted-panel intensity. (`3dc16ec`)
- Local agents now show a purple LOCAL badge on the 3D card frame (while remote agents keep live green/red VM state), and the channel bar picked up the LLM input pill gradient. (`8cf913a`)

## 11:26 AM — Typed notes/folders/comments client in aura-os-storage

Laid the Rust groundwork for the storage-backed notes refactor that lands later in the day.

- Added typed StorageNote, StorageNoteFolder, and StorageNoteComment models plus a StorageClient method set covering public and internal note routes, with in-memory mock coverage so server handlers can be built against it. (`db40702`)

## 11:30 AM — Storage-backed notes, the public /blog site, and the Agents/Projects rocker

Notes moved off the filesystem onto an ID-based, S3-backed API; that backend powers a new public blog; and a neumorphic Agents/Projects toggle landed in the sidebar.

- Rewrote both the server notes handlers and the frontend notes layer onto storage-backed, ID-based models with markdown bodies stored on S3 (fetched from bodyUrl, re-uploaded via a new uploadMarkdown helper on autosave), dropping all relPath/title-rename logic. Blog posts are notes under a reserved AURA_BLOG_PROJECT_ID with sys-admin writes. (`4e69b98`, `56187a9`, `73e86a8`)
- Shipped a public, unauthenticated /blog index and /blog/:slug post page styled after cursor.com/blog — centered reading column, previous-posts rail, hero image, markdown TOC, and a 'more posts' section — backed by /api/public/blog endpoints, plus a Blog entry in the public top nav and mobile drawer. (`09b1f3f`)
- Added an aura-blog CMS surface in Notes (sys-admin gated) with blog fields, publish controls, and status badges, plus a sys-admin importer for legacy filesystem notes. (`f1849e1`, `ff7640a`)
- Added a theme-aware Agents/Projects rocker switch to the sidebar and iterated it from a tilting 3D plate into a flat plate-mounted toggle with a continuous diagonal border, optimistic flip, and deferred route swap so clicks feel snappy. (`7f6a788`, `c061993`, `2b28b7b`, `9ba2a15`, `ed54694`, `39fee1d`)

## 12:29 PM — Persistent chat across app switches, expanded Theme settings, and remote-agent stall recovery

A long thread made the Agents/Projects switch feel instant, Settings grew a drill-down Theme section, and stalled remote chats now auto-recover.

- Mounted a single conversation-target-keyed ConversationSurfaceHost above the per-app MainPanel so the agent chat survives every Agents↔Projects flip — switching apps onto the same lane keeps the identical AgentChatPanel mounted with no remount or refetch. AppSwitchToggle resolves the equivalent lane in the target app so the toggle lands on the same chat. (`e2db6de`)
- Made the Agents sidebar list keep-alive, virtualized, and pure: rows now consume a batched AgentRowModel from a single list-level hook instead of mounting ~9 store subscriptions each, avatars lazy-load after first paint, and panes are memoized so the switch frame is no longer blocked. Warm loads also paint agents from the IndexedDB cache before the network and any CEO setup. (`bfb191b`, `ca6e92a`, `dd3e812`, `8399a4f`, `8ae8c91`)
- Rebuilt the sidebar list reveal animation from first principles: row-level SidebarRevealRow with a useSidebarListReveal hook that respects reduced motion, survives virtualization and async hydration, and replays the cascade when a pane goes inactive→active. Agents and Projects now share the same LeftMenuTree shell. (`1ea05f2`, `c40d4aa`, `92acd4f`, `7e7e2a1`)
- Expanded the desktop Settings modal with a drill-down Theme section covering Mode & accent (with custom hex), Typography, Layout & density, Custom colors, Effects, Motion, Presets, and Background, with values pre-stamped at boot so customizations don't flash. The desktop right-click menu got Theme and Background deep-links, and the standalone wallpaper modal was retired. (`d82ab04`, `2fd8558`, `812fac6`, `afd46c4`)
- Fixed stalled CEO/remote agent chat turns end-to-end: the server now evicts cached chat_sessions for an agent on recover/stop/restart so the next turn gets a fresh harness WS, and the client classifies stream_stalled/turn_timeout as recoverable and auto-retries with reconnect+replay instead of bubbling 'Chat stream interrupted'. (`a314d2e`)
- Polished the chat surface and agent card: clipped the transcript at the floating input pill's midline (no painted backdrop band), added one-click copy + zscan link on the agent card's IP/Wallet rows, themed the spec and Telegram panels to match the taskbar glass, and centered the 3D nameplate in its metal strip. (`14b0e5b`, `e44448f`, `10ef33c`, `d8fa793`)
- Restyled the public /blog after cursor.com/blog with a featured post, 2-up recent grid, full archive table, and real author avatar; added a sys-admin 'Seed weekly blog posts' action in Notes; moved Blog into the Resources dropdown; and gave the Vibecoder persona an animated WebGL flow-field background that keeps drifting even under reduced motion. (`cdd0a67`, `b861cf4`, `066337e`, `0baa2ae`, `f1a2f30`)
- Tightened server-side analytics geo: session_active now forwards X-Forwarded-For / X-Real-IP to Mixpanel so True DAU events geolocate to the user instead of the server, and the public create-agent CTA is tagged with its entry-point source (public_chat / product_hero / public_landing). (`1bc8486`, `e6d54c9`)

## Highlights

- Council combine mechanism is now persistent, visible, and labeled on the panel
- Agent profile card split into a 3D nameplate and a frosted glass spec card
- New public /blog site backed by ID-based, S3-hosted notes
- Agents/Projects sidebar rocker with persistent chat across switches
- Expanded Theme settings with typography, density, motion, and wallpaper
- Recovery and auto-retry fixes for stalled remote agent chats


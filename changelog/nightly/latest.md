# Global command palette lands and hosted Preview finds its route

- Date: `2026-08-27`
- Channel: `nightly`
- Version: `0.1.0-nightly.808.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.808.1

Today's nightly pairs a headline interface addition with a targeted server fix: Aura gains a global command palette for jumping between chats, apps, projects, agents, and menu actions, and the Preview browser now correctly tunnels loopback dev servers through separately hosted local harnesses.

## 7:23 AM — Global Cmd/Ctrl+K command palette in the Aura shell

A first-class command palette lands in AuraShell, giving keyboard-driven access to recent chats, apps, projects, agents, and menu actions.

- New global command palette opens on Cmd/Ctrl+K and searches across cached chats, apps, projects, agents, and menu actions, with a `>` prefix to scope to actions only and keyboard navigation that skips disabled entries. (`3cdf448`)
- Palette is wired through Aura's existing MenuBar action handlers, UI modal store, and canonical routes rather than a parallel navigation system, so results reuse the app's real registries. (`3cdf448`)
- Ships alongside a new T3 code reference audit doc that frames the palette as the first P1 slice and outlines the follow-up work for server-backed message and file-content search. (`3cdf448`)

## 9:52 AM — Preview browser routes through hosted local harnesses

The remote Preview proxy learns a second tunnel target so loopback dev servers running inside a separately hosted local harness are reachable from the AURA-side Chromium.

- `spawn_browser` now starts a hosted-harness Preview proxy when a project is selected and the harness gateway exposes a hosted target, carrying the loopback URL from AURA OS through to the harness that actually owns the dev server. (`8529187`)
- Harness gateway gains a `hosted_preview_target` helper that only returns hosted base URLs with a configured transport bearer, and the API fails closed with a clear service-unavailable error when hosted Preview auth is missing. (`8529187`)
- Remote preview proxy is refactored around a `PreviewTunnelTarget` enum so swarm agents and hosted harnesses share one WebSocket tunneling path, while loopback harnesses correctly opt out since Chromium already shares their network namespace. (`8529187`)

## Highlights

- Global Cmd/Ctrl+K command palette across chats, apps, projects, agents, and actions
- Preview browser now tunnels to hosted local harnesses over an authenticated transport
- Ships on macOS (Intel + Apple Silicon), Windows, and Linux (deb + AppImage)


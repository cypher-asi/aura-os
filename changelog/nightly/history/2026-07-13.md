# Aura Web Search ships with platform-funded quotas and BYOK

- Date: `2026-07-13`
- Channel: `nightly`
- Version: `0.1.0-nightly.749.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.749.1

Today's nightly centers on a single, substantial feature: Aura Web Search is now available by default to every workspace, backed by Brave through Aura-funded credentials and gated by per-user tier quotas. Optional BYOK remains for orgs that want to bring their own Brave keys, and the plumbing to keep credentials server-side has been hardened end to end.

## 9:47 PM — Aura Web Search launches with tiered quotas and optional BYOK

Brave-powered web and news search is now available to every workspace by default, funded by Aura credentials and metered against z-billing tier quotas, with workspace-owned Brave keys still supported as an opt-in.

- Ships Brave-backed web and news search as a default capability, using platform-funded credentials so users no longer need to configure a Brave key to get started while org-owned keys continue to bypass Aura-funded quota. (`66b327d`)
- Enforces organization membership and per-user tier quotas sourced from z-billing, with a new tool-action rate limiter on the server to keep usage within plan boundaries. (`66b327d`)
- Locks credentials to the server side: the platform Brave key is scoped to aura-os-server (never exposed via VITE_* or desktop bundles), desktop requests are routed through aura-api via a new AURA_PLATFORM_TOOL_ACTION_BASE_URL, and billing calls are refused unless the endpoint is validated HTTPS. (`66b327d`)
- Wires the new platform tool-action base URL through desktop-validate, nightly, and stable release workflows so packaged Linux, macOS, and Windows builds ship pointed at the authenticated cloud endpoint. (`66b327d`)

## Highlights

- Brave-backed web and news search on by default
- Per-user tier quotas enforced via z-billing
- Optional workspace BYOK preserved
- Credentials stay server-side behind HTTPS-only billing


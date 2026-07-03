# Aura-managed Grok routing and a cheaper Grok Build tier

- Date: `2026-07-03`
- Channel: `nightly`
- Version: `0.1.0-nightly.725.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.725.1

Today's nightly centers on xAI's Grok lineup: chat sessions now flow through Aura-managed xAI credentials, and the Grok Build catalog entry was rebuilt around a cheaper pricing tier with broader model-id aliasing.

## 1:01 AM — Aura-managed xAI credentials for Grok sessions

Grok chats now use Aura-managed xAI credentials, plumbed end-to-end from the desktop runtime through the session protocol.

- Grok requests now flow through Aura-managed xAI credentials instead of user-attached workspace keys, with per-session provider API keys resolved by aura-os and forwarded only to the matching upstream provider. (`09a6673`)
- Extended the SessionModelOverrides protocol with a provider_api_keys map and threaded it through the harness, agent runtime, and project tool session config so credentials travel alongside model overrides. (`09a6673`)
- Fixed native auth on loopback dev origins so local desktop builds can complete the xAI credential handshake during development. (`09a6673`)

## 9:13 AM — Grok Build 0.1 relaunched as a cheaper xAI coding model

The Grok Build catalog entry was removed and reintroduced at a lower credit multiplier, with expanded aliasing so grok-code-fast IDs resolve to the same model.

- Relaunched Grok Build 0.1 in the Aura-managed catalog at a lower 0.48 credit multiplier (down from 0.45 on the previous entry that was removed earlier in the day), positioned as xAI's lower-cost coding-focused model with a 256K context window and no reasoning-effort controls. (`60405a4`, `10bb79a`)
- Broadened model-id normalization so grok-code-fast, grok-code-fast-1, and grok-code-fast-1-0825 all resolve to aura-grok-build-0-1 for both pricing and persisted model selection. (`10bb79a`)
- Refreshed Grok Build pricing to $1 input / $2 output per Mtok with a $0.20 cache-read rate across the interface pricing tables and benchmark script. (`10bb79a`)
- Updated the agent and chat stream hooks to handle the new Grok Build model in streaming sessions. (`10bb79a`)

## Highlights

- Grok now routes through Aura-managed xAI keys
- Grok Build 0.1 relaunched at a lower price
- grok-code-fast IDs alias to Grok Build


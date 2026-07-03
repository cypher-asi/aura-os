# Grok models, Fable 5 returns, and tighter Notion auth

- Date: `2026-07-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.723.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.723.1

Today's nightly expands Aura's model roster with xAI Grok and brings back Claude Fable 5, while backend work hardens Notion authorization and extends Remote MCP configuration on the server side.

## 2:17 AM — Notion provider rejects missing or invalid auth

Notion integration requests now require a valid bearer token, closing a gap where the mock provider accepted unauthenticated calls.

- Notion provider endpoints (search, pages, markdown, blocks, databases, data sources) now validate the Authorization header and return 401 when the bearer token is missing or wrong, backed by an expanded integration test suite. (`c5d2e62`)

## 2:52 AM — Claude Fable 5 returns as a selectable model

Fable 5 is back in the Anthropic chat lineup after a temporary removal, with persistence and picker behavior updated to match.

- Restored aura-claude-fable-5 as a featured Anthropic chat model with a 1M context window and 10x credit multiplier, and persisted selections now resolve to Fable 5 again instead of falling back to Sonnet 5. (`31b3f19`)
- Fable is wired as an adaptive-only model with no explicit thinking-effort tiers, so no picker effort is sent on the wire. (`31b3f19`)

## 4:35 PM — xAI Grok models and Remote MCP configuration

Aura adds xAI Grok models with pricing and introduces Remote MCP integration metadata plus a new streamable_http transport and per-server tool allowlists.

- Added xAI Grok models to the managed chat lineup with pricing entries and benchmark pricing coverage. (`8872828`)
- MCP server integrations now accept an optional allowedTools array (validated as a non-empty list of non-empty strings) so operators can scope which tools a Remote MCP server may expose. (`8872828`)
- MCP transport validation now recognizes streamable_http alongside stdio and http, with the error message updated accordingly. (`8872828`)
- Installed workspace integrations now surface real metadata via the integration catalog instead of an empty map, feeding richer info into Org Settings. (`8872828`)

## Highlights

- xAI Grok models and Remote MCP metadata added
- Claude Fable 5 restored as a selectable chat model
- Notion provider now enforces bearer token auth


# Sonnet 5 becomes the default, and Notion ships end to end

- Date: `2026-07-01`
- Channel: `nightly`
- Version: `0.1.0-nightly.720.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.720.1

Today's nightly promotes Anthropic's Sonnet 5 to Aura's default chat model, brings the Notion workspace integration to feature parity with a full tool suite, and quietly fixes a layout bug that was clipping the agent profile card on shorter windows.

## 1:38 AM — Claude Sonnet 5 lands and takes over as the default chat model

Sonnet 5 joins the model picker with 1M-token context and immediately becomes Aura's everyday default.

- Added Claude Sonnet 5 to the model catalog as a featured Sonnet-tier option with a 1M-token context window, ANTHROPIC_EFFORTS, credit multiplier 3, and $3/$15 pricing (plus cache rates) wired into both model-pricing.ts and the benchmark pricing script, alongside legacy alias mappings. (`7b0b131`)
- Promoted Sonnet 5 to DEFAULT_CHAT_MODEL_ID so new sessions and fallback paths (including unknown or unavailable model IDs) now resolve to aura-claude-sonnet-5, with the "default everyday model" description moving over from Sonnet 4.6. (`89c4e68`)

## 6:19 AM — Agent profile spec card stops clipping on short windows

A CSS fix keeps the Org / IP / Wallet card at full content height inside the sidekick scroll area.

- Added flex-shrink: 0 to the AgentInfoPanel spec card so it no longer collapses to a zero min-height inside its flex-column scroll parent — the card now stays at content height and the surrounding scroll area handles overflow, preventing rows from being clipped when the app window is short. (`9cf4770`)

## 11:20 AM — Cleanup of the spec-card fix rationale

Follow-up tidy that removes the inline explanation now that the fix has landed.

- Dropped the multi-line explanatory comment left behind by the AgentInfoPanel flex-shrink fix, keeping the CSS rule itself in place. (`9578162`)

## 9:59 PM — Notion workspace integration reaches full tool coverage

Agents can now search, read, write, and model data inside connected Notion workspaces via a complete set of provider tools.

- Expanded the Notion provider from a minimal search/create surface to a full workspace toolset: notion_fetch_page, notion_get_block_children, notion_append_block_children, notion_update_page, notion_update_page_markdown, notion_query_data_source, notion_create_database, and notion_create_data_source now dispatch alongside the existing search_pages and create_page handlers. (`b199974`)
- Wired the new tools into the org integrations catalog and workspace-tools installation flow, so saving a Notion integration for an org exposes all ten tools to agents with the correct Bearer auth, Notion-Version 2026-03-11 header, and workspace_integration requirement. (`b199974`)
- Backed the integration with new server-side coverage across the workspace tool catalog tests and the API integration_actions and provider mock suites to lock in tool registration, routing, and provider behavior. (`b199974`)

## Highlights

- Sonnet 5 is now the default chat model
- Full Notion workspace toolset now available to agents
- Agent profile card no longer clips on short windows


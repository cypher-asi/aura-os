# Sonnet 5 becomes the everyday default

- Date: `2026-07-01`
- Channel: `nightly`
- Version: `0.1.0-nightly.719.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.719.1

Today's nightly promotes Claude Sonnet 5 to Aura's default chat model and lands a small but visible fix to the agent profile card so it stops clipping in short windows.

## 1:38 AM — Claude Sonnet 5 lands and takes over as the default chat model

Sonnet 5 joins the model picker with a 1M-token context window and immediately replaces Sonnet 4.6 as Aura's default everyday chat model.

- Added Claude Sonnet 5 to the model catalog as a featured Anthropic option with a 1M-token context window, medium default effort, and Sonnet-tier pricing ($3 in / $15 out, plus cache rates), wired through both the picker and the benchmark pricing table. (`7b0b131`)
- Pointed DEFAULT_CHAT_MODEL_ID at aura-claude-sonnet-5 and moved the 'default everyday model' copy onto Sonnet 5, so new sessions and default-fallback paths now resolve to Sonnet 5 instead of Sonnet 4.6. (`89c4e68`)
- Registered legacy alias mappings for claude-sonnet-5 so existing persisted preferences and older identifiers route cleanly to the new aura-claude-sonnet-5 entry. (`7b0b131`)

## 6:19 AM — Agent profile spec card stops clipping in short windows

Fixed a layout bug where the Org/IP/Wallet spec card in the agent sidekick would get compressed and hide its own rows when the app window was short.

- Pinned the AgentInfoPanel spec card to its content height with flex-shrink: 0, so the surrounding scroll area handles overflow instead of the card collapsing and clipping its channel icons and nav links. (`9cf4770`)

## 11:20 AM — Cleanup of the spec-card fix

Follow-up polish on the earlier AgentInfoPanel fix, removing the inline explanatory comment now that the behavior is settled.

- Dropped the explanatory CSS comment left behind by the spec-card flex-shrink fix; behavior is unchanged. (`9578162`)

## Highlights

- Claude Sonnet 5 added and set as the default chat model
- 1M-token context now available out of the box
- Agent profile spec card no longer clips in short windows


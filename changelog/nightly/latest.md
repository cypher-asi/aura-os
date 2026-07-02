# Claude Fable 5 returns and Notion auth gets stricter

- Date: `2026-07-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.722.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.722.1

Today's nightly brings back Claude Fable 5 as a first-class chat model and tightens how the Notion integration validates provider credentials end to end.

## 2:17 AM — Notion provider rejects missing or invalid bearer tokens

The Notion integration runtime now enforces authorization on every request path, and the mock provider used in server tests validates the bearer token instead of blindly returning fixtures.

- Notion endpoints in the provider mock (search, pages, markdown, blocks, data sources, databases) now inspect the Authorization header and return 401 with a clear "missing or invalid Notion authorization" error when the bearer token is absent or wrong, closing a gap where unauthenticated calls silently succeeded. (`c5d2e62`)
- Provider runtime was updated alongside the mock to exercise the hardened auth path, raising confidence that real Notion credentials are validated consistently across integration surfaces. (`c5d2e62`)

## 2:52 AM — Claude Fable 5 is selectable again in chat

Fable 5 has been re-added to the Aura-managed Anthropic lineup, with persisted selections restored and picker behavior updated to match its adaptive thinking model.

- Fable 5 is back in the chat model list as a featured Anthropic option with a 1M context window and a 10× credit multiplier, and previously persisted Fable 5 selections now load correctly instead of falling back to Sonnet 5. (`31b3f19`)
- Because Fable uses adaptive thinking, the model intentionally omits explicit effort tiers so no picker-level thinking budget is sent on the wire — keeping the UI honest about what the model actually supports. (`31b3f19`)

## Highlights

- Claude Fable 5 available again in the model picker
- Notion provider now rejects unauthorized calls
- Nightly artifacts shipped for macOS, Windows, and Linux


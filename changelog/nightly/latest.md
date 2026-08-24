# Quick Prompts, conversation branching, and hosted Preview land together

- Date: `2026-08-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.804.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.804.1

A feature-heavy nightly: a new Quick Prompt palette and voice dictation reshape the chat composer, conversations can now branch from any assistant reply, and Preview gains a production-grade hosted Chromium runtime with a remote-localhost tunnel for agent dev servers.

## 4:00 AM — Quick Prompts, voice dictation, and conversation branching debut

Three sizable chat features shipped back-to-back: a global Quick Prompt palette, in-composer voice dictation, and the ability to fork a conversation from any assistant reply.

- Introduced a Quick Prompt palette wired into the Aura shell and menu bar, letting users draft a prompt in a modal and hand it off to a chosen agent's chat composer via a new quick-prompt store. (`da686ae`)
- Added voice dictation to the chat composer with a dedicated control, a reusable useVoiceDictation hook, and layout support in both desktop and mobile input bars. (`914e247`)
- Enabled branching a conversation from any assistant reply: a new server-side branch_session endpoint copies events through the selected turn into a fresh active session, exposed via a Branch action in the message row. (`e01a708`)

## 8:03 AM — Hosted Chromium runtime and Quick Prompt / branching follow-ups

Preview gained a reproducible hosted Chromium runtime with a CI-verified container, while same-day fixes stabilized the freshly shipped Quick Prompt and branching flows.

- Shipped a production Dockerfile, .dockerignore, and an AURA API container workflow that builds the image, boots Chromium via CDP, and verifies the API becomes healthy as an unprivileged user — making hosted Preview deployable on Render and similar targets. (`4697c95`)
- Completed conversation branch navigation by routing through React Router instead of manual history events, re-enabling the branch action after completion, and surfacing an inline error when the branch request fails. (`d73f75c`)
- Fixed Quick Prompt handoffs so they stay in the active Chat app lane (preserving project/instance/session) instead of stranding users on the standalone Agents surface, and preserved the route's agent selection during cold start while the agent roster is still hydrating. (`e142ab8`, `4c3113c`)

## 9:37 PM — Remote agent localhost tunneled into hosted Preview

Preview can now reach a dev server running inside a selected remote agent by routing Chromium's loopback traffic through an authenticated per-browser SOCKS5 proxy to the swarm gateway.

- Added a remote_agent_id option on browser spawn that starts a per-session SOCKS5 proxy (remote_preview.rs) bridging Chromium to the agent's harness over the swarm's WebSocket gateway, while public destinations continue to connect directly from AURA OS. (`6e63ec1`)
- Disabled Chromium's implicit localhost proxy bypass for these sessions so loopback URLs are carried through the authenticated tunnel to the selected agent, with cleanup tokens tying proxy lifetime to the browser instance. (`6e63ec1`)
- Threaded the remote-agent selection through the BrowserPanel, BrowserInstance, Sidekick content, and the browser API/hook layer so the UI can target a specific agent's Preview from the client. (`6e63ec1`)

## Highlights

- Quick Prompt palette across the shell
- Voice dictation in the chat composer
- Branch conversations from any reply
- Hosted Chromium runtime for Preview
- Remote agent localhost tunneled into Preview


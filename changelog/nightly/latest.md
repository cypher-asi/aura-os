# Quick prompts, voice dictation, and conversation branching land in chat

- Date: `2026-08-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.802.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.802.1

A feature-heavy day for the chat surface: a global Quick Prompt palette, in-composer voice dictation, and the ability to branch a conversation from any assistant reply. An afternoon follow-up hardened those flows and shipped a containerized Chromium runtime so hosted browser previews finally have a reliable deployment target.

## 4:00 AM — Quick prompts, voice dictation, and conversation branching

Three new chat capabilities shipped back-to-back: a global Quick Prompt palette, an in-composer voice dictation control, and a server-backed action to fork any assistant reply into a new session.

- Introduced a Quick Prompt palette wired into the Aura shell and menu bar, backed by a new quick-prompt store that stages a pending prompt per agent and hands it off into the active chat draft. (`da686ae`)
- Added a voice dictation control to the chat composer with a dedicated action slot in InputBarShell, a useVoiceDictation hook, and matching layout on the mobile chat input bar. (`914e247`)
- Shipped conversation branching: a new server endpoint copies events through a selected assistant reply into a fresh active session, and a Branch action in the chat message toolbar lets users continue any reply down a new path without altering the original. (`e01a708`)

## 8:03 AM — Hosted Chromium runtime and chat follow-up fixes

An afternoon of hardening: a container image and CI smoke test give browser previews a reliable hosted Chromium runtime, while two chat regressions from the morning's Quick Prompt and branching work were resolved.

- Packaged the API server with a hosted Chromium runtime via a new Dockerfile, .dockerignore, and an aura-api-container GitHub Actions workflow that builds the image, boots it, and verifies CDP startup and API health as an unprivileged user; documented the flow in the Render deployment guide. (`4697c95`)
- Completed conversation branch navigation by routing through React Router instead of a manual history push, re-enabling the branch button after failures, and surfacing an inline "Couldn't branch this conversation" error when the request fails. (`d73f75c`)
- Fixed Quick Prompt handoff so prompts launched from the menu bar land in the currently open Chat app conversation instead of forcing a jump to the Agents app, preserving the active project, instance, and session lane. (`e142ab8`)

## Highlights

- Quick Prompt palette across the shell
- Voice dictation in the chat composer
- Branch a conversation from any reply
- Hosted Chromium runtime for previews


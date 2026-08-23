# Quick prompts, voice dictation, and a hosted browser runtime

- Date: `2026-08-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.800.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.800.1

Today's nightly brings three new chat superpowers — a global quick prompt palette, in-composer voice dictation, and the ability to branch any assistant reply into a fresh conversation — followed by a substantial backend push that packages Aura's preview browser into a reproducible hosted Chromium runtime.

## 4:00 AM — New chat composer superpowers: quick prompts, voice input, and reply branching

Three back-to-back features land in the chat surface: a shell-wide quick prompt palette, voice dictation inside the composer, and the ability to fork a conversation from any assistant reply.

- A new Quick Prompt palette is wired into the Aura shell and menu bar, letting users draft a prompt from anywhere and have it merged into the target agent's chat draft via a dedicated quick-prompt store. (`da686ae`)
- The chat composer now supports voice dictation through a new VoiceDictationControl and useVoiceDictation hook, with layout updates in the input shell (desktop and mobile) to make room for the mic action next to send/stop. (`914e247`)
- Users can now branch a conversation from any completed assistant reply: a new server-side branch_session endpoint copies events through the selected turn into a fresh active session, exposed via message actions in the chat UI. (`e01a708`)

## 8:03 AM — Hosted Chromium runtime for the preview browser

The preview browser gets a production-grade hosted runtime: a new Dockerfile bundles Chromium with the API server, a dedicated CI workflow builds and smoke-tests the image, and the CDP backend is reworked to talk to it reliably.

- Introduced a Dockerfile, .dockerignore, and an aura-api-container GitHub Actions workflow that builds the API image, boots it, and verifies Chromium/CDP startup plus an unprivileged runtime user before publishing. (`4697c95`)
- Reworked the CDP backend (backend, config, and module wiring) and browser REST handler so the hosted Chromium runtime is discovered and driven consistently, while preserving the Windows path import for local desktop use. (`4697c95`)
- Updated the Render deployment docs and refreshed the BrowserInstance component and tests to match the new hosted preview flow. (`4697c95`)

## Highlights

- Quick prompt palette from the menu bar
- Voice dictation in the chat composer
- Branch any assistant reply into a new session
- Dockerized Chromium runtime for hosted preview


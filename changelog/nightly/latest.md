# Quick Prompt palette, voice dictation, and conversation branching

- Date: `2026-08-23`
- Channel: `nightly`
- Version: `0.1.0-nightly.803.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.803.1

A feature-heavy nightly for the chat surface: a new global Quick Prompt palette, voice dictation in the composer, and the ability to fork any assistant reply into an independent conversation. A late-day round of fixes then hardened the branch flow and the Quick Prompt handoff, alongside a new containerized preview runtime for the hosted Chromium browser.

## 4:00 AM — Quick Prompt palette, voice dictation, and reply branching

Three sizeable chat features landed back-to-back in the morning, adding a global prompt launcher, in-composer dictation, and server-backed conversation forks.

- Introduced a Quick Prompt palette wired into the Aura shell and menu bar: users can pop open a modal from anywhere, pick an agent, and hand a drafted prompt off to the Agent or Standalone Agent chat panel, which merges it into the active draft on mount. (`da686ae`)
- Added voice dictation to the chat composer on both desktop and mobile, including a dedicated VoiceDictationControl slot in the input bar shell with layout reservations so send/stop and dictation controls no longer collide. (`914e247`)
- Shipped conversation branching from any assistant reply: a new server endpoint copies session events through a chosen assistant_message_end into a fresh active session, and the message action row exposes a Branch conversation here control that jumps to the new session. (`e01a708`)

## 8:03 AM — Hosted Chromium container and follow-up fixes for branching and Quick Prompt

The afternoon focused on making the new features production-ready: a containerized Chromium runtime for the hosted preview, a more forgiving branch navigation flow, and two Quick Prompt fixes covering active-lane handoff and cold-start hydration.

- Shipped a reliable hosted Chromium runtime for the browser preview via a new Dockerfile, .dockerignore, and an aura-api-container GitHub Actions workflow that builds the image, boots it as an unprivileged aura user, and smoke-tests /api/auth/session before publishing. (`4697c95`)
- Hardened conversation branch navigation by routing through React Router's useNavigate instead of manual history/popstate, keeping the Branch button enabled after completion and surfacing an inline "Couldn't branch this conversation" error when the request fails. (`d73f75c`)
- Fixed the Quick Prompt handoff so it now merges into the Chat app's own stream on the active project/instance/session lane, instead of navigating away to the Agents app and stranding remote agents on an unavailable standalone surface. (`e142ab8`)
- Preserved the route's agent selection in the Quick Prompt modal during desktop cold start: the current chat agent stays selected (shown as "Current chat agent") and the draft is retained while the agent roster is still hydrating. (`4c3113c`)

## Highlights

- Quick Prompt palette lands in the shell
- Voice dictation in the chat composer
- Branch any reply into a new conversation
- Hosted Chromium now ships as a verified container image


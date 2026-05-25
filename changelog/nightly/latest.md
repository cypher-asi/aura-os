# Marketing download hub lands and DAU analytics get more honest

- Date: `2026-05-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.558.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.558.1

Today's nightly brings a dedicated in-app download page for the marketing site with per-platform install links, plus the navigation surfaces to find it. Later in the day, a focused analytics fix tightens how Aura counts active users across long-running sessions.

## 3:22 AM — New /download page wires up nightly installers across platforms

A dedicated download experience ships in the marketing shell, with platform-aware cards and discovery links from the navbar and logged-out footer. A couple of small marketing-shell fixes land alongside it.

- Added a new /download route under the marketing shell that pulls the nightly manifest from GitHub Pages and renders platform-specific cards for macOS Apple Silicon, macOS Intel, Windows, and Linux, including a recommended-card treatment with direct download links. (`ca28122`)
- Surfaced the new page through a Download link in the marketing navbar and in the logged-out shell footer so visitors can reach installers from anywhere on the site. (`9171026`)
- Fixed marketing pages getting stuck unable to scroll by forcing overflow visible and auto height with !important on the marketing-shell root. (`9115889`)
- Corrected the logged-out footer's Feedback link, which was incorrectly pointing at /roadmap and now goes to /feedback. (`ca98319`)

## 10:16 AM — session_active re-fires on focus to fix True DAU undercount

Analytics now re-emits session_active when the app regains focus, so users who leave Aura open across days are no longer missing from True DAU while still showing up in Engaged DAU.

- session_active previously fired only once at mount, leaving long-running web tabs and desktop windows uncounted in True DAU; AppShell now re-fires the event on visibilitychange and window focus, relying on Mixpanel's per-day dedupe to keep uniques accurate. (`1fd8e0b`)

## Highlights

- New /download page with macOS, Windows, and Linux cards
- Download entry points added to navbar and logged-out footer
- Marketing pages scroll reliably again
- True DAU now tracks long-running sessions accurately


# A dedicated download page lands on the marketing site

- Date: `2026-05-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.557.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.557.1

Today's nightly brings the marketing site a proper home for downloads. A new /download route ports the platform picker from aura-web, with direct links to the latest macOS, Windows, and Linux builds, plus navigation and footer entry points to find it. A handful of small fixes clean up scrolling and a misrouted footer link along the way.

## 3:22 AM — New /download page with per-platform install cards

The marketing site gains a dedicated download experience that reads the live nightly manifest and surfaces the right build for each platform, with supporting navigation and small polish fixes.

- Added a /download route under the marketing shell that pulls the nightly manifest from GitHub Pages and renders platform cards for macOS Apple Silicon, macOS Intel, Windows, and Linux, including a recommended-card treatment and direct download links. (`ca28122`)
- Surfaced the new download destination from both the marketing navbar and the logged-out shell footer so visitors can reach builds from anywhere on the site. (`9171026`)
- Fixed marketing pages getting stuck without scroll by forcing overflow visible and auto height with !important on the marketing shell root. (`9115889`)
- Corrected the logged-out footer's Feedback link, which was pointing at /roadmap, to send users to /feedback instead. (`ca98319`)

## Highlights

- New /download page with macOS, Windows, and Linux cards
- Download entry points added to navbar and logged-out footer
- Marketing scroll and footer link fixes


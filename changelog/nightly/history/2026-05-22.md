# Public funnel analytics and a theme toggle for logged-out shells

- Date: `2026-05-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.554.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.554.1

Today's nightly focuses on two threads in the Interface: a richer analytics layer that separates public from authenticated usage and tracks the logged-out funnel end to end, followed by a user-facing sun/moon theme toggle wired into the logged-out and simple shells.

## 2:11 AM — Public funnel instrumentation and authenticated-vs-public segmentation

Analytics now distinguishes public from signed-in usage and captures the full logged-out conversion funnel, plus a Simple-vs-Advanced app mode dimension.

- Added an is_authenticated super property to every Mixpanel event and emitted the public funnel — public_session_started, public_message_sent, public_gate_shown, public_login_clicked and public_signup_clicked — across the logged-out shell, KeepChatting gate and public chat store, so signed-in and anonymous metrics can finally be filtered apart. (`8e2db7e`)
- Fired a public_page_viewed event when the logged-out shell mounts to anchor the top of the funnel. (`c775eb7`)
- Introduced an app_mode super property (mobile, simple or advanced) registered from the responsive AppShell, giving every downstream event a layout/mode dimension via a new registerProperty helper. (`22b42a0`)

## 5:25 AM — Sun/moon theme toggle for the logged-out and Simple shells

Both public-facing shells now expose a theme toggle in the titlebar and render correctly in light mode.

- Added a sun/moon theme toggle button to the LoggedOutShell and SimpleShell titlebars, wired to ZUI's useTheme with proper ARIA labels and cycling between light/dark/system. (`f1b498c`)
- Replaced hardcoded rgba backdrop colors with the --color-backdrop-medium CSS variable so overlays in both shells render correctly under light mode. (`f1b498c`)
- Cleaned up a leftover getThemeToggleIconKind import in SimpleShell left over from the toggle work. (`e2775fb`)

## Highlights

- Public funnel events and is_authenticated/app_mode super properties in Mixpanel
- Sun/moon theme toggle on logged-out and Simple shells
- Hardcoded backdrop colors swapped for theme variables for correct light mode


# Analytics instrumentation for the public funnel and app modes

- Date: `2026-05-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.552.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.552.1

Today's nightly focuses entirely on analytics depth: Aura now distinguishes authenticated from logged-out usage, captures the full public visitor funnel from page view to signup click, and tags every event with which app shell the user is in.

## 2:11 AM — Public visitor funnel and app-mode segmentation in Mixpanel

Analytics gained an authentication flag, a complete logged-out funnel, and an app-mode super property so public and authenticated usage can finally be measured side by side.

- Every Mixpanel event now carries an is_authenticated super property, set to false at init, flipped to true on identify, and reset on logout, so authenticated and public metrics can be filtered independently. (`8e2db7e`)
- Instrumented the full logged-out funnel with public_page_viewed on shell mount, public_session_started when a guest session is created, public_message_sent (tagged with the selected mode), public_gate_shown on the KeepChattingModal, and public_login_clicked / public_signup_clicked from both the modal and the titlebar (with a source property). (`8e2db7e`, `c775eb7`)
- Added an app_mode super property registered from the AppShell that stamps every event as mobile, simple, or advanced, via a new registerProperty helper in the analytics library. (`22b42a0`)

## Highlights

- Authenticated vs. public traffic is now separable in Mixpanel
- Full logged-out funnel instrumented end to end
- Every event tagged with simple, advanced, or mobile shell


# Public funnel analytics for the logged-out experience

- Date: `2026-05-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.551.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.551.1

A focused nightly that instruments Aura's logged-out shell end to end, giving the team a clean way to separate public visitors from signed-in users and measure how they move from landing to sign-up.

## 2:11 AM — Public visitor funnel instrumented on the logged-out shell

Aura's analytics layer now distinguishes authenticated users from public visitors and captures the key steps of the logged-out journey, from first page view through gate prompts to login and signup clicks.

- Every Mixpanel event now carries an is_authenticated super property, registered as false on init, flipped to true on identifyUser, and reset on logout so public and signed-in metrics can be filtered cleanly. (`8e2db7e`)
- Added a public funnel of events covering session start, message sent (with selected mode), the keep-chatting gate being shown, and login/signup clicks from both the gate modal and the logged-out titlebar (the latter tagged with a titlebar source). (`8e2db7e`)
- The logged-out shell now fires a public_page_viewed event on mount, closing the loop so the funnel starts from the very first render of the public experience. (`c775eb7`)

## Highlights

- is_authenticated flag now splits public vs. signed-in metrics
- Full public funnel from page view to login click is tracked
- Logged-out shell, titlebar, and gate modal all emit events


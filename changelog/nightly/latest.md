# Marketing site overhaul, i18n foundation, and agent platform fixes

- Date: `2026-06-10`
- Channel: `nightly`
- Version: `0.1.0-nightly.636.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.636.1

A sprawling multi-day batch dominated by a top-to-bottom redesign of the public marketing site — new /agents, /code, /os, and /docs experiences with hardware-inspired CSS/WebGL devices, a unified gold accent, and full i18n scaffolding across 20 languages. Smaller but meaningful platform work landed alongside: a logout reliability fix, Telegram MarkdownV2 rendering, remote-agent org healing, richer chat error reports, and Mixpanel OS attribution on server-emitted events.

## 12:06 AM — Cyan-green replaces purple as the default accent

New users without a saved theme preference now boot into the cyan-green accent instead of purple.

- First-run users now get the cyan-green accent (#01f4cb) by default; anyone with a persisted choice keeps their existing theme. (`94cff7b`)

## 11:23 AM — Chat polish, analytics recovery, and remote-agent org healing

iMessage-style chat bubbles and glowing sidekick labels landed alongside a restored Mixpanel event and a server-side fix that keeps remote agents' Organization field populated.

- User chat bubbles are now uniformly rounded (18px) on desktop and mobile for a softer iMessage-style look. (`7e94787`)
- Selected sidekick sections, the Refer member button, and the active Agents/Projects switch label pick up a theme-aware glow, with unified 11px uppercase typography and tighter AgentInfoPanel spec text. (`8fe4a9a`)
- Restored the public_message_sent Mixpanel event on both desktop and mobile public-chat sends, fixing the broken "by mode" breakdown. (`775ecea`)
- Remote agents no longer render with a blank Organization: the post-provision PUT now threads the submitted org through, and list_agents backfills legacy NULL-org rows so the card heals on next view. (`6227727`)

## 11:48 AM — Telegram replies render in native MarkdownV2

Agent responses delivered via Telegram now use Telegram's MarkdownV2 dialect, with a plain-text fallback so escaping edge cases can never drop a message.

- The Telegram channel converts CommonMark into MarkdownV2 so bold, italic, code, and links style natively; if Telegram rejects the formatted payload, the agent falls back to stripped plain text so the reply still goes through. (`edd820c`)

## 11:48 AM — i18n foundation, prior-session chat history, and the new marketing system

A two-day push wired up internationalization across 20 languages, added a Load prior session affordance to chat, hardened web logout, and rebuilt the public /agents and /code pages around a shared hardware-device and metal-card design system.

- i18next + react-i18next are now wired up with lazy-loaded namespaces, an early <html lang/dir> stamp for RTL, and locale bundles for 20 languages (en/de/es/fr/pt-BR plus ar/ja/ko/zh-Hant/hi/id/nl/pl/tr/vi/th/uk and more); a Settings language section and a public taskbar/drawer language dropdown share a single store so they stay in sync. (`4bbf9f7`, `b336a6f`, `3ae7aec`, `4d6fc95`)
- Chat transcripts gain a repeatable Load prior session button that prepends the previous session's messages above a labeled divider, with stable scroll anchoring so the current viewport doesn't jump as history loads. (`ca08bba`, `e12083d`)
- Web logout is now resilient: localStorage failures in endLocalSession can no longer abort the session clear, and a finally block guarantees navigation to the public home, so File/Profile/Settings/Org logouts always land users on the logged-out surface in browsers. (`2d0ee74`)
- The /agents hero, integrations grid, skill keys, privacy cards, and CTA were rebuilt around a shared Plate/MetalCard/DeviceScreen/HardwareKey/Knob kit, with WebGL orbs, a noise-reduction brain visualization, and a per-stage "Agents made for you" device driving the new section flow. (`1fb435e`, `68f6ab8`, `b6311b8`, `c8a798c`)
- The /code page hero was replaced with an interactive mock of the authenticated AURA desktop — agents/projects nav, a live LLM chat using the real input bar, a scripted Terminal-to-Tasks sidekick loop, and the bottom taskbar — built from the app's real presentational components fed mock data. (`3a7168e`, `e94f8c4`, `8789a65`)
- New Creator persona becomes the default public landing agent with a full-screen WebGL plasma background and a looping character video wallpaper inside the mock desktop. (`6a010dd`, `eea01d9`, `6396dc1`)

## 11:38 AM — Mixpanel server events now report $os

Server-emitted events join the browser SDK's OS slicing instead of bucketing as "$os = (not set)".

- session_active, share_link_opened, and share_link_generated now derive $os from the request User-Agent using the same regex ladder as mixpanel-browser, so server- and client-side events merge into the same OS slices. (`158e736`)

## 12:56 PM — Gold-accent marketing finish, /os and /docs CMS, and chat error context

Three days of marketing polish unified the public site around a gold accent, added Notes-backed whitepaper and documentation surfaces, brought the homepage into a continuous scroll with the agents page, and shipped diagnostic improvements to chat error blocks.

- The /agents page was retinted around a shared golden accent — hero console lights, expertise tab underline, knob/ACTIVATION readouts, skill keys, integrations cycle, mode selector, and CTA all glow in unified gold tokens with a shimmering "Feel the AGI." tagline. (`4318527`, `cc01067`, `c97dbe7`, `9c8ea6b`)
- A new public /os whitepaper page and /docs site are now backed by reserved Notes projects, with sys-admin-authored markdown on S3 served anonymously via /api/public/os and /api/public/docs; the /docs page uses a three-column GitBook-style layout. (`6379550`, `34458d3`, `4eeec8a`)
- The intelligence spec device gained a built-in expertise selector that swaps in per-discipline capability typewriters and example mockups (Research, Writing, Creative, Coding, Analytics, Finance, Legal, and more) around the always-on brain, replacing the standalone tab strip. (`85a2959`, `0222229`)
- Built a new Built-for-trust section anchored by a WebGL Mac-mini-style isolated device with a ghost-computer stack, a service button rail with converging energy connectors into the device, plus a CD-tray display panel, password lock, and always-on toggle. (`f3d795d`, `b9be91e`, `2e19c32`, `a7b6b3d`, `ccf3752`)
- The landing persona carousel now flows directly into the embedded /agents section stack: scrolling past the last persona eases into the agents content and scrolling back re-locks the carousel with a momentum-settle guard. (`525d2f4`)
- Chat error blocks now display and copy the agent name, local/remote type, status, device context, and the agent machine's IP, with the same fields mirrored into the Report bug bundle so user-shared error reports are self-describing. (`0df0a60`, `7a4ce56`)
- Marketing surfaces were broadly localized — public top nav, footer (including a new GitHub link and copyright bottom bar), Feedback and Models views, and the remaining marketing sections now run through i18n; marketing chat inputs are pinned to the dark theme regardless of the visitor's app theme. (`a9085b2`, `abf82b8`, `4444e37`, `21e3660`)
- Reduced layout churn while the chat prompt is being typed, with matching eval scenarios aligning the chat and workflow checks. (`440cf34`)

## Highlights

- Default accent flipped to cyan-green
- Telegram replies now render in native MarkdownV2
- Web logout hardened so it always clears the session
- i18n scaffolding plus 20 locale bundles and a public language switcher
- Full marketing site rebuild around a shared device/metal-card kit
- New /os whitepaper and /docs CMS surfaces backed by Notes
- Chat error blocks now self-report agent, device, and IP context
- Mixpanel server events now carry $os for clean OS slicing


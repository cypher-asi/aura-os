# iOS App Store unblock and Opus 4.8 lands

- Date: `2026-05-28`
- Channel: `nightly`
- Version: `0.1.0-nightly.563.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.563.1

A short but consequential day: the iOS build cleared its App Store review blockers with a real app icon and a fix that restores chat input for mobile users, and Claude Opus 4.8 joined the managed model lineup.

## 2:13 AM — iOS App Store review fixes and mobile chat input restored

Two iOS fixes clear an App Store rejection and restore chat input that had been silently disabled for some mobile users.

- Replaced the blue X placeholder with the real 1024x1024 AURA orb icon and flattened it onto a solid black background to remove the alpha channel, resolving the App Store review rejection under guideline 2.3.8. (`57b131a`, `b40c906`)
- Removed the isLocalAgent gate on MobileChatInputBar so chat input is no longer blocked for machine_type=local agents — on mobile every agent routes through the server harness anyway. (`b40c906`)

## 10:51 AM — Claude Opus 4.8 added to the managed model list

Opus 4.8 is now selectable in the AURA-managed chat models, with legacy id aliases mapped so existing references keep working.

- Added the aura-claude-opus-4-8 option (labeled "Opus 4.8", opus tier) to the managed chat model list and mapped both claude-opus-4-8 and aura-claude-opus-4-8 through the legacy id resolver for backward compatibility. (`2649f8b`)

## Highlights

- Real AURA orb icon ships on iOS
- Mobile chat input unblocked for local agents
- Claude Opus 4.8 available in model picker


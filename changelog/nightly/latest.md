# iOS App Store unblockers and Claude Opus 4.8 rollout

- Date: `2026-05-28`
- Channel: `nightly`
- Version: `0.1.0-nightly.564.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.564.1

Today's nightly clears the path for the iOS build with a proper AURA app icon and a fix for mobile chat input, then brings Claude Opus 4.8 into the model lineup and surfaces it directly in the chat composer.

## 2:13 AM — iOS App Store rejection cleared and mobile chat input restored

Two iOS-focused fixes ship the real AURA app icon in a format Apple accepts and remove a gate that was silently blocking chat input on mobile.

- Replaced the blue X placeholder with the 1024x1024 AURA orb and flattened it onto a solid black background to remove the alpha channel, resolving the App Store review rejection under guideline 2.3.8. (`57b131a`, `b40c906`)
- Removed an incorrect isLocalAgent gate in MobileChatInputBar so agents with machine_type=local no longer have their input blocked on mobile, where everything routes through the server harness anyway. (`b40c906`)

## 10:51 AM — Claude Opus 4.8 added and pinned in the chat composer

Opus 4.8 is now a selectable AURA-managed model and appears alongside the other featured options in the desktop chat input.

- Added Claude Opus 4.8 (aura-claude-opus-4-8) to the managed chat model list, including legacy ID mappings so existing claude-opus-4-8 references resolve cleanly. (`2649f8b`)
- Promoted Opus 4.8 into the featured model row of the desktop chat input bar so it shows up next to GPT-5.4 and Opus 4.7 without needing to dig through the full model picker. (`0026c40`)

## Highlights

- AURA orb replaces placeholder iOS app icon
- Mobile chat input unblocked for local agents
- Claude Opus 4.8 available and featured in chat


# iOS App Store unblockers and a mobile chat input fix

- Date: `2026-05-28`
- Channel: `nightly`
- Version: `0.1.0-nightly.562.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.562.1

A tight, focused day aimed squarely at getting AURA through App Store review and fixing a quiet but painful mobile regression. The team replaced the placeholder iOS icon with the real AURA orb, reworked it to meet Apple's no-transparency rule, and restored chat input for local agents on mobile.

## 2:13 AM — iOS icon meets App Store rules and mobile chat input returns for local agents

Two quick iOS fixes clear an App Store review block and restore chat input on mobile for local agents.

- Replaced the blue X placeholder with the real 1024x1024 AURA orb as the iOS app icon, resolving the App Store review rejection under guideline 2.3.8. (`57b131a`)
- Flattened the AURA orb onto a solid black background to strip the alpha channel, satisfying Apple's requirement that app icons contain no transparency. (`b40c906`)
- Unblocked the MobileChatInputBar for agents with machine_type=local, which were incorrectly gated out; on mobile every agent routes through the server harness, so the local-agent check has been removed. (`b40c906`)

## Highlights

- Real AURA orb ships as the iOS app icon
- App Store guideline 2.3.8 rejection resolved
- Mobile chat input restored for local agents


# Chat-first onboarding and a hardened hosted harness path

- Date: `2026-07-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.728.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.728.1

Today's nightly reshapes Aura's first-run experience around chat, teaches the web and desktop shells to pick the right entry point for their platform, and lands a substantial reliability pass on the hosted local-harness transport — including auth scoping, autospawn safety, and a runtime-capability API so the UI stops offering local agents it can't actually reach.

## 11:26 PM — Platform-aware, chat-first onboarding

Onboarding was rebuilt around the chat surface and now branches by platform, and the desktop shell is correctly classified as a desktop client rather than a native/mobile runtime.

- Rebuilt the welcome and onboarding checklist to be chat-first and platform-aware: web users land on the public chat surface, while desktop opens directly into the Build workspace via a new platform entry redirect. (`3dc1cc5`, `81f739b`, `52149ec`)
- Renamed the Projects app to Build across the sidebar switch, registry, and search placeholders, and reordered the Build ↔ Agents toggle to match the new default. (`3dc1cc5`)
- Fixed a desktop misclassification where the loopback origin made isNativeRuntime() return true, which was serving the mobile login view and shell to Desktop; the check now defers to the Tauri/desktop bridge globals so Capacitor and mobile-dev webviews remain native. (`cf021f8`, `9f38fe8`)

## 10:52 AM — Hosted harness transport auth and autospawn safety

The hosted local-harness path gained a scoped transport bearer, safer autospawn behavior, and matching deployment docs so remote harnesses can be reached without leaking service secrets or accidentally launching a stray local process.

- Added a dedicated hosted-harness transport auth token that authenticates the server-to-harness hop, and reworked the harness gateway, proxy access layer, and clients to scope it distinctly from the caller's JWT. (`5a400c2`, `8213491`)
- Hardened autospawn so it only fires for real loopback URLs with an explicit port — a hosted LOCAL_HARNESS_URL can no longer silently fall back to 127.0.0.1:8080 and launch an unrelated local harness. (`b4709af`)
- Documented the hosted-harness deployment story in the README and render-deployment guide, including the LOCAL_HARNESS_AUTH_TOKEN / AURA_NODE_AUTH_TOKEN pairing and the incompatibility with AURA_REMOTE_ONLY=1. (`90b0897`, `b4709af`)

## 4:45 PM — Pinned macOS runner for desktop validation

The desktop validation workflow now runs on a pinned macOS image to stabilize signing and packaging checks against GitHub runner drift.

- Pinned the macOS runner used by the desktop-validate workflow to keep desktop bundle validation reproducible across nightly runs. (`e695517`)

## 5:03 PM — Runtime capabilities API for hosted local agents

The server now advertises whether a hosted local-harness runtime is actually reachable, and the interface uses that signal instead of assuming based on browser vs. desktop.

- Added a /api/system/runtime-capabilities endpoint that reports remote_only, hosted_local_harness, and local_agent_runtime_available, gated on a non-loopback LOCAL_HARNESS_URL. (`d0229e6`)
- Wired the new capability into useAuraCapabilities and the agent index/chat routes so cached local-agent ids no longer resolve on clients that can't reach them, and updated the disabled-send copy to say the local agent isn't available in this browser. (`d0229e6`, `558b0c8`)

## 6:15 PM — Fail-closed harness auth and public chat import after sign-in

Hosted-harness auth now fails closed when misconfigured, and signed-in users can promote their guest public-chat transcripts into a real Aura chat session.

- Made hosted local-harness routes require and validate the transport bearer, rejecting requests when auth is missing or misconfigured instead of silently falling through. (`801dab2`, `49dc4ec`)
- Added an authenticated import path that copies a guest's localStorage-only public chat turns into a first-class agent chat session on sign-in, with de-duplication, size limits, and a lazy home-project repair for chat agents lacking a project binding. (`833b6b5`)

## 10:02 PM — Web chat no longer selects cached local agents

The chat app now consults runtime capabilities when picking an agent, so remote-only clients stop landing on a cached local agent that can't run there.

- Threaded remoteOnly into the chat-app agent resolver and left panel so the web selects a web-safe agent (falling back to the CEO agent) instead of restoring a cached local-agent id it can't use. (`e4d2395`)
- Followed up on the desktop loopback detection fix with expanded tests around device-info, host-config, and native-runtime to lock in the desktop-vs-native classification. (`9764709`)

## Highlights

- Chat-first, platform-aware onboarding
- Desktop shell no longer misdetected as native
- Hosted harness transport auth scoped and fail-closed
- Public chat transcripts import after sign-in
- Web chat stops selecting unreachable local agents


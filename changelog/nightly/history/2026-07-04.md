# Desktop shell stops masquerading as a mobile client

- Date: `2026-07-04`
- Channel: `nightly`
- Version: `0.1.0-nightly.727.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.727.1

Today's nightly is a targeted fix for desktop users: because the Tauri shell loads Aura from a loopback origin, runtime detection had been misclassifying it as a native mobile client and pushing users into the wrong login view and shell. Two commits land the fix and lock it in with regression coverage across Mac, Windows, and Linux desktop builds.

## 5:11 AM — Desktop loopback origin no longer triggers native mobile mode

The desktop shell is served from 127.0.0.1, which was tripping the loopback-webview heuristic and forcing Aura into the native/mobile experience. Runtime detection now recognizes the desktop bridge and treats the app as a desktop client.

- isNativeRuntime() now short-circuits to false when a desktop bridge global (__AURA_BOOT_AUTH__, __TAURI__, or __TAURI_INTERNALS__) is present, so the Tauri desktop shell stops being classified as native and users no longer land on the mobile login view or mobile shell. (`cf021f8`)
- Capacitor and genuine loopback mobile-dev webviews still resolve as native, preserving mobile behavior while unblocking desktop host-config resolution. (`cf021f8`)

## 8:33 AM — Regression coverage and shared desktop-runtime helper

A follow-up hardens the loopback guard with a reusable isDesktopRuntime() helper and adds tests across useAuraCapabilities, host-config, and native-runtime so desktop, mobile, and web clients each stay on their intended UI path.

- Extracted an isDesktopRuntime() helper and routed detectClientPlatform() through it, giving device-info, host-config, and capability checks a single source of truth for the desktop shell. (`9f38fe8`)
- Added a useAuraCapabilities case that loads from http://127.0.0.1 with a desktop IPC bridge and asserts hasDesktopBridge is true while isNativeApp, isMobileClient, and the mobile-client dataset flag all stay false — locking in the fix from earlier in the day. (`9f38fe8`)
- Expanded host-config and native-runtime tests with proper window.location mocking and cleanup of Capacitor, __AURA_BOOT_AUTH__, and ipc globals so desktop, Android, and macOS web scenarios are each covered without cross-test leakage. (`9f38fe8`)

## Highlights

- Desktop shell no longer flips into the mobile UI
- Loopback detection now defers to the desktop bridge globals
- Regression tests added for desktop, mobile, and web runtimes


---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: TBD
---

# Expo (managed workflow) — apps/native

## Decision

Expo SDK 56 managed workflow for `apps/native`, deployed via EAS Build
and EAS Submit (when we get to native release).

## Why

- **Managed config + JS-first.** No Xcode-or-Android-Studio prerequisite for day-to-day dev. Build artifacts come from EAS in the cloud.
- **OTA updates via EAS Update.** Ship JS changes without the App Store review queue for non-native fixes.
- **Same React 19 / Tamagui surface as web.** `packages/ui` components render on both platforms; only the platform-specific bits (`use-geolocation.ts` etc) diverge.
- **The native-build-pipeline-as-a-service economics make sense for a solo dev.** Self-hosting Xcode + matching Android NDK versions is a maintenance tax we don't want to pay.

## Options considered

- **Bare React Native** — total control, but means owning the native toolchain. Worth it for a team with native devs; not for us pre-launch.
- **Capacitor / Ionic** — webview wrapper. Geolocation + map performance is bad enough on RN; doing it through a webview would be worse.
- **Native iOS + Android (Swift / Kotlin)** — best UX possible, ~3x the engineering effort. Revisit only if RN proves untenable for a specific feature.
- **Flutter** — would mean abandoning the React + Tamagui shared surface entirely. The whole monorepo rationale collapses.

## What we accept

- **EAS pricing.** Free tier is generous (~30 builds/month) but we'll pay if we ship frequently. Per the project memory, this is acceptable for a startup.
- **Expo SDK upgrade cadence.** Annual majors with breaking changes. RN's own upgrade path has improved a lot, but we still budget for it.
- **Some native APIs gated behind Config Plugins.** Easier than bare-workflow native modules but not zero-friction.

## What would make us reconsider

- Need a native API Expo doesn't expose and Config Plugins can't reach → eject to bare workflow (still possible from managed).
- EAS pricing flips bad for us (e.g., we hit the build cap routinely) → self-host Fastlane on a Mac mini.
- Performance hits a wall we can't optimize past (some Tamagui-heavy screens on low-end Android) → consider native-first rebuild of those screens.

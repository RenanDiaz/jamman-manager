# Changelog

All notable changes to JamMan Manager are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0-rc.1] - 2026-11-10

First release candidate. The macOS and Windows installers are **not signed** yet: macOS asks you
to allow the app in System Settings → Privacy & Security the first time, and auto-update does not
work on macOS until the app is signed and notarized.

### Added

- Browse and play the patches of a JamMan Stereo connected over USB, without removing the SD card.
  The **Pedal** key connects and lets you open the internal memory or the SD card. Phrase audio
  streams from the pedal and is cached locally once played to the end.
- Over USB, create, edit, delete and sort patches, add phrases and replace their WAV files (with
  upload progress), with undo and redo. Audio an undo may need is parked on the pedal itself, so
  it never crosses the cable twice.
- Over USB, back up a bank to a ZIP file and restore one onto it (merge or replace, with undo), and
  download a bank's audio ahead of time. Downloads and uploads show progress and can be stopped;
  a download resumes where it stopped.
- Over USB, playlists: the same `.jamman-playlists.json` as on a card, in the bank's folder.
- Over USB, the app follows the pedal live (the loaded patch, unsaved state, SD card, free space),
  asks before changing the patch the pedal is using, makes the pedal reload it afterwards, and sets
  the footswitch buttons.
- `docs/usb-protocol.md`: the pedal's USB protocol, and `tools/greenglass.py`, a small client to
  try it from a terminal.
- `npm run verify` (typecheck + lint + unit tests) and a Husky `pre-push` hook that runs it.
- `.nvmrc` pinning Node 24.
- `publish` configuration in `electron-builder.mjs` so tagged releases upload installers and
  auto-update metadata to a draft GitHub release.
- Conditional code signing for releases. macOS: Developer ID signing with the hardened runtime and
  notarization through an App Store Connect API key. Windows: Azure Trusted Signing, or a `.pfx`
  certificate as an alternative. Each is enabled only when its secrets exist in GitHub Actions; without
  them the build is unsigned, succeeds, and warns in the log. A half-configured platform fails the
  release job early. `electron-builder.mjs` logs a `[signing]` line per platform.
- "Code signing and releases" section in `BUILD.md`: exact secret and variable names with how to obtain
  them, how to test a signed build locally, and an end-to-end auto-update checklist.
- This changelog.

### Changed

- The Windows portable build is named `...-win-x64-portable.exe`, so it no longer overwrites the
  installer in the release.
- `release.yml` creates tags with a prerelease suffix (`v0.1.0-rc.1`) as GitHub pre-releases.
- The E2E job in CI builds with `--publish never`, so pushes to `main` no longer fail trying to
  publish to GitHub without a token.
- `release.yml` builds each platform in its own step so signing secrets are only passed to the platform
  that uses them, and installs `rpm` tooling on the Linux runner.
- CI (`.github/workflows/ci.yml`) is now blocking: typecheck, lint, formatting, tests and the
  production dependency audit (`npm audit --omit=dev --audit-level=high`) fail the build.
- `release.yml` is the only release workflow; electron-builder publishes directly instead of the
  archived `actions/create-release`. The tag must match the `package.json` version.
- GitHub Actions are pinned to commit SHAs on current major versions.
- Minimum Node version raised from 23 to 24 (`engines`, CI, README, BUILD).
- Dependabot checks npm weekly and groups minor and patch updates.
- `IMPROVEMENT_PLAN.md` and `QUICK_WINS_IMPLEMENTED.md` moved to `docs/`, with statuses corrected
  to match the project review (see `docs/specs/project-review-remediation.md`).

### Removed

- Boilerplate leftovers: the `init`, `create-renderer` and `integrate-renderer` scripts, the
  `packages/integrate-renderer` workspace, the `init-template-with-renderer` action and the
  `boilerplate-ci-entry`, `compile-and-test` and `deploy` workflows.
- The duplicated `build` block in `package.json` (`electron-builder.mjs` is the single source of truth).
- `.idea/` is no longer tracked and is git-ignored.

## Initial development (April 2025, `0.1.0` in package.json)

### Added

- Initial version: read, rename, reorder and delete JamMan Stereo patches from an SD card,
  with audio preview, backups (ZIP), playlists, TXT/PDF export and undo for reordering.

[Unreleased]: https://github.com/RenanDiaz/jamman-manager/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/RenanDiaz/jamman-manager/releases/tag/v0.1.0-rc.1

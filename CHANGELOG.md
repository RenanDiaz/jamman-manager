# Changelog

All notable changes to JamMan Manager are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
aims to follow [Semantic Versioning](https://semver.org/). No release has been tagged yet,
so everything so far is listed under "Unreleased".

## [Unreleased]

### Added

- Browse and play the patches of a JamMan Stereo connected over USB, without removing the SD card.
  The **Pedal** key connects and lets you open the internal memory or the SD card. Phrase audio
  streams from the pedal and is cached locally once played to the end.
- Over USB, edit a patch's settings, delete patches and sort them, with undo and redo. A deleted
  patch is parked on the pedal itself until it can no longer be undone. Creating patches, new or
  changed WAV files, backups and playlists still need the card in a card reader.
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

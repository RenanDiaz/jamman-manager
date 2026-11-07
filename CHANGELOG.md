# Changelog

All notable changes to JamMan Manager are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
aims to follow [Semantic Versioning](https://semver.org/). No release has been tagged yet,
so everything so far is listed under "Unreleased".

## [Unreleased]

### Added

- `npm run verify` (typecheck + lint + unit tests) and a Husky `pre-push` hook that runs it.
- `.nvmrc` pinning Node 24.
- `publish` configuration in `electron-builder.mjs` so tagged releases upload installers and
  auto-update metadata to a draft GitHub release.
- This changelog.

### Changed

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

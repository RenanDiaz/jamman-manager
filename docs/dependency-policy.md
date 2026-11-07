# Dependency policy

This document describes how JamMan Manager keeps its dependencies current and secure.

## Electron

Electron is pinned to an **exact version** in the root `package.json` (for example `"electron": "45.2.3"`, no `^` or `~`). The runtime that ships to users must be a deliberate choice, not a side effect of `npm install`.

Electron only receives security patches for its latest three major versions, and a new major is released roughly every eight weeks. A pinned version therefore falls out of support after about six months if nobody bumps it.

### Quarterly review

Once per quarter (January, April, July and October), review the Electron version:

1. Check the [Electron releases page](https://releases.electronjs.org/) and the support window (`npm view electron dist-tags`).
2. If the pinned major is no longer one of the latest three, or a security advisory affects it, upgrade in the same quarter. Otherwise, upgrading to the latest patch of the current major is enough.
3. For every major crossed, read the [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes) and check the areas this app depends on: `protocol` / `net` / `session`, `webPreferences` (`sandbox`, `contextIsolation`), `contextBridge`, `dialog`, and auto-update through `electron-updater`.
4. Bump the version, run `npm install`, then verify:
   - `npm run typecheck`, `npm run lint` and `npm test`
   - `npm start` launches the app and loads the renderer
   - `npm run compile` produces a build and `npm run test:e2e` passes against it
   - audio playback, the open/save dialogs and the auto-update check work
5. Record the new version and the date in the pull request description.

The Node version in `engines.node`, `.nvmrc` and the CI matrix should be reviewed in the same pass. Electron bundles its own Node, and `@app/electron-versions` derives the build target from it, so the Electron bump drives the main and preload build targets automatically.

## Other dependencies

- **Runtime dependencies** are declared in the package that imports them: the main-process libraries (`adm-zip`, `electron-log`, `electron-updater`, `fs-extra`, `music-metadata`, `pdfkit`, `xml2js`) in `packages/main`, the UI libraries in `packages/renderer`. The root `package.json` lists only tooling, plus `@app/main`.
- **Type packages** (`@types/*`) are always `devDependencies`.
- Prefer platform features over small libraries (for example `crypto.randomUUID()` instead of `uuid`). Do not add a dependency that is used in a single place unless it clearly earns its weight.
- Remove dependencies that nothing imports. Check with a text search for the package name before adding or keeping one.

## Security audit

- `npm audit --omit=dev` must report no high or critical vulnerabilities. This is the gate that matters for users.
- `npm audit` (including dev dependencies) should be reviewed at least quarterly. Findings in build and test tooling are lower risk, but fix them when a non-breaking update exists.
- Run `npm audit fix` first and review anything that needs `--force` by hand, since it can cross major versions.

## Updates

- Patch and minor updates within the declared ranges can be applied with `npm update`; run the full check list above afterwards.
- Major updates of tooling (`eslint`, `vitest`, `@vitejs/plugin-react`, `globals`, and similar) go in their own pull request, so a regression is easy to bisect.
- Keep `package-lock.json` committed and only change it through `npm`.

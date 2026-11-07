# Building JamMan Manager

This guide explains how to build distributable installers for JamMan Manager on different platforms.

## Prerequisites

- **Node.js** >= 24 (LTS; pinned in `.nvmrc`, run `nvm use` to pick it up)
- **npm** (comes with Node.js)
- All project dependencies installed: `npm install`

## Quick Start

### Build for Current Platform

```bash
npm run dist
```

This will automatically detect your current platform and build installers for it.

### Platform-Specific Builds

```bash
# macOS (DMG + ZIP for Intel and Apple Silicon)
npm run dist:mac

# Windows (NSIS installer + Portable for x64)
npm run dist:win

# Linux (AppImage, DEB, and RPM for x64)
npm run dist:linux

# All platforms (requires appropriate OS or cross-compilation tools)
npm run dist:all
```

## Output Files

Built installers will be placed in the `dist/` directory:

### macOS Installers

- `JamMan Manager-{version}-mac-x64.dmg` - DMG installer for Intel Macs
- `JamMan Manager-{version}-mac-arm64.dmg` - DMG installer for Apple Silicon Macs
- `JamMan Manager-{version}-mac-x64.zip` - ZIP archive for Intel Macs
- `JamMan Manager-{version}-mac-arm64.zip` - ZIP archive for Apple Silicon Macs

### Windows Installers

- `JamMan Manager-{version}-win-x64.exe` - NSIS installer for 64-bit Windows
- `JamMan Manager-{version}-win-x64-portable.exe` - Portable version (no installation)

### Linux Installers

- `JamMan Manager-{version}-linux-x64.AppImage` - Universal Linux app (no installation)
- `JamMan Manager-{version}-linux-x64.deb` - Debian/Ubuntu package
- `JamMan Manager-{version}-linux-x64.rpm` - Red Hat/Fedora package

## Configuration

The build configuration is defined in:

- `electron-builder.mjs` - Main electron-builder configuration
- `package.json` - Project metadata and dependencies
- `buildResources/` - Icons and other build assets

### Build Resources

- `buildResources/icon.png` - Main app icon (1024x1024 recommended)
- `buildResources/icon.icns` - macOS app icon
- `buildResources/entitlements.mac.plist` - macOS entitlements

### macOS Entitlements

The app is signed with the hardened runtime (`hardenedRuntime: true` in `electron-builder.mjs`), and `buildResources/entitlements.mac.plist` is used both for the app and for its helpers (`entitlements` and `entitlementsInherit`). It holds only what the app needs:

| Entitlement                                         | Why it is there                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `com.apple.security.cs.allow-jit`                   | V8 (Chromium and Node.js inside Electron) compiles JavaScript to machine code at runtime. Without it the hardened runtime kills the renderer and the main process. Electron requires it.                                                              |
| `com.apple.security.files.user-selected.read-write` | Access to the files and folders the user picks in open/save dialogs (SD folder, WAVs, backups, exports). It only takes effect under the App Sandbox, which is not enabled; it is kept so turning the sandbox on later does not break the SD workflow. |

Removed (2026-11, security review), with the reason they are not needed:

| Entitlement                                              | Why it was removed                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Needed only by old Electron versions. `allow-jit` covers V8 on current Electron.                                                                                        |
| `com.apple.security.cs.allow-dyld-environment-variables` | Lets `DYLD_*` variables inject libraries into the process. The app does not use them, and it is a common code-injection vector.                                         |
| `com.apple.security.cs.disable-library-validation`       | Lets the app load libraries signed by other teams. The app ships no third-party native modules (`.node`), so everything it loads is signed with the app's own identity. |
| `com.apple.security.device.usb`                          | The app talks to the JamMan only through its SD card mounted as a volume, never over USB.                                                                               |
| `com.apple.security.device.audio-input`                  | The app plays WAV files but never records audio.                                                                                                                        |

If a signed build fails to open (for example a crash on start under the hardened runtime), add back only the entitlement that fixes it and document the reason in this table. Check the entitlements of a build with `codesign -d --entitlements - "JamMan Manager.app"`.

## Code signing and releases

Signed installers are what make the app trustworthy and what make auto-update work:

- **macOS** blocks unsigned, un-notarized apps in Gatekeeper, and Squirrel.Mac (the engine behind
  `electron-updater` on macOS) only installs an update that is signed with the same identity as the
  running app. Without signing there is **no auto-update on macOS**.
- **Windows** shows a SmartScreen warning for unsigned installers. Updates still install, but a signed
  build lets `electron-updater` check the publisher of each update (`verifyUpdateCodeSignature`).
- **Linux** packages are not signed.

> **Never commit certificates, keys or passwords.** They live only in GitHub Actions secrets (and in
> your password manager). Nothing in this repository contains a secret value.

### How it works

Signing is **opt-in and conditional**. `electron-builder.mjs` looks at which environment variables exist
and turns on only what is fully configured; `release.yml` passes each platform's secrets only to that
platform's build step. If a platform has no secrets, its installers are built **unsigned**, the build
does **not** fail, and the log says so (a `::warning::` annotation on the workflow run plus a
`[signing] WARNING: ...` line from `electron-builder.mjs`).

| Platform | Signed with                                                   | Turned on when                                                       |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| macOS    | Developer ID Application certificate, hardened runtime        | `MAC_CSC_LINK` + `MAC_CSC_KEY_PASSWORD`                              |
| macOS    | Notarization (App Store Connect API key)                      | `APPLE_API_KEY_P8` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`         |
| Windows  | Azure Trusted Signing (preferred)                             | all three `AZURE_*` secrets and all four `AZURE_SIGNING_*` variables |
| Windows  | `.pfx` certificate (alternative, used if Azure is not set up) | `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`                              |
| Linux    | not signed                                                    | -                                                                    |

A **half-configured** group (for example the certificate without the notarization key, or two of the
three Azure secrets) makes the release job **fail early** with an `::error::` instead of publishing a
build that is signed but still blocked by Gatekeeper. Either set the whole group or none of it.

If Azure and a `.pfx` are both configured, Azure wins.

### Secrets and variables to create

Create them in the repository under **Settings → Secrets and variables → Actions** (secrets in the
_Secrets_ tab, variables in the _Variables_ tab). Names are exact and case-sensitive.

#### macOS (5 secrets)

| Secret                 | What it is                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| `MAC_CSC_LINK`         | The Developer ID Application certificate as a `.p12`, base64-encoded          |
| `MAC_CSC_KEY_PASSWORD` | The password you chose when exporting the `.p12`                              |
| `APPLE_API_KEY_P8`     | The full text of the App Store Connect API key file (`AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_KEY_ID`     | The key's ID (10 characters)                                                  |
| `APPLE_API_ISSUER`     | The Issuer ID (a UUID) shown above the keys table                             |

How to get them (needs the **Account Holder** of the Apple Developer Program, $99/year):

1. **Certificate.** In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)
   create a **Developer ID Application** certificate (not "Developer ID Installer", not "Apple
   Development"). Download it and open it so it lands in Keychain Access → _login_ → _My Certificates_.
2. **Export.** In Keychain Access select the certificate **together with its private key** (expand the
   arrow), right-click → _Export 2 items…_ → format `.p12`, choose a password. That password is
   `MAC_CSC_KEY_PASSWORD`.
3. **Encode.** `base64 -i certificate.p12 | pbcopy` copies the value of `MAC_CSC_LINK`. Then delete the
   `.p12` from disk (keep the original in your password manager).
4. **API key.** In [App Store Connect → Users and Access → Integrations → Team Keys](https://appstoreconnect.apple.com/access/integrations/api)
   generate a key with the **Developer** role. Download the `.p8` **once** (Apple does not let you download
   it again). `cat AuthKey_XXXXXXXXXX.p8 | pbcopy` copies `APPLE_API_KEY_P8`; the key ID is in the table
   (`APPLE_API_KEY_ID`) and the Issuer ID is above it (`APPLE_API_ISSUER`).

**Why an API key and not an Apple ID + app-specific password.** Both work with electron-builder, but the
API key is not tied to a person's Apple ID (it survives that person leaving the team and does not depend
on their two-factor setup), it can be revoked on its own without touching the account password, and its
role limits what a leak could do. electron-builder itself recommends it. If you prefer the Apple ID
route, export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` instead: `electron-builder.mjs`
detects them; you would also have to map them in `release.yml`.

#### Windows, option A: Azure Trusted Signing (3 secrets + 4 variables)

| Kind     | Name                           | What it is                                                                                         |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Secret   | `AZURE_TENANT_ID`              | Directory (tenant) ID of the Microsoft Entra ID app registration                                   |
| Secret   | `AZURE_CLIENT_ID`              | Application (client) ID of that app registration                                                   |
| Secret   | `AZURE_CLIENT_SECRET`          | A client secret created for that app registration                                                  |
| Variable | `AZURE_SIGNING_ENDPOINT`       | Regional endpoint of the signing account, e.g. `https://eus.codesigning.azure.net`                 |
| Variable | `AZURE_SIGNING_ACCOUNT`        | Name of the Trusted Signing account                                                                |
| Variable | `AZURE_SIGNING_PROFILE`        | Name of the certificate profile                                                                    |
| Variable | `AZURE_SIGNING_PUBLISHER_NAME` | The common name (CN) of the certificate subject, **exactly** as in the profile (e.g. `Renan Diaz`) |

The four variables are not sensitive, which is why they are variables (their values stay readable in
logs). How to get them:

1. In the Azure portal create a **Trusted Signing account** (resource provider `Microsoft.CodeSigning`)
   and complete **identity validation** (individual or organization). Check which countries and entity
   types are eligible before starting; validation can take days.
2. Create a **certificate profile** (type _Public Trust_) from the validated identity. Its account name,
   profile name and the region's endpoint give the first three variables; the common name of the certificate
   subject shown on the profile gives `AZURE_SIGNING_PUBLISHER_NAME`.
3. In Microsoft Entra ID create an **app registration** and add a **client secret**: tenant ID, client ID
   and the secret value are the three secrets (copy the secret value immediately; it is shown once).
4. On the Trusted Signing account, under _Access control (IAM)_, give that app the role
   **Trusted Signing Certificate Profile Signer**.

`electron-builder` installs the `TrustedSigning` PowerShell module on the runner and signs through it;
the Azure SDK reads the three `AZURE_*` secrets from the environment.

#### Windows, option B: `.pfx` certificate (2 secrets)

| Secret                 | What it is                                             |
| ---------------------- | ------------------------------------------------------ |
| `WIN_CSC_LINK`         | The code-signing certificate as `.pfx`, base64-encoded |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` password                                    |

Encode with `base64 -i certificate.pfx | pbcopy` (macOS/Linux) or
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard` (PowerShell).

> Since June 2023 the CA/Browser Forum requires the private key of a new public code-signing certificate
> to live on a hardware token or in a cloud HSM, so most CAs no longer hand out an exportable `.pfx`.
> This option therefore mostly works with an older certificate, or with a CA that offers an exportable
> key. If yours only offers a token or cloud signing, use option A or that provider's own signing tool.

Locally, `CSC_LINK` / `CSC_KEY_PASSWORD` work as well as the `WIN_`-prefixed names (the prefixed ones keep a
Windows certificate apart from the macOS one in CI).

Pick **one** of the two options for Windows. Do not set half of either.

#### Linux

No secrets. `GH_TOKEN` is the workflow's own `github.token`; nothing to create.

### Decisions behind the configuration

- **macOS targets.** `dmg` for the first install and `zip` for auto-update, both for `x64` and `arm64`.
  The `zip` is required: `electron-updater` on macOS downloads the zip, not the dmg. electron-builder
  uploads both archs' files and a single `latest-mac.yml` that lists them (check it in the draft release).
- **`entitlementsInherit`.** It points to the same plist as `entitlements`. A separate inherit plist is only
  needed when the app is sandboxed (then helpers need `com.apple.security.inherit`) or when the helpers
  need fewer rights than the main app. The app is not sandboxed, and the GPU/renderer helpers need
  exactly what the main process does (`allow-jit`), so one file is simpler and cannot drift.
- **Windows architectures.** Only `x64`. `ia32` was removed (32-bit Windows machines are rare and a 32-bit
  build doubles the Windows build and signing time). `arm64` was left out on purpose: Windows on ARM runs the x64 build under
  emulation, the app has no native modules that would break, and a native build doubles the Windows
  build and signing time for a very small audience. Add `arm64` to the `win` targets in
  `electron-builder.mjs` if users ask for it; nothing else needs to change.
- **Linux targets.** `AppImage`, `deb` and `rpm` are kept. Only AppImage updates silently; the `deb`
  and `rpm` updaters of `electron-updater` need `latest-linux.yml` and ask for administrator rights
  (polkit) to install, but they do work, and native packages are what many distro users expect.
  Dropping them would save about a minute of CI and lose that audience, so there is no clear gain.
  Revisit if packaging problems appear.
- **No new GitHub Actions.** Signing and notarization are done by `electron-builder` itself, so
  `release.yml` needs no extra actions (and therefore no extra SHA pins).

### Test a signed build locally

You can do this without CI. Nothing is printed except variable names.

**What would be enabled.** Loading the config prints one `[signing]` line per platform:

```bash
node -e "import('./electron-builder.mjs')"
# [signing] WARNING: macOS notarization is OFF ...
# [signing] WARNING: Windows signing is not configured: ...
```

**macOS.** Install the Developer ID certificate in your login keychain (double-click the `.cer`/`.p12`)
and check `security find-identity -v -p codesigning`. Then:

```bash
# Optional: pick a specific identity. Give the name WITHOUT the "Developer ID Application:" prefix.
export CSC_NAME="Your Name (TEAMID)"
# Optional, to notarize too (a build without these is signed but not notarized):
export APPLE_API_KEY="$HOME/keys/AuthKey_XXXXXXXXXX.p8"   # a path to the .p8 file
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
npm run dist:mac
```

To build **unsigned** on a machine that has a certificate, set `CSC_IDENTITY_AUTO_DISCOVERY=false`.
Verify the result (notarization takes from a few minutes to an hour):

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/JamMan Manager.app"
codesign -d --entitlements - "dist/mac-arm64/JamMan Manager.app"   # only the entitlements in the plist
spctl -a -vvv -t exec "dist/mac-arm64/JamMan Manager.app"          # accepted, source=Notarized Developer ID
xcrun stapler validate "dist/mac-arm64/JamMan Manager.app"
spctl -a -vvv -t install dist/*.dmg
```

Gatekeeper only checks files that carry the quarantine flag, so test the downloaded DMG from the draft
release (or add the flag with `xattr -w com.apple.quarantine "0081;00000000;Safari;" file.dmg`).

**Windows** (on Windows; signing needs Windows tooling).

```powershell
# Option B (pfx)
$env:WIN_CSC_LINK = "C:\keys\certificate.pfx"      # a file path also works locally
$env:WIN_CSC_KEY_PASSWORD = Read-Host "pfx password"
# Option A (Azure): set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and the four AZURE_SIGNING_* variables.
npm run dist:win
Get-AuthenticodeSignature "dist\JamMan Manager-*-win-x64.exe" | Format-List
```

The signature `Status` must be `Valid` and `SignerCertificate` your certificate.

If a **signed macOS build crashes on start** (hardened runtime killing a process), run it from Terminal and
read the crash report in Console. Add back only the entitlement that fixes it and document why in the
"macOS Entitlements" table above.

### Cut a release

```bash
npm version <major|minor|patch> --no-git-tag-version   # bump package.json
git commit -am "Releases vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

`release.yml` then (1) checks that the tag matches `package.json`'s version, (2) creates a **draft**
GitHub release, (3) builds each platform and uploads installers and the `latest*.yml` files to the draft.
Look at the workflow summary for `UNSIGNED` warnings, then review the draft and **publish it**.

### Test auto-update end to end

`electron-updater` only sees **published** releases. A draft release is invisible to it, so publish
`vX` before testing. Two real versions are needed, and the first one must itself be signed, because on
macOS an unsigned (or differently signed) app cannot be updated.

Checklist (the example uses `v0.1.1` and `v0.1.2`; use whatever is next):

1. [ ] All secrets of the platforms you want to test exist (see above). Check the macOS and Windows jobs of
       the first run: no `UNSIGNED` warning, `notarization successful` in the macOS log.
2. [ ] Bump to `0.1.1`, tag `v0.1.1`, push. Wait for the workflow. In the draft, confirm the assets:
       macOS `.dmg` and `.zip` for `x64` and `arm64` plus `latest-mac.yml`; Windows `.exe` installer, the
       portable `.exe` and `latest.yml`; Linux `.AppImage`, `.deb`, `.rpm` and `latest-linux.yml`.
3. [ ] **Publish** the `v0.1.1` release. Download the installer for your platform **from the release** (not
       from the Actions run, so it carries the quarantine/Mark-of-the-Web flag) and install it. - macOS: opens without a Gatekeeper warning; `spctl -a -vvv -t exec "/Applications/JamMan Manager.app"` is accepted. - Windows: the installer shows your publisher name, not "Unknown publisher".
4. [ ] Start the app once and confirm it is `0.1.1` (About / the window title) and that it finds no update.
5. [ ] Close the app. Bump to `0.1.2`, tag `v0.1.2`, push, wait for the workflow, **publish** the release.
6. [ ] Open the installed `0.1.1` app. Within a few seconds the update must download in the background
       and a notification must appear; **quit** the app (or restart when prompted) and open it again:
       it must now be `0.1.2`. If nothing happens, note that `index.ts` creates the updater without a logger
       (`autoUpdater()`), so failures are silent today; pass `logger: log` there to get diagnostics.
7. [ ] Repeat on each platform you ship (AppImage must update silently; `deb`/`rpm` ask for administrator rights).
8. [ ] Delete the test releases and tags afterwards if they should not stay public:
       `gh release delete vX.Y.Z --cleanup-tag`.

**Distribution channels.** `AutoUpdater` sets `updater.channel` from `VITE_DISTRIBUTION_CHANNEL` **at
build time** (Vite inlines it into the main bundle), and today nothing sets it, so the app follows the
default `latest` channel (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`). To ship a separate channel
(for example `beta`) set `VITE_DISTRIBUTION_CHANNEL=beta` in the **Build application** step of
`release.yml` and release with a prerelease version (`0.2.0-beta.1`), so electron-builder writes `beta*.yml`
files next to the `latest*.yml` ones. Check the draft's assets, then test each channel as above with two
versions of each.

### Troubleshooting

| Symptom                                                               | Cause and fix                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS job fails with `Incomplete ...` / Windows `Incomplete ...`      | One secret of a group is missing. Set the whole group or delete the rest.                                                                    |
| `skipped macOS code signing` / `skipped macOS notarization`           | No certificate / no notarization credentials. Expected when the secrets do not exist.                                                        |
| `Please remove prefix "Developer ID Application:"`                    | `CSC_NAME` must be only `Your Name (TEAMID)`.                                                                                                |
| `The specified item could not be found in the keychain` / no identity | The `.p12` was exported without the private key, or is a certificate of another type. Export again with the key.                             |
| Notarization takes long or times out                                  | Check the [Apple system status](https://developer.apple.com/system-status/). Usually minutes, sometimes an hour. Re-run the job.             |
| Notarization `Invalid` with a list of issues                          | `xcrun notarytool log <submission-id> --key ... --key-id ... --issuer ...` lists the files that are not signed or lack the hardened runtime. |
| Windows Azure error `Forbidden` / `401`                               | The app registration lacks the **Trusted Signing Certificate Profile Signer** role, or the endpoint region does not match the account.       |
| Windows: signed but publisher shows another name                      | `AZURE_SIGNING_PUBLISHER_NAME` must be the certificate's common name exactly as in the profile.                                              |
| Users on an unsigned version cannot update to the first signed one    | Expected on macOS: they must install the first signed version by hand once.                                                                  |
| "App is damaged and can't be opened" (unsigned build)                 | `xattr -cr "/Applications/JamMan Manager.app"`, or right-click → Open.                                                                       |

### Security practices

- Secrets only in GitHub Actions secrets. The workflow passes them as environment variables to the single
  step that needs them, never on a command line, and never echoes them. GitHub masks secret values in logs.
- The notarization key is written to the runner's temp directory (mode `600`) only during the macOS job;
  runners are discarded after each job.
- Keep the originals (`.p12`, `.p8`, `.pfx`) in a password manager. Rotate secrets before they expire
  (Developer ID certificates last 5 years, Entra client secrets at most 2) and revoke at once if one leaks:
  revoke the API key in App Store Connect, the certificate in the developer portal, the client secret in Entra ID.
- Restrict who can create tags and edit repository secrets; a tag push is what starts a signed release.

### Resources

- [electron-builder code signing](https://www.electron.build/code-signing)
- [Apple: notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Azure Trusted Signing quickstart](https://learn.microsoft.com/azure/trusted-signing/quickstart)
- [electron-updater](https://www.electron.build/auto-update)

## Cross-Platform Building

### From macOS

- ✅ **macOS** - Native
- ✅ **Windows** - Requires Wine (install via `brew install wine-stable`)
- ✅ **Linux** - Supported via Docker

### From Windows

- ⚠️ **macOS** - Not supported (requires macOS)
- ✅ **Windows** - Native
- ✅ **Linux** - Supported via Docker

### From Linux

- ⚠️ **macOS** - Not supported (requires macOS)
- ✅ **Windows** - Requires Wine
- ✅ **Linux** - Native

## Troubleshooting

### Build Fails with "Cannot find module"

Ensure all dependencies are installed:

```bash
npm install
npm run build
```

### macOS: "App is damaged and can't be opened"

This happens with unsigned apps downloaded from the internet. Users can fix this by:

```bash
xattr -cr "/Applications/JamMan Manager.app"
```

Or right-click → Open → Open anyway

### Windows: SmartScreen Warning

Unsigned Windows apps trigger SmartScreen warnings. Users can click "More info" → "Run anyway".

To avoid this, sign the installers: see [Code signing and releases](#code-signing-and-releases).

### Linux: AppImage won't execute

Make the AppImage executable:

```bash
chmod +x "JamMan Manager-*.AppImage"
```

## Development Build

For development, use:

```bash
npm start
```

This starts the app in development mode with hot reload.

## Production Build (No Installer)

To build the app without creating installers:

```bash
npm run compile
```

This creates an unpacked app in `dist/` directory that can be run directly.

## Clean Build

To clean previous builds:

```bash
rm -rf dist/
npm run dist
```

## CI/CD Integration

The repository ships two workflows in `.github/workflows/`:

- **`ci.yml`** runs on every pull request to `main` and every push to `main`. It
  type-checks, lints, checks formatting and audits production dependencies
  (`npm audit --omit=dev --audit-level=high`) on Ubuntu, then builds and runs the
  unit tests on Ubuntu, macOS and Windows. Every step is blocking.
- **`release.yml`** runs when a `v*` tag is pushed. It checks that the tag matches
  the `version` in `package.json`, creates a draft GitHub release, and each
  platform job runs `electron-builder --publish always` to upload the installers
  and the `latest*.yml` auto-update metadata to that draft. Review the draft and
  publish it manually.

All actions are pinned to a commit SHA (with the version in a trailing comment) and
Node is read from `.nvmrc`. Dependabot keeps them up to date.

Releases are cut as described in [Code signing and releases](#code-signing-and-releases), which also
lists the secrets `release.yml` reads. Without them the installers are built unsigned.

## File Size Optimization

To reduce installer size:

1. **Remove devDependencies** from production build (already configured)
2. **Compress with maximum compression**:
   ```js
   // In electron-builder.mjs
   compression: 'maximum';
   ```
3. **Use ASAR archives** (enabled by default)
4. **Remove source maps** from production builds

## Support

For build issues, check:

- [Electron Builder Documentation](https://www.electron.build/)
- [Project Issues](https://github.com/RenanDiaz/jamman-manager/issues)

## Version Management

Update version in `package.json`:

```json
{
  "version": "1.0.0"
}
```

Version is automatically used in installer filenames.

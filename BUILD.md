# Building JamMan Manager

This guide explains how to build distributable installers for JamMan Manager on different platforms.

## Prerequisites

- **Node.js** >= 23.0.0
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

# Windows (NSIS installer + Portable for x64 and x86)
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
- `JamMan Manager-{version}-win-ia32.exe` - NSIS installer for 32-bit Windows
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

## Code Signing

Code signing is **critical for security and user trust**. It verifies that your app comes from a known developer and hasn't been tampered with.

### Why Code Signing Matters

- **Security**: Prevents malware from impersonating your app
- **User Trust**: Removes scary security warnings during installation
- **Platform Requirements**: Required for distribution on macOS App Store, Microsoft Store
- **Automatic Updates**: Many update frameworks require signed apps
- **Notarization**: Required for macOS Gatekeeper (macOS 10.15+)

### ⚠️ Security Warning

**Never commit certificates or private keys to version control!**

- Use environment variables for sensitive data
- Store certificates securely (e.g., encrypted vault, CI/CD secrets)
- Rotate certificates before expiration
- Revoke certificates immediately if compromised

---

### macOS Code Signing

#### Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at [developer.apple.com](https://developer.apple.com)

2. **Developer ID Application Certificate**
   - Log in to [developer.apple.com/account](https://developer.apple.com/account)
   - Navigate to **Certificates, Identifiers & Profiles**
   - Click **+** to create a new certificate
   - Select **Developer ID Application**
   - Follow instructions to generate CSR (Certificate Signing Request)
   - Download and install certificate in Keychain Access

#### Signing Process

1. **Verify Certificate Installation**

   ```bash
   security find-identity -v -p codesigning
   ```

   You should see your "Developer ID Application" certificate listed.

2. **Set Environment Variables**

   ```bash
   export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
   # Optional: Specify keychain if not using default
   export CSC_KEYCHAIN="/path/to/keychain"
   ```

3. **Build Signed App**

   ```bash
   npm run dist:mac
   ```

4. **Verify Signature**
   ```bash
   codesign -dv --verbose=4 dist/mac/JamMan\ Manager.app
   spctl -a -vv dist/mac/JamMan\ Manager.app
   ```

#### Notarization (Required for macOS 10.15+)

Notarization proves to Apple that your app doesn't contain malicious content.

1. **Generate App-Specific Password**
   - Go to [appleid.apple.com](https://appleid.apple.com)
   - Sign in and navigate to **Security**
   - Generate an app-specific password

2. **Set Notarization Credentials**

   ```bash
   export APPLE_ID="your-apple-id@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="TEAMID123"
   ```

3. **Add to electron-builder.mjs**

   ```js
   mac: {
     hardenedRuntime: true,
     gatekeeperAssess: false,
     entitlements: "buildResources/entitlements.mac.plist",
     entitlementsInherit: "buildResources/entitlements.mac.plist",
     notarize: {
       teamId: process.env.APPLE_TEAM_ID
     }
   }
   ```

4. **Build with Notarization**

   ```bash
   npm run dist:mac
   ```

   electron-builder will automatically:
   - Sign the app
   - Upload to Apple for notarization
   - Staple the notarization ticket
   - Create the final DMG

5. **Verify Notarization**
   ```bash
   spctl -a -vvv -t install dist/*.dmg
   # Should output: "accepted"
   ```

#### Troubleshooting macOS Signing

**"No identity found" error:**

```bash
# Check certificates
security find-identity -v -p codesigning

# Import certificate if missing
security import certificate.p12 -k ~/Library/Keychains/login.keychain-db
```

**Notarization timeout:**

- Check [Notary API status](https://developer.apple.com/system-status/)
- Notarization can take 5-60 minutes
- Use `--trace` flag to see detailed logs

**"App is damaged" warning:**

```bash
# Remove quarantine attribute
xattr -dr com.apple.quarantine "/Applications/JamMan Manager.app"
```

---

### Windows Code Signing

#### Prerequisites

1. **Code Signing Certificate**

   Purchase from a Certificate Authority (CA):
   - [DigiCert](https://www.digicert.com/signing/code-signing-certificates) ($400-800/year)
   - [Sectigo](https://sectigo.com/ssl-certificates-tls/code-signing) ($200-500/year)
   - [GlobalSign](https://www.globalsign.com/en/code-signing-certificate) ($250-600/year)

   **Certificate Types:**
   - **Standard**: For individual developers or small teams
   - **EV (Extended Validation)**: Builds reputation faster, no SmartScreen warnings initially
   - **Hardware Token**: Most secure, required for EV certificates

2. **Install Certificate**
   - Export certificate as `.pfx` (PKCS#12) format with private key
   - Password-protect the `.pfx` file
   - Store securely (never commit to repository!)

#### Signing Process

1. **Set Environment Variables**

   ```bash
   # Windows (PowerShell)
   $env:CSC_LINK = "C:\path\to\certificate.pfx"
   $env:CSC_KEY_PASSWORD = "your_password"

   # Windows (CMD)
   set CSC_LINK=C:\path\to\certificate.pfx
   set CSC_KEY_PASSWORD=your_password

   # macOS/Linux (cross-compiling)
   export CSC_LINK=/path/to/certificate.pfx
   export CSC_KEY_PASSWORD=your_password
   ```

   **🔒 Security Best Practice:**

   ```bash
   # Store password in secure credential manager instead
   # Windows Credential Manager, macOS Keychain, or CI/CD secrets
   ```

2. **Build Signed Installer**

   ```bash
   npm run dist:win
   ```

3. **Verify Signature**

   ```powershell
   # PowerShell
   Get-AuthenticodeSignature dist\*.exe | Format-List

   # Or use signtool (part of Windows SDK)
   signtool verify /pa dist\*.exe
   ```

#### Timestamping

**Always use timestamping** to ensure signatures remain valid after certificate expiration.

Add to `electron-builder.mjs`:

```js
win: {
  sign: async (configuration) => {
    // Custom signing with timestamp
    await require('electron-builder-sign-windows').default(configuration);
  },
  signingHashAlgorithms: ['sha256'],
  certificateSubjectName: "Your Company Name", // Optional: auto-select cert
  rfc3161TimeStampServer: "http://timestamp.digicert.com"
}
```

#### SmartScreen Reputation

**New certificates trigger SmartScreen warnings.** To build reputation:

1. **EV Certificates**: Start with higher reputation
2. **Regular Downloads**: More downloads = better reputation
3. **Time**: Can take weeks/months to build reputation
4. **No Complaints**: Avoid malware/adware detection
5. **Consistent Signing**: Use same certificate for all releases

#### Troubleshooting Windows Signing

**"Cannot find signing certificate" error:**

```bash
# Check certificate is valid and in Windows Certificate Store
certutil -store My

# Or specify exact subject name
export WIN_CSC_SUBJECT_NAME="Your Company Name"
```

**"Timestamp server error":**

```js
// Try different timestamp servers
rfc3161TimeStampServer: 'http://timestamp.comodoca.com';
// or
rfc3161TimeStampServer: 'http://timestamp.sectigo.com';
```

---

### CI/CD Code Signing

#### GitHub Actions Example

```yaml
name: Build and Sign

on:
  push:
    tags:
      - 'v*'

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '23'

      - name: Install dependencies
        run: npm install

      - name: Import macOS Certificate
        env:
          MACOS_CERTIFICATE: ${{ secrets.MACOS_CERTIFICATE }}
          MACOS_CERTIFICATE_PWD: ${{ secrets.MACOS_CERTIFICATE_PWD }}
        run: |
          echo $MACOS_CERTIFICATE | base64 --decode > certificate.p12
          security create-keychain -p actions build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p actions build.keychain
          security import certificate.p12 -k build.keychain -P $MACOS_CERTIFICATE_PWD -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k actions build.keychain

      - name: Build and Sign
        env:
          CSC_NAME: ${{ secrets.CSC_NAME }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run dist:mac

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-installers
          path: dist/*.dmg

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '23'

      - name: Install dependencies
        run: npm install

      - name: Import Windows Certificate
        env:
          WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
          WINDOWS_CERTIFICATE_PWD: ${{ secrets.WINDOWS_CERTIFICATE_PWD }}
        run: |
          echo "$env:WINDOWS_CERTIFICATE" | Out-File -FilePath certificate.b64
          certutil -decode certificate.b64 certificate.pfx

      - name: Build and Sign
        env:
          CSC_LINK: certificate.pfx
          CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PWD }}
        run: npm run dist:win

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-installers
          path: dist/*.exe
```

#### Required GitHub Secrets

**macOS:**

- `MACOS_CERTIFICATE` - Base64-encoded .p12 certificate
- `MACOS_CERTIFICATE_PWD` - Certificate password
- `CSC_NAME` - Certificate common name
- `APPLE_ID` - Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - 10-character Team ID

**Windows:**

- `WINDOWS_CERTIFICATE` - Base64-encoded .pfx certificate
- `WINDOWS_CERTIFICATE_PWD` - Certificate password

---

### Security Best Practices

#### Certificate Storage

✅ **DO:**

- Store certificates in encrypted vaults (1Password, LastPass, etc.)
- Use CI/CD secret management (GitHub Secrets, GitLab Variables)
- Use hardware security modules (HSM) for EV certificates
- Rotate certificates before expiration
- Use separate certificates for dev/staging/production

❌ **DON'T:**

- Commit certificates to version control
- Share certificates via email/Slack
- Store passwords in plaintext
- Reuse same certificate across projects
- Ignore certificate expiration warnings

#### Access Control

- Limit who can access signing certificates
- Use separate certificates per developer/team
- Implement audit logging for certificate usage
- Revoke certificates when team members leave

#### Monitoring

- Set calendar reminders for certificate expiration (90 days before)
- Monitor code signing failures in CI/CD
- Track SmartScreen reputation (Windows)
- Verify signatures after each release

---

### Certificate Costs Summary

| Platform | Type         | Annual Cost | Reputation Time    |
| -------- | ------------ | ----------- | ------------------ |
| macOS    | Developer ID | $99         | Immediate          |
| Windows  | Standard     | $200-800    | 2-6 months         |
| Windows  | EV           | $400-1200   | Faster (2-4 weeks) |

**Total Annual Cost:** $300-2000+ depending on certificate types

---

### Testing Signed Builds

#### macOS

```bash
# Verify code signature
codesign -dv --verbose=4 "JamMan Manager.app"

# Verify notarization
spctl -a -vv "JamMan Manager.app"

# Check entitlements
codesign -d --entitlements - "JamMan Manager.app"

# Test Gatekeeper
xattr -d com.apple.quarantine "JamMan Manager.app"
open "JamMan Manager.app"
```

#### Windows

```powershell
# Verify signature
Get-AuthenticodeSignature "JamMan Manager.exe" | Format-List

# Check timestamp
signtool verify /v /pa "JamMan Manager.exe"

# Test SmartScreen
# Download from internet and run - should show publisher name
```

---

### Resources

- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Apple Notarization Overview](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Microsoft Code Signing](https://docs.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [SmartScreen Reputation](https://docs.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview)

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

To avoid this, obtain a code signing certificate.

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

Example GitHub Actions workflow for automated builds:

```yaml
name: Build Installers

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '23'

      - run: npm install
      - run: npm run dist

      - uses: actions/upload-artifact@v3
        with:
          name: installers-${{ matrix.os }}
          path: dist/*
```

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

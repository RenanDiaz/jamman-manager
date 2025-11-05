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

### macOS

To properly sign the macOS app (removes "unidentified developer" warning):

1. Obtain an **Apple Developer ID Certificate**
2. Install it in your Keychain
3. Update environment variables:
   ```bash
   export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
   ```
4. Build: `npm run dist:mac`

### Windows

To sign Windows executables:

1. Obtain a **Code Signing Certificate** (.pfx file)
2. Set environment variables:
   ```bash
   export CSC_LINK=/path/to/certificate.pfx
   export CSC_KEY_PASSWORD=your_password
   ```
3. Build: `npm run dist:win`

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

# JamMan Manager

JamMan Manager is a desktop app that allows musicians to manage loops on their Digitech JamMan Stereo looper pedal using an SD card. Built with Electron, React, and TypeScript, it provides a clean and powerful interface to view, create, edit, reorder, and delete JamMan patches and their phrase data.

![Screenshot Placeholder](screenshot.png)

## ✨ Features

- 🔍 View all patches and phrases from the SD card
- 📝 Edit patch metadata: name, rhythm type, stop mode
- 🎵 Edit phrase metadata: BPM, time signature, loop type, reverse, etc.
- 🎧 Audio playback with real-time preview of phrases
- 📁 Import WAV files into phrases with validation
- ➕ Create new patches and phrases
- ✏️ Rename and reorder patches with drag-and-drop
- ☑️ Multi-select functionality for batch operations
- 🗑 Delete patches safely with automatic backups
- 🔒 File locking to prevent concurrent operation conflicts
- ⚡ Priority-based operation queue for optimal performance
- 💽 Compatible with JamMan Stereo's SD card structure

## 🚀 Installation

### Requirements

- Node.js >= 23.0.0

### Running Locally

```bash
npm install
npm start
```

### Building a Distributable

```bash
npm run compile
```

This will create platform-specific installers (DMG for macOS, NSIS for Windows, AppImage for Linux).

## 🏗️ Architecture

JamMan Manager uses Electron's multi-process architecture with three main components:

### Main Process (`packages/main`)

The Node.js process that manages the application lifecycle, native OS integration, and secure file system operations. Key modules:

- **WindowManager** - Creates and manages the browser window with custom icon
- **IpcHandlers** - Exposes secure IPC endpoints for file operations
- **FileSystem** - Direct access to SD card with safety checks and rollback support

### Renderer Process (`packages/renderer`)

The Chromium-based UI process running React 19. Communicates with the main process only through the preload bridge. Key components:

- **MainView** - Primary patch list with multi-select and drag-and-drop
- **PatchEditor** - Edit patch metadata and phrases
- **PlaylistsModal** - Virtual playlist management with reordering
- **BackupRestoreModal** - Backup/restore system with ZIP format

### Preload Script (`packages/preload`)

The security bridge that exposes a safe, limited API from main to renderer via `contextBridge`. All file operations go through this layer to prevent arbitrary code execution in the renderer.

```
┌─────────────────┐
│  Renderer (UI)  │
│   React + TS    │
└────────┬────────┘
         │ IPC via contextBridge
┌────────▼────────┐
│  Preload Bridge │
│  (Security)     │
└────────┬────────┘
         │ Exposed APIs
┌────────▼────────┐
│  Main Process   │
│  Node.js + FS   │
└─────────────────┘
```

### State Management

- **Zustand** store provides centralized state for patches, playlists, and operations
- **Operation Queue** serializes file operations with priority levels (high/normal/low)
- **File Locking** prevents concurrent modifications using lock files
- **Automatic Rollback** on operation failures using backup mechanism

## 📁 Project Structure

```
jamman-manager/
├── packages/
│   ├── main/           # Electron main process
│   │   ├── src/
│   │   │   ├── modules/        # Core modules (WindowManager, etc.)
│   │   │   ├── ipc-handlers/   # IPC API implementations
│   │   │   └── index.ts        # Entry point
│   │   └── vite.config.js
│   ├── preload/        # Preload security bridge
│   │   ├── src/
│   │   │   └── index.ts        # contextBridge API exposure
│   │   └── vite.config.js
│   └── renderer/       # React UI application
│       ├── src/
│       │   ├── components/     # React components
│       │   ├── store/          # Zustand state management
│       │   ├── types/          # TypeScript definitions
│       │   └── main.tsx        # React entry point
│       ├── public/             # Static assets (icon, etc.)
│       ├── index.html          # HTML shell
│       └── vite.config.js
├── buildResources/     # Icons and build assets
├── tests/              # E2E tests (Playwright)
├── electron-builder.mjs  # Multi-platform build config
└── package.json        # Root dependencies and scripts
```

## 🛠 Technologies Used

### Core

- **Electron** - Desktop application framework
- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server

### UI & Styling

- **Bootstrap 5** + **Reactstrap** - Component library
- **Styled Components** - CSS-in-JS styling
- **React Toastify** - Toast notifications
- **@dnd-kit** - Drag and drop functionality

### State & Data Management

- **Zustand** - State management
- **fs-extra** - Enhanced file system operations
- **xml2js** - XML parsing for patch files
- **music-metadata** - Audio file metadata parsing

### Development & Testing

- **Vitest** - Unit testing framework
- **Playwright** - E2E testing
- **ESLint** + **Prettier** - Code quality and formatting
- **electron-log** - Application logging

## 🔌 IPC API

The preload script exposes a safe API for renderer-to-main communication:

### File Operations

- `selectFolder()` - Open native folder picker dialog
- `readFolder(path)` - Read JamMan patches from folder
- `savePatch(patchPath, data)` - Update patch XML
- `deletePatch(patchPath)` - Delete patch with backup
- `renamePatch(oldPath, newPath)` - Rename patch directory

### Playlist Operations

- `loadPlaylists(folderPath)` - Load playlist metadata
- `savePlaylist(folderPath, playlist)` - Save playlist changes
- `deletePlaylist(folderPath, id)` - Remove playlist

### Backup/Restore

- `createBackup(folderPath, patchIds?, backupPath?)` - Create ZIP backup
- `restoreBackup(backupPath, targetPath, mode)` - Restore from backup

### Audio

- `getAudioPath(phrasePath)` - Get file:// URL for audio playback

All IPC calls return `Promise<Result<T, Error>>` for safe error handling.

## 🧠 Why?

Digitech discontinued official support for managing loops on the JamMan Stereo. This app helps you keep control of your loop library with a modern interface — no MIDI, no syncing, just drag, drop, and play.

## 📂 SD Card Structure

This app works directly with the expected JamMan directory structure:

```
/JAMMAN/JamManStereo/
  Patch01/
    patch.xml
    PhraseA/
      phrase.wav
      phrase.xml
```

## 📄 License

MIT License
© 2025 Renán Gabriel Díaz Reyes

---

Made with ❤️ by a bassist and dev 🤘

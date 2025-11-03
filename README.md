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

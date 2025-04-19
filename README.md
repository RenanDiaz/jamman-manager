# JamMan Manager

JamMan Manager is a desktop app that allows musicians to manage loops on their Digitech JamMan Stereo looper pedal using an SD card. Built with Electron, React, and TypeScript, it provides a clean and powerful interface to view, create, edit, reorder, and delete JamMan patches and their phrase data.

![Screenshot Placeholder](screenshot.png)

## ✨ Features

- 🔍 View all patches and phrases from the SD card
- 📝 Edit patch metadata: name, rhythm type, stop mode
- 🎵 Edit phrase metadata: BPM, time signature, loop type, reverse, etc.
- 📁 Import WAV files into phrases
- ➕ Create new patches and phrases
- ✏️ Rename and reorder patches
- 🗑 Delete patches safely
- 💽 Compatible with JamMan Stereo's SD card structure

## 🚀 Installation

To run the app locally:

```bash
npm install
npm start
```

To build a distributable installer:

```bash
npm run compile
```

## 🛠 Technologies Used

- Electron
- React
- TypeScript
- Vite
- Bootstrap (via Reactstrap)
- fs-extra + xml2js

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
© 2024 Renán Gabriel Díaz Reyes

---

Made with ❤️ by a bassist and dev 🤘

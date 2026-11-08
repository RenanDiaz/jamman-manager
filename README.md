# JamMan Manager

A desktop app for managing the loops on a Digitech JamMan Stereo looper pedal. Play, create, edit, reorder, back up and delete patches, and keep setlists, either from the pedal's SD card in a card reader or with the pedal itself connected over USB, card and internal memory included. Over USB the app also follows the pedal live: it shows which patch you are on as you step through them with your foot.

Built with Electron, React and TypeScript. Runs on macOS, Windows and Linux.

![JamMan Manager showing three patches on a card, with Patch02 open in the detail panel and its first phrase playing](docs/images/main-screen.png)

> There is no published release yet. To use the app, [build it from source](#build-installers).

## What it does

- **See a whole card or bank.** A memory map of the 99 slots, the patch list with tempo, loop and reverse at a glance, and a detail panel for the selected patch.
- **Play phrases** from any patch row or the detail panel, with a player for seek and volume.
- **Create and edit patches.** Name, rhythm (the pedal's 10 rhythms, from Off to Tambourine), stop mode (Stop, Finish or Fade) and phrases. Each phrase has a WAV file, BPM, beats per bar, loop and reverse.
- **Delete** one patch or a selection.
- **Undo and redo** deletes, edits, reorders and restores with ⌘Z and ⇧⌘Z (Ctrl+Z and Ctrl+Shift+Z on Windows and Linux).
- **Reorder** patches by dragging them, or sort by name, slot, tempo or in reverse. Applying the order renumbers the folders from Patch01.
- **Playlists**: group patches into setlists, reorder them, export a setlist as text, and move a setlist to the first slots.
- **Back up and restore** everything or only the selected patches as a ZIP file. Restore can merge with the patches already there or replace them.
- **Export** the patch list as TXT or PDF.
- **Work with the pedal over USB**, without taking the card out: its internal memory and its SD card, with everything above.
- **Follow the pedal live** over USB: the patch loaded on the pedal, whether it is loading, and whether the SD card is in. Before changing the patch the pedal is using, the app asks, and the pedal then reloads it so it plays the new version.
- **Set the footswitch buttons** of the pedal (undo/redo, reverse, tempo).
- **Reopen** the last card folder you used when the app starts.

## Using it with the pedal

The JamMan Stereo stores each patch as a folder with an XML file and one folder per phrase, both in its internal memory and on the SD card:

```
JamManStereo/
├── Patch01/
│   ├── patch.xml
│   ├── PhraseA/
│   │   ├── phrase.xml
│   │   └── phrase.wav
│   └── PhraseB/
│       └── ...
├── Patch02/
└── ...
```

There are two ways to reach them. Use a card reader for large transfers (a whole 4 GB card), and USB for everything else, without moving the card.

### With a card reader

1. Put the SD card in your computer.
2. Click **Load patches** and pick the folder that contains `Patch01`, `Patch02`, and so on.
3. When you're done, eject the card before putting it back in the pedal.

The app only reads and writes inside the folder you pick, plus any WAV or backup file you choose in a file dialog.

### Over USB

Leave the card in the pedal and connect the pedal to the computer with a USB cable. The pedal does not show up as a drive; the app talks to it directly.

1. Turn the pedal on and connect it with a USB cable.
2. Click **Pedal** and open **Internal memory** or **SD card**.
3. Everything works as with a card: play, create, edit, sort, delete, playlists, backups and restores, with undo and redo.

What is different over USB:

- **Audio moves at about 1.3 MB per second** from the pedal and 1.5 MB per second to it. Playback streams, so it starts right away; a WAV played to the end is cached on this computer until it changes on the pedal. Uploads and downloads show progress and can be stopped.
- **Backups download the audio first**, and the **Audio** key in the pedal dialog downloads a whole bank ahead of time; both resume where they stopped. A full card takes about 50 minutes, so for that the app recommends a card reader.
- **Undo never moves audio twice**: audio an undo may need is kept on the pedal itself until it can no longer be undone, and is freed when you disconnect.
- **The app follows the pedal**: the patch loaded on the pedal is marked "On pedal" and changes as you step through patches with your foot, and the header shows it. Before changing that patch, or while the pedal holds an unsaved recording, the app asks first; afterwards the pedal reloads the patch, so it plays the new version without switching patches.
- **The pedal dialog** shows both banks with their free space, downloads a bank's audio, sets what each footswitch button does (the pedal keeps it when turned off), and disconnects.

The USB protocol, and what was learned about the pedal while testing it, is documented in [docs/usb-protocol.md](docs/usb-protocol.md).

### WAV files

When you add a phrase, the app copies your WAV file to the card (or uploads it to the pedal) as it is. It does not convert it. Use 16-bit, 44.1 kHz WAV files (mono or stereo). Before playback the app checks that format and warns you if a file doesn't match.

## Development

### Requirements

- Node.js 24 or later. The version is in `.nvmrc`; with nvm, run `nvm use`.
- npm, which comes with Node.js. The repository uses npm workspaces.

### Run the app

```bash
npm install
npm start
```

`npm start` runs the renderer on the Vite dev server with hot reload and rebuilds the main and preload processes when they change.

### Build installers

```bash
npm run compile
```

This builds the app and packages it for the current platform into `dist/`:

| Platform | Output                               | Architectures |
| -------- | ------------------------------------ | ------------- |
| macOS    | DMG and ZIP                          | x64, arm64    |
| Windows  | NSIS installer and a portable `.exe` | x64           |
| Linux    | AppImage, `.deb` and `.rpm`          | x64           |

`npm run dist:mac`, `dist:win`, `dist:linux` and `dist:all` target a specific platform. [BUILD.md](BUILD.md) covers signing, notarization and releases.

### Checks

| Command                                                                                      | What it does                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm run verify`                                                                             | Typecheck, lint and unit tests                              |
| `npm test`                                                                                   | Unit tests (Vitest)                                         |
| `npm run test:e2e`                                                                           | End-to-end tests (Playwright) against the app in `dist/`    |
| `npm run format` / `npm run format:check`                                                    | Format the repository with Prettier, or only check it       |
| `JAMMAN_USB=1 npx vitest run --no-file-parallelism packages/main/src/usb/*.hardware.test.ts` | Hardware tests against a JamMan connected over USB (opt-in) |

The end-to-end tests launch the packaged app, so run `npm run compile` first. They use a small synthetic SD card in [`tests/fixtures`](tests/fixtures/README.md) and never touch a real card. The unit tests drive the USB code against an in-memory fake pedal that reproduces the real one's limits; the hardware tests only read from a real pedal, or write in a sandbox folder they delete afterwards.

Husky runs `lint-staged` (Prettier) before each commit and `npm run verify` before each push. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) builds the app and runs the unit tests on macOS, Windows and Linux. It also runs the typecheck, lint, a format check and a production dependency audit, and runs the end-to-end tests on Linux. All of it must pass before merging into `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## Architecture

The app follows Electron's three-process model. The renderer has no Node.js access: everything it does on disk or with the pedal goes through a typed IPC contract.

```
┌──────────────────────┐
│  Renderer            │  React 19, Zustand, CSS Modules
└──────────┬───────────┘
           │  window.electronAPI (contextBridge)
┌──────────▼───────────┐
│  Preload             │  Typed IPC contract
└──────────┬───────────┘
           │  ipcRenderer.invoke / ipcMain.handle
┌──────────▼───────────┐
│  Main                │  File system, pedal over USB, dialogs, backups, audio
└──────────────────────┘
```

### Main process (`packages/main`)

- **`ipc/`**: one handler file per area (patches, audio, backup, playlists, export, undo, dialogs), registered in `ipc/register.ts`.
- **`OperationQueue`**: runs file operations one at a time, with high, normal and low priorities.
- **`LockManager`**: an in-memory lock per patch folder, so two operations never write the same patch at once.
- **Recovering from failures**: a deleted patch is kept aside for 5 seconds before it's removed, a reorder that fails part-way renames the folders back, and edits, deletes and restores take a snapshot that Undo can bring back.
- **`BackupManager`** and **`PlaylistManager`**: ZIP backups and the playlists stored in `.jamman-playlists.json` on the card.
- **`modules/`**: window management, single instance, auto-updates and other app-level behaviour.
- **`usb/`**: the pedal over USB, live (nothing is mirrored; the only local state is a cache of downloaded WAVs).
  - `greenglassCodec` and `GreenglassClient` speak the pedal's protocol over the serial port (`serialport`): one request at a time, notifications passed on as events, and a resync for a pedal left mid-frame.
  - `PedalFiles` builds file operations from the protocol's primitives, behind a guard that only allows patch folders, the playlists file and the app's work folder.
  - `PedalEditor` creates, edits, deletes and reorders patches and keeps the undo data on the pedal.
  - `PedalManager` connects, reads patches, streams audio, downloads, backs up and restores banks, follows the pedal's live state and makes it reload a patch it is using.
  - Handlers that take a folder path accept `jamman-pedal://<bank>` for a pedal bank; any channel that does not know about pedals refuses such a path in `ipc/register.ts`.

### Preload (`packages/preload`)

[`ipc-contract.ts`](packages/preload/src/ipc-contract.ts) defines every channel, its arguments and its result. Both sides are typed from it, so the API listed there is the source of truth. The preload exposes it as `window.electronAPI`, grouped like this:

- **Dialogs**: pick the card folder, a WAV file or a backup file.
- **Patches**: read, create, update, delete (one or a batch), reorder, export as TXT or PDF.
- **Audio**: get a playable URL for a phrase, check a WAV file's format, read a WAV file.
- **Backups**: create, validate and restore.
- **Undo**: create, restore and discard snapshots.
- **Playlists**: load, create, update, delete, add and remove patches, reorder, export.
- **Pedal**: connect, disconnect, status, how much audio is cached, download a bank's audio, stop a long operation, set a footswitch button; events when the pedal changes and for transfer progress.

### Renderer (`packages/renderer`)

- **`components/`**: the screens (header, memory map, patch list and detail, player, dialogs, sort view).
- **`ui/`**: the reusable components of the "Pedal" design system: panels, keys, LEDs, the seven-segment display, form controls, dialogs. The tokens and rules are in [design/DESIGN.md](design/DESIGN.md).
- **`store/`**: Zustand stores for the patches, the audio player, the undo history, the pedal and the question asked before changing a patch the pedal is using.

### Security

- The renderer runs sandboxed, with context isolation and a strict Content Security Policy.
- The main process only accepts IPC calls from the app's own window.
- File access is limited to the folder you picked and to the files you chose in a dialog.
- On the pedal, writes are limited to patch folders, the playlists file and the app's own work folder. Its internal memory also holds the pedal's software and settings, which the app never touches.
- Audio plays through a custom `jamman://` protocol instead of `file://` URLs. See [ADR 0001](docs/adr/0001-jamman-protocol.md).
- Patch and phrase XML is parsed with external entities and DTDs disabled.

## Project structure

```
jamman-manager/
├── packages/
│   ├── main/               # Electron main process
│   │   └── src/
│   │       ├── ipc/        # IPC handlers by area
│   │       ├── modules/    # Window, updates, single instance…
│   │       ├── security/   # CSP, folder access, jamman:// protocol
│   │       ├── usb/        # The pedal over USB
│   │       └── index.ts
│   ├── preload/            # contextBridge and the IPC contract
│   ├── renderer/           # React UI
│   │   └── src/
│   │       ├── components/ # Screens
│   │       ├── ui/         # Design system components
│   │       ├── store/      # Zustand stores
│   │       └── styles/     # Design tokens
│   ├── electron-versions/  # Shared Electron/Chrome/Node targets
│   └── dev-mode.js         # `npm start`
├── tests/                  # E2E tests (Playwright) and the synthetic SD card
├── tools/                  # greenglass.py: talk to the pedal from a terminal
├── design/                 # DESIGN.md, mockups and icon options
├── docs/                   # ADRs, specs and policies
├── buildResources/         # App icon and macOS entitlements
└── electron-builder.mjs    # Packaging config
```

## Tech stack

- **App:** Electron, React 19, TypeScript, Vite
- **UI:** CSS Modules with design tokens, Barlow and Barlow Condensed (bundled with @fontsource), dnd-kit for drag and drop, React Toastify
- **State:** Zustand
- **Files:** fs-extra, xml2js, adm-zip (backups), pdfkit (PDF export), music-metadata (WAV checks)
- **Pedal:** serialport (USB serial)
- **App services:** electron-log, electron-updater
- **Tooling:** Vitest, Playwright, ESLint, Prettier, Husky, lint-staged

Dependencies follow [docs/dependency-policy.md](docs/dependency-policy.md).

## Why?

Digitech discontinued official support for managing loops on the JamMan Stereo, and its JamManager software no longer runs on current systems. This app helps you keep control of your loop library with a modern interface, from a card reader or straight over USB: no MIDI, just drag, drop and play.

## License

MIT License. See [LICENSE](LICENSE).
© 2025 Renán Gabriel Díaz Reyes

---

Made with ❤️ by a bassist and dev 🤘

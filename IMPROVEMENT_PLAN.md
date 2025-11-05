# JamMan Manager - Comprehensive Improvement Plan

Based on the codebase analysis, here's a prioritized improvement plan:

## 📊 Project Overview

**JamMan Manager** is a well-structured Electron desktop application for managing Digitech JamMan Stereo looper pedal patches. The codebase (~2,500 lines) demonstrates solid architecture with plugin-based modules, TypeScript throughout, and clean separation of concerns.

**Key Strengths:**

- ✅ Security-first design with context isolation
- ✅ Modern ESM architecture throughout
- ✅ Clean modular plugin system
- ✅ Strong type safety with TypeScript

---

## 🎯 Improvement Areas (Prioritized)

### **Priority 1: Critical Reliability & Robustness**

#### 1. **Error Handling & Recovery**

**Current Issues:**

- IPC handlers lack try-catch wrappers
- File operations could fail silently
- No user-friendly error recovery

**Improvements:**

- Add comprehensive error boundaries in IPC handlers
- Implement retry logic for file operations
- Add user-friendly error messages with actionable steps
- Log errors to file for debugging
- Add rollback capability for failed operations

**Files to Update:**

- `packages/main/src/index.ts` (IPC handlers)
- `packages/renderer/src/App.tsx` (error boundaries)

#### 2. **File System Race Conditions & Data Integrity**

**Current Issues:**

- Patch reordering could fail mid-operation
- No file locking mechanism
- Concurrent operations could cause corruption

**Improvements:**

- Implement atomic operations with rollback
- Add file locking for critical operations
- Create backup before destructive operations
- Add data validation before write operations
- Implement operation queue to prevent concurrency issues

#### 3. **Audio Playback Reliability**

**Current Issues:**

- MediaError code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED) occurs frequently when playing WAV files
- Error: "FFmpegDemuxer: data source error" suggests protocol handling issues
- Custom `jamman://` protocol may not be properly serving files
- No fallback or retry mechanism for failed audio loads

**Improvements:**

- Investigate and fix custom protocol file serving
- Add proper error handling with user-friendly messages
- Implement retry logic for failed audio loads
- Consider alternative approaches (e.g., streaming from file:// with proper permissions)
- Add audio format validation before attempting playback
- Implement proper audio element lifecycle management
- Add loading states while audio is being prepared

**Files to Update:**

- `packages/main/src/index.ts` (protocol registration)
- `packages/renderer/src/components/PhrasePlayer/index.tsx` (audio playback logic)

---

### **Priority 2: Testing & Quality Assurance**

#### 4. **Comprehensive Testing Suite**

**Current Gap:** Only E2E test scaffolding exists, no actual tests

**Improvements:**

- **Unit Tests:**
  - XML parsing functions
  - File operation utilities
  - Audio validation logic
  - Patch/phrase CRUD operations

- **Integration Tests:**
  - IPC communication flows
  - Multi-step workflows (create → edit → delete)
  - Drag-and-drop reordering

- **E2E Tests:**
  - Complete user workflows
  - Cross-platform compatibility
  - Error recovery scenarios

**Suggested Tools:**

- Vitest for unit/integration tests
- Playwright (already configured) for E2E
- Mock filesystem for isolated testing

---

### **Priority 3: Performance & Scalability**

#### 5. **Performance Optimization**

**Current Issues:**

- All 99 patches loaded into memory at once
- Synchronous XML parsing blocks main thread
- No lazy loading or virtualization

**Improvements:**

- Implement virtual scrolling for patch list
- Move XML parsing to worker threads
- Add pagination or lazy loading for large patch libraries
- Cache parsed patches with invalidation strategy
- Optimize bundle size (code splitting)
- Add loading indicators for long operations

#### 6. **State Management**

**Current Issue:** All state in `App.tsx` could become unwieldy

**Improvements:**

- Introduce lightweight state management (Zustand recommended)
- Implement local caching strategy
- Add optimistic UI updates
- Separate business logic from UI components
- Consider React Query for async state management

---

### **Priority 4: User Experience Enhancements**

#### 7. **UI/UX Improvements**

**Current Gaps:**

- No loading indicators during operations
- No progress bars for large file imports
- Browser `confirm()` for delete operations
- No undo/redo functionality

**Improvements:**

- Add loading states and progress indicators
- Replace browser dialogs with custom modals
- Implement undo/redo for destructive operations
- Add keyboard shortcuts for power users
- Improve drag-and-drop visual feedback
- Add multi-select functionality for batch reordering
- Add tooltips for complex features
- Implement search/filter for patches

#### 8. **Audio Features Enhancement**

**Current Limitations:**

- Basic playback controls only
- No waveform visualization
- No audio trimming/editing

**Improvements:**

- Add waveform visualization (WaveSurfer.js)
- Implement audio trimming before import
- Add volume normalization option
- Show audio duration and file size
- Support batch WAV import
- Add audio quality presets

---

### **Priority 5: Security Hardening**

#### 9. **Security Enhancements**

**Current Concerns:**

- File paths not validated against traversal attacks
- XML parsing not hardened against XXE attacks
- No code signing configured
- Sandbox disabled

**Improvements:**

- Add path validation and sanitization
- Configure XML parser with security options
- Implement code signing for distributions
- Add input validation for all user inputs
- Regular dependency security audits
- Add CSP headers where applicable

---

### **Priority 6: Developer Experience & Documentation**

#### 10. **Documentation**

**Current Gaps:**

- Module system lacks inline docs
- No architecture decision records
- IPC API not externally documented

**Improvements:**

- Add comprehensive README with:
  - Architecture overview
  - Development setup guide
  - IPC API reference
  - Contributing guidelines
- Add inline JSDoc comments for public APIs
- Create ADRs for major architectural decisions
- Document JamMan XML format specification
- Add troubleshooting guide

#### 11. **Development Tools**

**Improvements:**

- Add debug logging system (electron-log)
- Implement hot reload for renderer-only changes
- Add pre-commit hooks (Husky + lint-staged)
- Configure Prettier for consistent formatting
- Add commit message linting (commitlint)
- Set up GitHub Actions for CI/CD

---

### **Priority 7: Feature Additions**

#### 12. **Backup/Restore System**

**Goal:** Single-file backup solution for preserving and sharing patch collections

**Implementation Details:**

- **Format:** ZIP-based (`.jamman-backup.zip`) for transparency and future-proofing
- **Structure:**
  ```
  backup-2025-01-04.jamman-backup.zip
  ├── README.txt (structure explanation)
  ├── manifest.json (metadata: patch count, date, app version)
  ├── playlists.json (playlist metadata)
  ├── Patch01/
  │   ├── patch.xml
  │   └── PhraseA/
  │       ├── phrase.xml
  │       └── phrase.wav
  ├── Patch02/
  ...
  ```

**Features:**

- Full backup (all patches + playlists)
- Selective backup (choose specific patches)
- Restore modes:
  - Replace all (wipes current, restores backup)
  - Merge (adds to existing patches, renumbers if needed)
- Auto-backup before major operations (optional)
- Backup verification and integrity checks
- Export playlist as standalone backup

**Benefits:**

- Users can inspect backup contents (ZIP is standard)
- Future-proof (works without app)
- Shareable between users
- Can manually extract individual patches
- Professional archival format

**Libraries:** `adm-zip` or `jszip`

**Files to Create/Update:**

- `packages/main/src/BackupManager.ts` (new)
- `packages/main/src/index.ts` (add IPC handlers)
- `packages/renderer/src/components/BackupRestore.tsx` (new UI)
- `packages/renderer/src/App.tsx` (add backup/restore buttons)

**Estimated Time:** 6-8 hours

---

#### 13. **Playlist Management System**

**Goal:** Virtual playlist organization for live performances without altering SD card structure

**Key Concepts:**

- **Virtual Organization:** Playlists are metadata-only, don't change patch folder names
- **Multi-membership:** Patches can appear in multiple playlists
- **Custom Ordering:** Each playlist has its own patch order
- **Hardware Compatible:** Physical `Patch01`, `Patch02` structure preserved

**Data Structure:**

```json
{
  "playlists": [
    {
      "id": "uuid-1",
      "name": "Friday Night Set",
      "order": ["Patch01", "Patch12", "Patch05", "Patch03"],
      "color": "#4A90E2",
      "created": "2025-01-04T12:00:00Z",
      "notes": "Open with blues, end with rock"
    }
  ]
}
```

**Features:**

- Create/edit/delete playlists
- Drag patches into/out of playlists
- Reorder within playlist (doesn't affect device order)
- Color-coded playlists for quick identification
- **Live Performance Mode:**
  - "Move Playlist to Top" action: physically renumbers patches to match playlist order
  - Reorders Patch01, Patch02, etc. on SD card to match setlist
  - Backup created automatically before reorder
  - Confirmation dialog showing the reordering plan
- Export playlist as setlist (text/PDF)
- Search within playlist
- Playlist statistics (duration, patch count, etc.)

**UI Design:**

- Tab view: "All Patches" | "Playlists"
- Playlist section: collapsible groups with drag-and-drop
- Context menu: "Add to Playlist", "Remove from Playlist"
- Playlist editor: dedicated view for managing playlist details

**Storage:** `.jamman-playlists.json` file alongside patches

**Files to Create/Update:**

- `packages/main/src/PlaylistManager.ts` (new)
- `packages/main/src/index.ts` (add IPC handlers)
- `packages/renderer/src/components/PlaylistView.tsx` (new)
- `packages/renderer/src/components/PlaylistEditor.tsx` (new)
- `packages/renderer/src/store/usePlaylistStore.ts` (new)
- `packages/renderer/src/App.tsx` (add playlist tab)

**Estimated Time:** 8-10 hours

---

#### 14. **Enhanced Sorting UI**

**Current Limitation:** Modal-based sorting is cramped and doesn't scale well

**New Design: Dedicated Sort Mode (Option B)**

**Features:**

- **Dedicated View:** Click "Sort Patches" enters full-screen sort mode
- **Split View Layout:**
  - Left panel: Current patch order (reference)
  - Right panel: Working order (drag-and-drop enabled)
- **Quick Sort Options:**
  - Alphabetical (A-Z / Z-A)
  - By patch number
  - By BPM (if phrase data available)
  - By date modified
  - Custom (manual drag-and-drop)
- **Search/Filter:** Real-time search while sorting
- **Visual Aids:**
  - Large drag handles
  - Drop zone indicators
  - "Modified" badge on changed items
- **Batch Actions:**
  - Select multiple patches
  - Move selected to top/bottom
  - Reverse selection order
- **Apply/Cancel:**
  - Preview changes before applying
  - "Apply" saves new order to disk
  - "Cancel" discards changes

**Integration with Playlists:**

- "Sort by Playlist" option: dropdown to select playlist
- "Move Playlist to Top" action available in sort mode
- Shows playlist membership badges on patches

**Files to Update:**

- `packages/renderer/src/components/SortView.tsx` (major refactor)
- `packages/renderer/src/App.tsx` (add sort mode state)
- `packages/renderer/src/components/PatchList.tsx` (enhance drag-and-drop)

**Estimated Time:** 4-6 hours

---

#### 15. **Batch Delete Functionality**

**Goal:** Delete multiple patches at once efficiently

**Implementation:**

- Leverage existing multi-select from sorting feature
- Add "Delete Selected" button when items are selected
- Confirmation modal:
  - Shows count and list of patches to be deleted
  - Warning about irreversibility
  - Checkbox: "Create backup before deleting"
- Progress indicator for batch operations
- Success toast: "Deleted 5 patches successfully"
- Error handling: partial success reporting

**Files to Update:**

- `packages/renderer/src/App.tsx` (add batch delete action)
- `packages/renderer/src/components/DeleteConfirmModal.tsx` (enhance for batch)
- `packages/main/src/index.ts` (add batch delete IPC handler)

**Estimated Time:** 1-2 hours

---

#### 16. **Additional Features to Consider (Future)**

- **Templates:** Pre-configured patch templates
- **Cloud Sync:** Optional cloud backup (privacy-focused)
- **MIDI Integration:** Direct JamMan control (if feasible)
- **Metadata Search:** Find patches by BPM, time signature, etc.
- **Waveform Visualization:** Visual audio preview
- **Batch Edit:** Edit multiple patches at once

---

## 🚀 Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

1. Add error handling to IPC handlers
2. Implement basic unit tests
3. Add file operation safety mechanisms
4. Set up development tools (linting, formatting)

### Phase 2: Quality (Weeks 3-4)

5. Complete testing suite (unit + integration)
6. Add loading states and progress indicators
7. Implement state management solution
8. Add comprehensive documentation

### Phase 3: Performance (Weeks 5-6)

9. Optimize patch loading and rendering
10. Implement virtual scrolling
11. Add caching layer
12. Move heavy operations to workers

### Phase 4: Enhancement (Weeks 7-8)

13. Improve UI/UX with custom modals ✅
14. Implement batch delete functionality
15. Enhanced sorting UI with split view
16. Add undo/redo functionality
17. Add security hardening measures

### Phase 5: Feature Additions (Weeks 9-10)

18. Backup/Restore system (ZIP-based)
19. Playlist management system
20. "Move Playlist to Top" for live performance
21. Implement waveform visualization

### Phase 6: Polish & Production (Weeks 11-12)

22. Implement search/filter
23. Configure code signing
24. Set up CI/CD pipeline
25. Comprehensive documentation update

---

## 📝 Quick Wins (Can Implement Immediately)

1. ✅ **Add PropTypes/TypeScript types to React components** - 1 hour (DONE)
2. ✅ **Replace browser `confirm()` with custom modal** - 2 hours (DONE)
3. ✅ **Add loading spinner during patch operations** - 2 hours (DONE)
4. ✅ **Implement basic error toast notifications** - 3 hours (DONE)
5. ✅ **Add keyboard shortcut for "Load Folder" (Cmd/Ctrl+O)** - 1 hour (DONE)
6. **Add file size validation for WAV imports** - 2 hours
7. ✅ **Configure Prettier and ESLint for all packages** - 2 hours (DONE)
8. **Add basic JSDoc comments to IPC handlers** - 3 hours
9. ✅ **Batch Delete functionality** - 1-2 hours (DONE)

---

## 🎯 Metrics for Success

- **Code Coverage:** Target 80%+ for critical paths
- **Build Performance:** <30s full rebuild
- **App Launch Time:** <2s on average hardware
- **Error Rate:** <0.1% of operations fail
- **User Satisfaction:** Based on GitHub issues/feedback

---

## 📋 Implementation Checklist

### Priority 1: Critical Reliability

- [x] Add try-catch wrappers to all IPC handlers
- [x] Implement error logging system
- [x] Add rollback mechanism for file operations
- [x] Fix audio playback reliability (MediaError code 4 / protocol handling)
- [x] Implement file locking for critical operations
- [x] Add operation queue for concurrency control

### Priority 2: Testing

- [x] Set up Vitest for unit testing
- [x] Write unit tests for XML parsing
- [x] Write unit tests for file operations
- [ ] Add integration tests for IPC flows
- [ ] Complete E2E test suite with Playwright

### Priority 3: Performance

- [x] Implement state management with Zustand
- [x] Optimize patch list rendering with memoization
- [x] Add caching layer with invalidation
- [ ] Implement virtual scrolling for patch list (optional - test if needed)
- [ ] Move XML parsing to worker threads
- [ ] Optimize bundle size

### Priority 4: UX

- [x] Replace browser confirm() with custom modals
- [x] Add loading states and progress bars
- [ ] Implement undo/redo functionality
- [x] Add keyboard shortcuts
- [x] Add multi-select functionality for batch reordering
- [x] Implement search/filter (integrated into sorting UI)
- [x] Add patch list export functionality (TXT/PDF)

### Priority 7: New Features

- [x] **Batch Delete:** Delete multiple selected patches at once ✅ COMPLETED
- [x] **Enhanced Sorting UI:** Dedicated sort mode with split view and quick sort options ✅ COMPLETED
- [x] **Backup/Restore System:** ZIP-based single-file backup with selective restore ✅ COMPLETED
  - [x] Create full or selective backups
  - [x] Validate backup integrity
  - [x] Restore with Replace or Merge modes
  - [x] Auto-renumber patches on conflict (Merge mode)
  - [x] Generate manifest.json and README.txt
  - [x] User-friendly modal interface
- [x] **Playlist Management:** Virtual playlists for live performance organization ✅ COMPLETED
  - [x] Create/edit/delete playlists
  - [x] Multi-playlist membership (patches in multiple playlists)
  - [x] Add/remove patches to/from playlists
  - [x] "Move Playlist to Top" for live performance preparation
  - [x] Export playlist as setlist (TXT format)
  - [x] Stored in .jamman-playlists.json sidecar file
  - [x] Two-panel modal UI (list + details)
  - [x] Numbered patch display with ordering

### Priority 5: Security

- [ ] Add path validation and sanitization
- [ ] Harden XML parser configuration
- [ ] Set up code signing
- [ ] Add input validation
- [ ] Security audit dependencies

### Priority 6: Developer Experience

- [ ] Add comprehensive JSDoc comments
- [ ] Update README with architecture docs
- [ ] Add IPC API reference
- [x] Set up Prettier and ESLint
- [x] Configure pre-commit hooks
- [ ] Set up GitHub Actions CI/CD

---

## 🤝 Contributing

When implementing improvements:

1. Create a feature branch for each improvement
2. Follow the existing code style and architecture
3. Add tests for new functionality
4. Update documentation as needed
5. Submit PRs with clear descriptions

---

**Generated:** 2025-10-28
**Project Version:** 0.1.0

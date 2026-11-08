import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import AppHeader from './components/AppHeader';
import MemoryMap from './components/MemoryMap';
import PatchDetail from './components/PatchDetail';
import PatchListItem, { EmptySlotItem } from './components/PatchListItem';
import {
  Dialog,
  DisplayWindow,
  Led,
  LedToggle,
  Legend,
  Panel,
  PanelKey,
  SevenSegment,
  TopLayer,
} from './ui';
import { patchDirForSlot, shortcut, slotNumber } from './utils/format';
import s from './App.module.css';
import { usePatchStore } from './store/usePatchStore';
import { usePedalStore } from './store/usePedalStore';
import { useAudioPlayerStore } from './store/useAudioPlayerStore';
import { isPedalPath, pedalFolderLabel } from './utils/pedal';
import { useUndoStore } from './store/useUndoStore';
import { executeUndo, executeRedo, canUndo, canRedo } from './utils/undoHandler';
import type { Patch, Playlist } from './types';

// Lazy load heavy components for better initial load performance
const PatchForm = lazy(() => import('./components/PatchForm'));
const SortView = lazy(() => import('./components/SortView').then(m => ({ default: m.SortView })));
const DeleteConfirmModal = lazy(() => import('./components/DeleteConfirmModal'));
const BackupRestoreModal = lazy(() => import('./components/BackupRestoreModal'));
const PlaylistsModal = lazy(() => import('./components/PlaylistsModal'));
const PedalDialog = lazy(() => import('./components/PedalDialog'));
const FooterPlayer = lazy(() =>
  import('./components/FooterPlayer').then(m => ({ default: m.FooterPlayer })),
);

const PATCH_FORM_ID = 'create-patch-form';

function App() {
  // Zustand store
  const {
    currentFolder,
    patches,
    loading,
    selectedPatch,
    selectedPatchDirs,
    folderSizeBytes,
    loadPatches,
    clearPatches,
    setSelectedPatch,
    toggleSelection,
    selectAll,
    tryLoadLastFolder,
  } = usePatchStore();

  // Local UI state (modals)
  const [patchFormModalIsOpen, setPatchFormModalIsOpen] = useState<boolean>(false);
  const [sortModeActive, setSortModeActive] = useState<boolean>(false);
  const [deleteModalIsOpen, setDeleteModalIsOpen] = useState<boolean>(false);
  const [patchToDelete, setPatchToDelete] = useState<string | null>(null);
  const [patchesToDelete, setPatchesToDelete] = useState<string[]>([]);
  const [backupRestoreModalIsOpen, setBackupRestoreModalIsOpen] = useState<boolean>(false);
  const [playlistsModalIsOpen, setPlaylistsModalIsOpen] = useState<boolean>(false);
  // Main-screen view state (presentation only)
  const [focusedDir, setFocusedDir] = useState<string | null>(null);
  const [showEmptySlots, setShowEmptySlots] = useState<boolean>(false);
  const [createInDir, setCreateInDir] = useState<string | undefined>(undefined);

  // Pedal over USB
  const pedal = usePedalStore(state => state.pedal);
  const pedalConnecting = usePedalStore(state => state.connecting);
  const pedalProgress = usePedalStore(state => state.progress);
  const [pedalDialogIsOpen, setPedalDialogIsOpen] = useState<boolean>(false);
  /** A pedal bank is being read, so the loading panel says where from. */
  const [readingPedal, setReadingPedal] = useState<boolean>(false);
  /** A pedal over USB: everything works; some texts and empty states differ. */
  const pedalMode = isPedalPath(currentFolder);

  /** Closes the pedal bank, and the player if it is playing audio from the pedal. */
  const closePedalBank = useCallback(() => {
    clearPatches();
    const player = useAudioPlayerStore.getState();
    if (isPedalPath(player.audioInfo?.wavPath)) player.close();
  }, [clearPatches]);

  useEffect(() => usePedalStore.getState().subscribe(), []);

  // The open pedal bank went away: the pedal was unplugged or its SD card removed.
  useEffect(() => {
    if (!isPedalPath(currentFolder)) return;
    const bank = pedal?.banks.find(b => b.path === currentFolder);
    if (!pedal || !bank?.available) {
      closePedalBank();
      toast.info(pedal ? 'The SD card was removed from the pedal' : 'The pedal was disconnected');
    }
  }, [pedal, currentFolder, closePedalBank]);

  const handlePedal = useCallback(async () => {
    if (!usePedalStore.getState().pedal) {
      try {
        await usePedalStore.getState().connect();
      } catch (error) {
        console.error('Error connecting to the pedal:', error);
        toast.error(
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            : 'Could not connect to the pedal',
        );
        return;
      }
    }
    setPedalDialogIsOpen(true);
  }, []);

  const handleOpenPedalBank = useCallback(
    async (bank: { path: string }) => {
      setPedalDialogIsOpen(false);
      setReadingPedal(true);
      try {
        await loadPatches(bank.path);
      } finally {
        setReadingPedal(false);
      }
    },
    [loadPatches],
  );

  const handleDisconnectPedal = useCallback(async () => {
    setPedalDialogIsOpen(false);
    if (isPedalPath(usePatchStore.getState().currentFolder)) closePedalBank();
    try {
      await usePedalStore.getState().disconnect();
    } catch (error) {
      console.error('Error disconnecting the pedal:', error);
    }
  }, [closePedalBank]);

  // Undo/Redo state
  const undoAvailable = useUndoStore(state => state.undoStack.length > 0);
  const redoAvailable = useUndoStore(state => state.redoStack.length > 0);

  const handleLoad = useCallback(async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        await loadPatches(folder);
      }
    } catch (error) {
      console.error('Error loading patches:', error);
      toast.error('Failed to select folder. Please try again.');
    }
  }, [loadPatches]);

  // Undo/Redo handlers
  const handleUndo = useCallback(async () => {
    await executeUndo();
  }, []);

  const handleRedo = useCallback(async () => {
    await executeRedo();
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-bs-theme', 'dark');

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + O to load patches
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleLoad();
      }

      // Ctrl/Cmd + Z to undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          handleUndo();
        }
      }

      // Ctrl/Cmd + Shift + Z to redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (canRedo()) {
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleLoad, handleUndo, handleRedo]);

  // Auto-load last folder on mount
  useEffect(() => {
    const autoLoad = async () => {
      const loaded = await tryLoadLastFolder();
      if (loaded) {
        console.log('Auto-loaded last folder');
      }
    };

    autoLoad();
  }, [tryLoadLastFolder]);

  const { deletePatch, deletePatches, reorderPatches, clearSelection } = usePatchStore();

  const togglePatchModal = () => {
    setPatchFormModalIsOpen(prev => !prev);
  };

  const openNewPatch = (directory?: string) => {
    setSelectedPatch(undefined);
    setCreateInDir(directory);
    setPatchFormModalIsOpen(true);
  };

  const handleCreateEditPatchSuccess = () => {
    setPatchFormModalIsOpen(false);
  };

  const handleModalClose = () => {
    setSelectedPatch(undefined);
    setCreateInDir(undefined);
  };

  const handleEditPatch = useCallback(
    (directory: string) => {
      const patch = patches.find(({ dir }) => dir === directory);
      setSelectedPatch(patch);
      setPatchFormModalIsOpen(true);
    },
    [patches, setSelectedPatch],
  );

  const handleDeletePatch = useCallback((directory: string) => {
    setPatchToDelete(directory);
    setDeleteModalIsOpen(true);
  }, []);

  const confirmDelete = async () => {
    if (patchesToDelete.length > 0) {
      // Batch delete
      try {
        await deletePatches(patchesToDelete);
      } finally {
        setDeleteModalIsOpen(false);
        setPatchesToDelete([]);
      }
    } else if (patchToDelete) {
      // Single delete
      try {
        await deletePatch(patchToDelete);
      } finally {
        setDeleteModalIsOpen(false);
        setPatchToDelete(null);
      }
    }
  };

  const cancelDelete = () => {
    setDeleteModalIsOpen(false);
    setPatchToDelete(null);
    setPatchesToDelete([]);
  };

  const handleBatchDelete = useCallback(() => {
    if (selectedPatchDirs.length === 0) return;

    setPatchesToDelete(selectedPatchDirs);
    setDeleteModalIsOpen(true);
  }, [selectedPatchDirs]);

  const enterSortMode = () => {
    setSortModeActive(true);
  };

  const exitSortMode = () => {
    setSortModeActive(false);
    clearSelection();
  };

  const handleApplySort = async (newOrder: typeof patches) => {
    await reorderPatches(newOrder);
    setSortModeActive(false);
  };

  const handleMovePlaylistToTop = async (playlistId: string) => {
    if (!currentFolder) return;

    try {
      // Load playlists to get the selected playlist
      const data = await window.electronAPI.loadPlaylists(currentFolder);
      const playlist = data.playlists.find((p: Playlist) => p.id === playlistId);

      if (!playlist) {
        toast.error('Playlist not found');
        return;
      }

      // Get patches in playlist order
      const playlistPatches = playlist.patches
        .map((dir: string) => patches.find(p => p.dir === dir))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

      // Get patches not in playlist
      const otherPatches = patches.filter((p: Patch) => !playlist.patches.includes(p.dir));

      // Combine: playlist patches first, then others
      const newOrder = [...playlistPatches, ...otherPatches];

      await reorderPatches(newOrder);
      toast.success(`Moved "${playlist.name}" to top`);
    } catch (error) {
      console.error('Error moving playlist to top:', error);
      toast.error('Failed to move playlist to top');
    }
  };

  const handleExportTXT = async () => {
    if (!currentFolder || patches.length === 0) {
      toast.warning('No patches to export');
      return;
    }

    try {
      const result = await window.electronAPI.exportPatchesTXT(patches, currentFolder);
      if (result.success && result.filePath) {
        toast.success(`Exported patches to ${result.filePath}`);
      } else if (result.canceled) {
        // User canceled, no need to show message
      }
    } catch (error) {
      console.error('Error exporting patches to TXT:', error);
      toast.error('Failed to export patches to TXT');
    }
  };

  const handleExportPDF = async () => {
    if (!currentFolder || patches.length === 0) {
      toast.warning('No patches to export');
      return;
    }

    try {
      const result = await window.electronAPI.exportPatchesPDF(patches, currentFolder);
      if (result.success && result.filePath) {
        toast.success(`Exported patches to ${result.filePath}`);
      } else if (result.canceled) {
        // User canceled, no need to show message
      }
    } catch (error) {
      console.error('Error exporting patches to PDF:', error);
      toast.error('Failed to export patches to PDF');
    }
  };

  const usedDirs = useMemo(() => patches.map(p => p.dir), [patches]);
  const patchesByDir = useMemo(() => new Map(patches.map(p => [p.dir, p])), [patches]);

  // If in sort mode, show only the sort view
  if (sortModeActive) {
    return (
      <Suspense fallback={<div className={s.app} />}>
        <SortView patches={patches} onApply={handleApplySort} onCancel={exitSortMode} />
      </Suspense>
    );
  }

  const focusedPatch = patches.find(p => p.dir === focusedDir) ?? patches[0];
  const listSlots = showEmptySlots
    ? Array.from({ length: 99 }, (_, i) => patchDirForSlot(i + 1))
    : patches.map(p => p.dir);

  return (
    <div className={s.app}>
      <AppHeader
        currentFolder={currentFolder}
        sourceLabel={pedalFolderLabel(currentFolder, pedal)}
        pedalMode={pedalMode}
        pedalConnected={!!pedal}
        pedalBusy={pedalConnecting}
        folderSizeBytes={folderSizeBytes}
        loading={loading}
        focusedSlot={focusedPatch ? slotNumber(focusedPatch.dir) : null}
        patchCount={patches.length}
        canUndo={undoAvailable}
        canRedo={redoAvailable}
        onLoad={handleLoad}
        onPedal={handlePedal}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClose={clearPatches}
        onSort={enterSortMode}
        onExportTXT={handleExportTXT}
        onExportPDF={handleExportPDF}
        onBackup={() => setBackupRestoreModalIsOpen(true)}
        onPlaylists={() => setPlaylistsModalIsOpen(true)}
        onNewPatch={() => openNewPatch()}
      />

      {loading ? (
        <main className={s.center}>
          <Panel screws="top" className={s.message} role="status">
            <DisplayWindow>
              <SevenSegment value="--" height={40} />
            </DisplayWindow>
            <p className={s.messageTitle}>
              <Led color="yellow" shape="round" on blinkSeconds={0.5} />{' '}
              {readingPedal
                ? 'Reading the pedal over USB'
                : pedalProgress
                  ? `${pedalProgress.label}: ${Math.floor((100 * pedalProgress.done) / Math.max(pedalProgress.total, 1))}%`
                  : pedalMode
                    ? 'Working on the pedal over USB'
                    : 'Reading the card'}
            </p>
          </Panel>
        </main>
      ) : patches.length > 0 && focusedPatch ? (
        <main className={s.main}>
          <section className={s.listColumn} aria-label="Patches">
            <MemoryMap
              usedDirs={usedDirs}
              focusedDir={focusedPatch.dir}
              onFocus={setFocusedDir}
              onCreateAt={openNewPatch}
            />
            <div className={s.listbar}>
              <Legend>
                {selectedPatchDirs.length > 0
                  ? `${selectedPatchDirs.length} selected`
                  : `${patches.length} patches`}
              </Legend>
              <div className={s.listActions}>
                {selectedPatchDirs.length > 0 && (
                  <PanelKey
                    label={`Delete ${selectedPatchDirs.length}`}
                    tone="danger"
                    title="Delete the selected patches"
                    onClick={handleBatchDelete}
                  />
                )}
                <LedToggle pressed={showEmptySlots} onChange={setShowEmptySlots}>
                  Show empty slots
                </LedToggle>
                <button
                  type="button"
                  className={s.link}
                  onClick={selectedPatchDirs.length > 0 ? clearSelection : selectAll}
                >
                  {selectedPatchDirs.length > 0 ? 'Clear selection' : 'Select all'}
                </button>
              </div>
            </div>
            <ul className={s.list}>
              {listSlots.map(dir => {
                const patch = patchesByDir.get(dir);
                return patch ? (
                  <PatchListItem
                    key={dir}
                    patch={patch}
                    isSelected={selectedPatchDirs.includes(dir)}
                    isFocused={dir === focusedPatch.dir}
                    onFocus={setFocusedDir}
                    onToggleSelection={toggleSelection}
                  />
                ) : (
                  <EmptySlotItem key={dir} dir={dir} onCreate={openNewPatch} />
                );
              })}
            </ul>
          </section>

          <PatchDetail patch={focusedPatch} onEdit={handleEditPatch} onDelete={handleDeletePatch} />
        </main>
      ) : currentFolder ? (
        <main className={s.center}>
          <Panel screws="top" className={s.message}>
            <DisplayWindow>
              <SevenSegment value="00" height={40} />
            </DisplayWindow>
            <h2 className={s.messageTitle}>
              {pedalMode ? 'This bank has no patches yet' : 'This card has no patches yet'}
            </h2>
            {pedalMode ? (
              <>
                <p className={s.messageText}>
                  Store a new patch in any of its 99 slots, or record a loop on the pedal and reload
                  this bank.
                </p>
                <div className={s.messageActions}>
                  <PanelKey label="New patch" led onClick={() => openNewPatch()} />
                </div>
              </>
            ) : (
              <>
                <p className={s.messageText}>
                  Store a new patch in any of its 99 slots, or restore patches from a backup.
                </p>
                <div className={s.messageActions}>
                  <PanelKey
                    label="Restore backup"
                    onClick={() => setBackupRestoreModalIsOpen(true)}
                  />
                  <PanelKey label="New patch" led onClick={() => openNewPatch()} />
                </div>
              </>
            )}
          </Panel>
        </main>
      ) : (
        <main className={s.center}>
          <Panel screws="top" className={s.message}>
            <DisplayWindow>
              <SevenSegment value="--" height={40} />
            </DisplayWindow>
            <h2 className={s.messageTitle}>Load your JamMan SD card</h2>
            <p className={s.messageText}>
              Choose the card's folder to see, play and edit its patches, or connect the pedal with
              a USB cable to browse and play them without removing the card.
            </p>
            <div className={s.messageActions}>
              <PanelKey
                label="Connect pedal"
                hint="USB"
                onClick={handlePedal}
                disabled={pedalConnecting}
              />
              <PanelKey label="Load patches" hint={shortcut('O')} led onClick={handleLoad} />
            </div>
          </Panel>
        </main>
      )}

      {/* Footer Player */}
      <Suspense fallback={null}>
        <FooterPlayer />
      </Suspense>

      <Suspense fallback={<div />}>
        <Dialog
          isOpen={patchFormModalIsOpen}
          onClose={togglePatchModal}
          onClosed={handleModalClose}
          size="lg"
          title={selectedPatch ? `Edit ${selectedPatch.dir}` : 'New patch'}
          footer={
            <>
              <PanelKey label="Cancel" onClick={togglePatchModal} />
              <PanelKey
                type="submit"
                form={PATCH_FORM_ID}
                led
                label={selectedPatch ? 'Save' : 'Store patch'}
              />
            </>
          }
        >
          <PatchForm
            key={selectedPatch?.dir ?? createInDir ?? 'new'}
            formId={PATCH_FORM_ID}
            basePath={currentFolder || ''}
            busyPatches={patches.map(p => p.dir)}
            initialData={selectedPatch}
            defaultDirectory={createInDir}
            onSuccess={handleCreateEditPatchSuccess}
          />
        </Dialog>
      </Suspense>

      <Suspense fallback={<div />}>
        <DeleteConfirmModal
          isOpen={deleteModalIsOpen}
          itemName={patchToDelete || undefined}
          itemNames={patchesToDelete.length > 0 ? patchesToDelete : undefined}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      </Suspense>

      <Suspense fallback={<div />}>
        <BackupRestoreModal
          isOpen={backupRestoreModalIsOpen}
          onClose={() => setBackupRestoreModalIsOpen(false)}
          currentFolder={currentFolder}
          patches={patches}
          selectedPatchDirs={selectedPatchDirs}
          onBackupComplete={() => {
            // Optionally reload patches after backup
          }}
          onRestoreComplete={() => {
            // Reload patches after restore
            if (currentFolder) {
              loadPatches(currentFolder, true);
            }
          }}
        />
      </Suspense>

      <Suspense fallback={<div />}>
        <PlaylistsModal
          isOpen={playlistsModalIsOpen}
          onClose={() => setPlaylistsModalIsOpen(false)}
          currentFolder={currentFolder}
          patches={patches}
          selectedPatchDirs={selectedPatchDirs}
          onMovePlaylistToTop={handleMovePlaylistToTop}
        />
      </Suspense>

      <Suspense fallback={<div />}>
        <PedalDialog
          isOpen={pedalDialogIsOpen}
          pedal={pedal}
          currentFolder={currentFolder}
          onOpenBank={handleOpenPedalBank}
          onDisconnect={handleDisconnectPedal}
          onClose={() => setPedalDialogIsOpen(false)}
        />
      </Suspense>

      <TopLayer>
        <ToastContainer
          position="bottom-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="dark"
        />
      </TopLayer>
    </div>
  );
}

export default App;

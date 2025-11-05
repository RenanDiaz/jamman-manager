import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import {
  Button,
  ButtonDropdown,
  Col,
  Container,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
  UncontrolledAccordion,
} from 'reactstrap';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import PatchListItem from './components/PatchListItem';
import { usePatchStore } from './store/usePatchStore';
import { useUndoStore } from './store/useUndoStore';
import { executeUndo, executeRedo, canUndo, canRedo } from './utils/undoHandler';

// Lazy load heavy components for better initial load performance
const PatchForm = lazy(() => import('./components/PatchForm'));
const SortView = lazy(() => import('./components/SortView').then(m => ({ default: m.SortView })));
const DeleteConfirmModal = lazy(() => import('./components/DeleteConfirmModal'));
const BackupRestoreModal = lazy(() => import('./components/BackupRestoreModal'));
const PlaylistsModal = lazy(() => import('./components/PlaylistsModal'));
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
  const [exportDropdownOpen, setExportDropdownOpen] = useState<boolean>(false);
  const [backupRestoreModalIsOpen, setBackupRestoreModalIsOpen] = useState<boolean>(false);
  const [playlistsModalIsOpen, setPlaylistsModalIsOpen] = useState<boolean>(false);

  // Undo/Redo state
  const [undoAvailable, setUndoAvailable] = useState<boolean>(false);
  const [redoAvailable, setRedoAvailable] = useState<boolean>(false);

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
    // Update undo/redo availability after action
    setUndoAvailable(canUndo());
    setRedoAvailable(canRedo());
  }, []);

  const handleRedo = useCallback(async () => {
    await executeRedo();
    // Update undo/redo availability after action
    setUndoAvailable(canUndo());
    setRedoAvailable(canRedo());
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

  // Subscribe to undo store changes
  useEffect(() => {
    const unsubscribe = useUndoStore.subscribe(state => {
      setUndoAvailable(state.undoStack.length > 0);
      setRedoAvailable(state.redoStack.length > 0);
    });

    // Initial check
    setUndoAvailable(canUndo());
    setRedoAvailable(canRedo());

    return unsubscribe;
  }, []);

  const { deletePatch, deletePatches, reorderPatches, clearSelection } = usePatchStore();

  const togglePatchModal = () => {
    setPatchFormModalIsOpen(prev => !prev);
  };

  const handleCreateEditPatchSuccess = () => {
    setPatchFormModalIsOpen(false);
  };

  const handleModalClose = () => {
    setSelectedPatch(undefined);
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
      const playlist = data.playlists.find((p: any) => p.id === playlistId);

      if (!playlist) {
        toast.error('Playlist not found');
        return;
      }

      // Get patches in playlist order
      const playlistPatches = playlist.patches
        .map((dir: string) => patches.find(p => p.dir === dir))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

      // Get patches not in playlist
      const otherPatches = patches.filter((p: any) => !playlist.patches.includes(p.dir));

      // Combine: playlist patches first, then others
      const newOrder = [...playlistPatches, ...otherPatches];

      await reorderPatches(newOrder);
      toast.success(`Moved "${playlist.name}" to top`);
    } catch (error) {
      console.error('Error moving playlist to top:', error);
      toast.error('Failed to move playlist to top');
    }
  };

  const toggleExportDropdown = () => {
    setExportDropdownOpen(prev => !prev);
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

  // If in sort mode, show only the sort view
  if (sortModeActive) {
    return (
      <Suspense
        fallback={
          <div
            className="d-flex align-items-center justify-content-center"
            style={{ minHeight: '100vh' }}
          >
            <Spinner color="primary" />
          </div>
        }
      >
        <SortView patches={patches} onApply={handleApplySort} onCancel={exitSortMode} />
      </Suspense>
    );
  }

  return (
    <Container fluid>
      <Row className="align-items-center" style={{ minHeight: '100vh' }}>
        <Col>
          {/* Header / Toolbar */}
          <div
            className="sticky-top bg-dark border-bottom"
            style={{
              top: 0,
              zIndex: 100,
              marginLeft: '-12px',
              marginRight: '-12px',
              padding: '1rem 1.5rem',
            }}
          >
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
              {/* Left: Title */}
              <div>
                <h3 className="mb-0">JamMan Manager</h3>
                {currentFolder && (
                  <div className="d-flex align-items-center gap-2">
                    <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {currentFolder}
                    </small>
                    {folderSizeBytes !== null && (
                      <span className="badge bg-secondary" style={{ fontSize: '0.7rem' }}>
                        📦{' '}
                        {folderSizeBytes < 1024 * 1024
                          ? `${(folderSizeBytes / 1024).toFixed(1)} KB`
                          : folderSizeBytes < 1024 * 1024 * 1024
                            ? `${(folderSizeBytes / 1024 / 1024).toFixed(1)} MB`
                            : `${(folderSizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Actions */}
              <div className="d-flex align-items-center flex-wrap gap-2">
                {/* Load Patches - Always visible */}
                <Button
                  type="button"
                  color="success"
                  onClick={handleLoad}
                  disabled={loading}
                  size="sm"
                >
                  📁 Load Patches
                </Button>

                {/* Undo/Redo - Always visible but disabled when not available */}
                <div className="d-flex gap-1">
                  <Button
                    type="button"
                    color="secondary"
                    outline
                    onClick={handleUndo}
                    disabled={!undoAvailable || loading}
                    size="sm"
                    data-tooltip-id="undo-tooltip"
                    data-tooltip-content="Undo last action (Ctrl+Z / Cmd+Z)"
                  >
                    ↶
                  </Button>
                  <Button
                    type="button"
                    color="secondary"
                    outline
                    onClick={handleRedo}
                    disabled={!redoAvailable || loading}
                    size="sm"
                    data-tooltip-id="redo-tooltip"
                    data-tooltip-content="Redo action (Ctrl+Shift+Z / Cmd+Shift+Z)"
                  >
                    ↷
                  </Button>
                </div>

                {currentFolder && (
                  <>
                    {/* Patch Management Actions */}
                    <div className="d-flex gap-1" style={{ marginLeft: '0.5rem' }}>
                      <Button
                        type="button"
                        color="secondary"
                        outline
                        onClick={clearPatches}
                        size="sm"
                        title="Clear loaded folder"
                      >
                        ✕ Clear
                      </Button>
                      <Button
                        type="button"
                        color="secondary"
                        outline
                        onClick={enterSortMode}
                        size="sm"
                        disabled={patches.length === 0}
                        data-tooltip-id="sort-tooltip"
                        data-tooltip-content="Drag and drop to reorder patches. Changes sync to SD card. Supports multi-select!"
                      >
                        ⇅ Sort
                      </Button>
                      <ButtonDropdown
                        isOpen={exportDropdownOpen}
                        toggle={toggleExportDropdown}
                        size="sm"
                        disabled={patches.length === 0}
                      >
                        <DropdownToggle
                          color="secondary"
                          outline
                          caret
                          disabled={patches.length === 0}
                        >
                          ⤓ Export
                        </DropdownToggle>
                        <DropdownMenu>
                          <DropdownItem onClick={handleExportTXT}>Export as TXT</DropdownItem>
                          <DropdownItem onClick={handleExportPDF}>Export as PDF</DropdownItem>
                        </DropdownMenu>
                      </ButtonDropdown>
                      <Button
                        type="button"
                        color="secondary"
                        outline
                        onClick={() => setBackupRestoreModalIsOpen(true)}
                        size="sm"
                        data-tooltip-id="backup-tooltip"
                        data-tooltip-content="Create ZIP backups of patches. Restore with merge or replace modes. Great for sharing collections!"
                      >
                        💾 Backup
                      </Button>
                      <Button
                        type="button"
                        color="secondary"
                        outline
                        onClick={() => setPlaylistsModalIsOpen(true)}
                        size="sm"
                        data-tooltip-id="playlists-tooltip"
                        data-tooltip-content="Organize patches into setlists. Use 'Move to Top' to reorder patches on SD card for live performance!"
                      >
                        📋 Playlists
                      </Button>
                    </div>

                    {/* Selection Actions */}
                    {selectedPatchDirs.length > 0 && (
                      <div className="d-flex gap-1" style={{ marginLeft: '0.5rem' }}>
                        <Button
                          type="button"
                          color="danger"
                          outline
                          onClick={handleBatchDelete}
                          size="sm"
                          data-tooltip-id="batch-delete-tooltip"
                          data-tooltip-content={`Delete ${selectedPatchDirs.length} selected patches. Hold Shift to select ranges, Cmd/Ctrl to select multiple.`}
                        >
                          🗑️ Delete ({selectedPatchDirs.length})
                        </Button>
                      </div>
                    )}

                    {/* Primary Action */}
                    <div style={{ marginLeft: '0.5rem' }}>
                      <Button type="button" color="primary" onClick={togglePatchModal} size="sm">
                        + Create Patch
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div style={{ paddingTop: '1rem' }}>
            {loading ? (
              <div
                className="d-flex flex-column align-items-center justify-content-center"
                style={{ minHeight: '60vh' }}
              >
                <Spinner color="primary" style={{ width: '3rem', height: '3rem' }} />
                <p className="mt-3">Loading patches...</p>
              </div>
            ) : patches.length > 0 ? (
              <>
                {/* Patch List Header */}
                <div
                  className="d-flex align-items-center justify-content-between mb-3 px-2"
                  style={{ paddingTop: '0.5rem' }}
                >
                  <div>
                    <strong>Patches</strong>
                    <span className="text-muted ms-2">({patches.length} total)</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {selectedPatchDirs.length > 0 ? (
                      <>
                        <span className="text-primary">
                          <strong>{selectedPatchDirs.length} selected</strong>
                        </span>
                        <Button color="link" size="sm" onClick={clearSelection}>
                          Clear Selection
                        </Button>
                      </>
                    ) : (
                      <Button color="link" size="sm" onClick={selectAll}>
                        Select All
                      </Button>
                    )}
                  </div>
                </div>

                {/* Patch List */}
                <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                  <UncontrolledAccordion defaultOpen={[]} stayOpen toggle={() => {}}>
                    {patches.map(patch => (
                      <PatchListItem
                        key={patch.dir}
                        patch={patch}
                        isSelected={selectedPatchDirs.includes(patch.dir)}
                        onEdit={handleEditPatch}
                        onDelete={handleDeletePatch}
                        onToggleSelection={toggleSelection}
                      />
                    ))}
                  </UncontrolledAccordion>
                </div>
              </>
            ) : currentFolder ? (
              <div
                className="d-flex flex-column align-items-center justify-content-center text-center"
                style={{ minHeight: '60vh' }}
              >
                <p className="text-muted mb-2">No patches found in this folder</p>
                <p className="text-muted mb-3">
                  You can create a new patch or restore from a backup.
                </p>
                <div className="d-flex gap-2">
                  <Button color="primary" onClick={togglePatchModal}>
                    Create Patch
                  </Button>
                  <Button
                    color="secondary"
                    outline
                    onClick={() => setBackupRestoreModalIsOpen(true)}
                  >
                    Restore Backup
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="d-flex flex-column align-items-center justify-content-center text-center"
                style={{ minHeight: '60vh' }}
              >
                <p className="text-muted mb-2">No folder loaded</p>
                <p className="text-muted">
                  Click "Load Patches" or press <kbd>Ctrl+O</kbd> (or <kbd>Cmd+O</kbd> on Mac) to
                  select your JamMan SD card.
                </p>
              </div>
            )}
          </div>
        </Col>
      </Row>
      <Suspense fallback={<div />}>
        <Modal isOpen={patchFormModalIsOpen} toggle={togglePatchModal} onClosed={handleModalClose}>
          <ModalHeader toggle={togglePatchModal}>
            {!selectedPatch ? 'Create Patch' : 'Edit Patch'}
          </ModalHeader>
          <ModalBody>
            <PatchForm
              formId={PATCH_FORM_ID}
              basePath={currentFolder || ''}
              busyPatches={patches.map(p => p.dir)}
              initialData={selectedPatch}
              onSuccess={handleCreateEditPatchSuccess}
            />
          </ModalBody>
          <ModalFooter>
            <Button color="secondary" onClick={togglePatchModal}>
              Cancel
            </Button>
            <Button type="submit" form={PATCH_FORM_ID} color="primary">
              {!selectedPatch ? 'Create' : 'Save'}
            </Button>
          </ModalFooter>
        </Modal>
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

      {/* Tooltips */}
      <Tooltip id="undo-tooltip" place="bottom" />
      <Tooltip id="redo-tooltip" place="bottom" />
      <Tooltip id="sort-tooltip" place="bottom" />
      <Tooltip id="backup-tooltip" place="bottom" />
      <Tooltip id="playlists-tooltip" place="bottom" />
      <Tooltip id="batch-delete-tooltip" place="bottom" />

      {/* Footer Player */}
      <Suspense fallback={null}>
        <FooterPlayer />
      </Suspense>
    </Container>
  );
}

export default App;

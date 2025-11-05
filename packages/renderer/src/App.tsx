import { useCallback, useEffect, useState } from 'react';
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
import PatchForm from './components/PatchForm';
import { SortView } from './components/SortView';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import PatchListItem from './components/PatchListItem';
import BackupRestoreModal from './components/BackupRestoreModal';
import { usePatchStore } from './store/usePatchStore';

const PATCH_FORM_ID = 'create-patch-form';

function App() {
  // Zustand store
  const {
    currentFolder,
    patches,
    loading,
    selectedPatch,
    selectedPatchDirs,
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

  useEffect(() => {
    document.body.setAttribute('data-bs-theme', 'dark');

    // Keyboard shortcut: Ctrl/Cmd + O to load patches
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleLoad();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleLoad]);

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
    return <SortView patches={patches} onApply={handleApplySort} onCancel={exitSortMode} />;
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
                  <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {currentFolder}
                  </small>
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
                        title="Sort patches"
                        disabled={patches.length === 0}
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
                        title="Backup and Restore"
                      >
                        💾 Backup
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
                          title={`Delete ${selectedPatchDirs.length} selected patches`}
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
                  <UncontrolledAccordion defaultOpen={[]} stayOpen>
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

      <DeleteConfirmModal
        isOpen={deleteModalIsOpen}
        itemName={patchToDelete || undefined}
        itemNames={patchesToDelete.length > 0 ? patchesToDelete : undefined}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

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
    </Container>
  );
}

export default App;

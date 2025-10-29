import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Col,
  Container,
  FormGroup,
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
import { PatchList } from './components/PatchList';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import PatchListItem from './components/PatchListItem';
import { usePatchStore } from './store/usePatchStore';

const PATCH_FORM_ID = 'create-patch-form';

function App() {
  // Zustand store
  const {
    currentFolder,
    patches,
    loading,
    selectedPatch,
    loadPatches,
    clearPatches,
    setSelectedPatch,
  } = usePatchStore();

  // Local UI state (modals)
  const [patchFormModalIsOpen, setPatchFormModalIsOpen] = useState<boolean>(false);
  const [sortingModalIsOpen, setSortingModalIsOpen] = useState<boolean>(false);
  const [deleteModalIsOpen, setDeleteModalIsOpen] = useState<boolean>(false);
  const [patchToDelete, setPatchToDelete] = useState<string | null>(null);

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

  const { deletePatch, reorderPatches, clearSelection } = usePatchStore();

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
    if (!patchToDelete) return;

    try {
      await deletePatch(patchToDelete);
    } finally {
      setDeleteModalIsOpen(false);
      setPatchToDelete(null);
    }
  };

  const cancelDelete = () => {
    setDeleteModalIsOpen(false);
    setPatchToDelete(null);
  };

  const toggleSortingModal = () => {
    setSortingModalIsOpen(prev => {
      // Clear selection when closing the modal
      if (prev) {
        clearSelection();
      }
      return !prev;
    });
  };

  const handleReorder = async (newOrder: typeof patches) => {
    await reorderPatches(newOrder);
  };

  return (
    <Container fluid>
      <Row className="align-items-center" style={{ minHeight: '100vh' }}>
        <Col>
          <Row>
            <Col>
              <h1>JamMan Manager</h1>
            </Col>
          </Row>
          <Row className="flex-nowrap overflow-auto">
            <Col xs="auto">
              <FormGroup>
                <Button type="button" color="success" onClick={handleLoad} disabled={loading}>
                  Load Patches
                </Button>
              </FormGroup>
            </Col>
            {patches.length > 0 && (
              <>
                <Col xs="auto">
                  <FormGroup>
                    <Button type="button" color="info" outline onClick={clearPatches}>
                      Clear Patches
                    </Button>
                  </FormGroup>
                </Col>
                <Col xs="auto">
                  <FormGroup>
                    <Button type="button" color="info" outline onClick={toggleSortingModal}>
                      Sort Patches
                    </Button>
                  </FormGroup>
                </Col>
                <Col xs="auto" className="ms-auto">
                  <FormGroup>
                    <Button type="button" color="primary" onClick={togglePatchModal}>
                      Create Patch
                    </Button>
                  </FormGroup>
                </Col>
              </>
            )}
          </Row>

          {patches.length > 0 ? (
            <>
              <Row>
                <Col>
                  <p>Found {patches.length} patches</p>
                </Col>
              </Row>
              <Row style={{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }}>
                <Col>
                  <UncontrolledAccordion defaultOpen={[]} stayOpen>
                    {patches.map(patch => (
                      <PatchListItem
                        key={patch.dir}
                        patch={patch}
                        onEdit={handleEditPatch}
                        onDelete={handleDeletePatch}
                      />
                    ))}
                  </UncontrolledAccordion>
                </Col>
              </Row>
            </>
          ) : loading ? (
            <Row className="justify-content-center mt-5">
              <Col xs="auto" className="text-center">
                <Spinner color="primary" style={{ width: '3rem', height: '3rem' }} />
                <p className="mt-3">Loading patches...</p>
              </Col>
            </Row>
          ) : (
            <Row className="justify-content-center">
              <Col xs="auto">
                <p>
                  No patches loaded. Click "Load Patches" or press <kbd>Ctrl+O</kbd> (or{' '}
                  <kbd>Cmd+O</kbd> on Mac) to select your JamMan SD card.
                </p>
              </Col>
            </Row>
          )}
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

      <Modal isOpen={sortingModalIsOpen} toggle={toggleSortingModal}>
        <ModalHeader toggle={toggleSortingModal}>Sorting</ModalHeader>
        <ModalBody>
          <PatchList patches={patches} onReorder={handleReorder} />
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" onClick={toggleSortingModal}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      <DeleteConfirmModal
        isOpen={deleteModalIsOpen}
        itemName={patchToDelete || ''}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
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

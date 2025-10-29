import { useEffect, useState } from 'react';
import { Patch } from './types';
import {
  AccordionBody,
  AccordionHeader,
  AccordionItem,
  Button,
  ButtonGroup,
  Col,
  Container,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
  Table,
  UncontrolledAccordion,
} from 'reactstrap';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import PhrasePlayer from './components/PhrasePlayer';
import PatchForm from './components/PatchForm';
import { CheckmarkIcon, CrossIcon } from './utils/Images';
import { PatchList } from './components/PatchList';
import DeleteConfirmModal from './components/DeleteConfirmModal';

const PATCH_FORM_ID = 'create-patch-form';

const headersWidths = {
  xs: 5,
  sm: 3,
  md: 3,
  lg: 2,
  xl: 2,
  xxl: 1,
};

const valuesWidths = {
  xs: 7,
  sm: 9,
  md: 3,
  lg: 4,
  xl: 4,
  xxl: 3,
};

function App() {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [patchFormModalIsOpen, setPatchFormModalIsOpen] = useState<boolean>(false);
  const [selectedPatch, setSelectedPatch] = useState<Patch>();
  const [sortingModalIsOpen, setSortingModalIsOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [deleteModalIsOpen, setDeleteModalIsOpen] = useState<boolean>(false);
  const [patchToDelete, setPatchToDelete] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPatches = async (folder: string, update?: boolean) => {
    try {
      setLoading(true);
      if (!update) setPatches([]);
      const result = await window.electronAPI.readPatches(folder);
      console.log(result);
      setPatches(result);
      if (!update) {
        toast.success(`Successfully loaded ${result.length} patches`);
      }
    } catch (error) {
      console.error('Error loading patches:', error);
      toast.error('Failed to load patches. Please check the folder and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        setCurrentFolder(folder);
        loadPatches(folder);
      }
    } catch (error) {
      console.error('Error loading patches:', error);
      toast.error('Failed to select folder. Please try again.');
    }
  };

  const clearPatches = () => {
    setPatches([]);
    setCurrentFolder(null);
  };

  const togglePatchModal = () => {
    setPatchFormModalIsOpen(prev => !prev);
  };

  const handleCreateEditPatchSuccess = () => {
    setPatchFormModalIsOpen(false);
    if (!currentFolder) return;
    loadPatches(currentFolder, true);
  };

  const handleModalClose = () => {
    setSelectedPatch(undefined);
  };

  const handleEditPatch = (directory: string) => {
    const patch = patches.find(({ dir }) => dir === directory);
    setSelectedPatch(patch);
    setPatchFormModalIsOpen(true);
  };

  const handleDeletePatch = (directory: string) => {
    setPatchToDelete(directory);
    setDeleteModalIsOpen(true);
  };

  const confirmDelete = async () => {
    if (!currentFolder || !patchToDelete) return;

    try {
      setLoading(true);
      await window.electronAPI.deletePatch(currentFolder, patchToDelete);
      toast.success(`Successfully deleted ${patchToDelete}`);
      loadPatches(currentFolder, true);
    } catch (error) {
      console.error('Error deleting patch:', error);
      toast.error('Failed to delete patch. Please try again.');
    } finally {
      setLoading(false);
      setDeleteModalIsOpen(false);
      setPatchToDelete(null);
    }
  };

  const cancelDelete = () => {
    setDeleteModalIsOpen(false);
    setPatchToDelete(null);
  };

  const toggleSortingModal = () => {
    setSortingModalIsOpen(prev => !prev);
  };

  const handleReorder = async (newOrder: Patch[]) => {
    setPatches(newOrder); // update state visually

    if (!currentFolder) return;

    try {
      setLoading(true);
      // send to main process to rename folders
      await window.electronAPI.reorderPatches(
        currentFolder,
        newOrder.map(p => p.dir),
      );
      toast.success('Successfully reordered patches');
      loadPatches(currentFolder, true);
    } catch (error) {
      console.error('Error reordering patches:', error);
      toast.error('Failed to reorder patches. Please try again.');
      // Revert to original order on error
      loadPatches(currentFolder, true);
    } finally {
      setLoading(false);
    }
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
                    {patches.map(({ data, dir, phrases }) => {
                      const patch = data.JamManPatch;
                      const patchName = patch.PatchName?.[0] || '';

                      return (
                        <AccordionItem key={dir}>
                          <AccordionHeader targetId={dir}>
                            <strong>{dir}</strong>
                            {!!patchName && <small className="ms-2">{patchName}</small>}
                          </AccordionHeader>
                          <AccordionBody accordionId={dir}>
                            <Row className="mb-3 gy-2">
                              <Col {...headersWidths}>
                                <strong>Patch name:</strong>
                              </Col>
                              <Col {...valuesWidths}>{patchName}</Col>
                              <Col {...headersWidths}>
                                <strong>Device:</strong>
                              </Col>
                              <Col {...valuesWidths}>{patch.$.device}</Col>
                              <Col {...headersWidths}>
                                <strong>ID:</strong>
                              </Col>
                              <Col {...valuesWidths} className="text-truncate">
                                {patch.ID[0] || 'N/A'}
                              </Col>
                              <Col {...headersWidths}>
                                <strong>Origin ID:</strong>
                              </Col>
                              <Col {...valuesWidths} className="text-truncate">
                                {patch.OriginID?.[0] || 'N/A'}
                              </Col>
                              <Col {...headersWidths}>
                                <strong>Rhythm Type:</strong>
                              </Col>
                              <Col {...valuesWidths}>{patch.RhythmType?.[0] || 'N/A'}</Col>
                              <Col {...headersWidths}>
                                <strong>Stop Mode:</strong>
                              </Col>
                              <Col {...valuesWidths}>{patch.StopMode?.[0] || 'N/A'}</Col>
                              <Col {...headersWidths}>
                                <strong>Settings Ver.:</strong>
                              </Col>
                              <Col {...valuesWidths}>{patch.SettingsVersion?.[0] || 'N/A'}</Col>
                            </Row>

                            <Table responsive className="border">
                              <thead>
                                <tr>
                                  <th colSpan={7} className="text-center">
                                    Phrases
                                  </th>
                                </tr>
                                <tr>
                                  <th>Directory</th>
                                  <th>ID</th>
                                  <th>BPM</th>
                                  <th>Loop</th>
                                  <th>Reversed</th>
                                  <th>Time Signature</th>
                                  <th>Audio</th>
                                </tr>
                              </thead>
                              <tbody>
                                {phrases.map(({ dir, data: { JamManPhrase: phrase }, wavPath }) => (
                                  <tr key={dir}>
                                    <td>{dir}</td>
                                    <td className="text-truncate">{phrase.ID?.[0] || 'N/A'}</td>
                                    <td>{phrase.BeatsPerMinute?.[0] || 'N/A'}</td>
                                    <td>
                                      {phrase.IsLoop[0] === '1' ? <CheckmarkIcon /> : <CrossIcon />}
                                    </td>
                                    <td>
                                      {phrase.IsReversed[0] === '1' ? (
                                        <CheckmarkIcon />
                                      ) : (
                                        <CrossIcon />
                                      )}
                                    </td>
                                    <td>{phrase.BeatsPerMeasure?.[0] || 'N/A'}</td>
                                    <td>
                                      <PhrasePlayer wavPath={wavPath} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                            <Row className="justify-content-end">
                              <Col xs="auto">
                                <ButtonGroup>
                                  <Button color="primary" onClick={() => handleEditPatch(dir)}>
                                    Edit
                                  </Button>
                                  <Button color="danger" onClick={() => handleDeletePatch(dir)}>
                                    Delete
                                  </Button>
                                </ButtonGroup>
                              </Col>
                            </Row>
                          </AccordionBody>
                        </AccordionItem>
                      );
                    })}
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

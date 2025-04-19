import { useEffect, useState } from "react";
import { Patch } from "./types";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Col,
  Container,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Table,
} from "reactstrap";
import PhrasePlayer from "./components/PhrasePlayer";
import PatchForm from "./components/PatchForm";

const PATCH_FORM_ID = "create-patch-form";

function App() {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [patchFormModalIsOpen, setPatchFormModalIsOpen] =
    useState<boolean>(false);
  const [selectedPatch, setSelectedPatch] = useState<Patch>();
  const [loading, setLoading] = useState<boolean>(false);

  const loadPatches = async (folder: string, update?: boolean) => {
    try {
      setLoading(true);
      if (!update) setPatches([]);
      const result = await window.electronAPI.readPatches(folder);
      console.log(result);
      setPatches(result);
    } catch (error) {
      console.error("Error loading patches:", error);
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
      console.error("Error loading patches:", error);
    }
  };

  const clearPatches = () => {
    setPatches([]);
    setCurrentFolder(null);
  };

  const togglePatchModal = () => {
    setPatchFormModalIsOpen((prev) => !prev);
  };

  const handleCreateEditPatchSuccess = () => {
    setPatchFormModalIsOpen(false);
    if (!currentFolder) return;
    loadPatches(currentFolder, true);
  };

  const handleModalClose = () => {
    setSelectedPatch(undefined);
  };

  const handleEditPatch = (patch: Patch) => {
    setSelectedPatch(patch);
    setPatchFormModalIsOpen(true);
  };

  const handleDeletePatch = async (patch: Patch) => {
    if (!currentFolder) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${patch.dir}"?`
    );
    if (confirmed) {
      await window.electronAPI.deletePatch(patch.dir, currentFolder);
      loadPatches(currentFolder, true);
    }
  };

  useEffect(() => {
    document.body.setAttribute("data-bs-theme", "dark");
  }, []);

  return (
    <Container fluid>
      <Row className="align-items-center" style={{ minHeight: "100vh" }}>
        <Col>
          <Row>
            <Col>
              <h1>JamMan Manager</h1>
            </Col>
          </Row>
          <Row>
            <Col xs="auto">
              <FormGroup>
                <Button type="button" color="success" onClick={handleLoad}>
                  {loading ? "Loading..." : "Load SD Card"}
                </Button>
              </FormGroup>
            </Col>
            {patches.length > 0 && (
              <>
                <Col xs="auto">
                  <FormGroup>
                    <Button
                      type="button"
                      color="info"
                      outline
                      onClick={clearPatches}
                    >
                      Clear Patches
                    </Button>
                  </FormGroup>
                </Col>
                <Col xs="auto">
                  <FormGroup>
                    <Button
                      type="button"
                      color="primary"
                      onClick={togglePatchModal}
                    >
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
              <Row>
                <Col>
                  <div style={{ display: "grid", gap: 20 }}>
                    {patches.map((p, i) => {
                      const patch = p.data.JamManPatch;
                      const patchName = patch.PatchName?.[0] || p.dir;

                      return (
                        <Card key={i}>
                          <CardHeader>
                            <Row className="align-items-center">
                              <Col>
                                <strong>{p.dir}</strong>
                              </Col>
                              <Col xs="auto">
                                <Button
                                  color="success"
                                  size="sm"
                                  onClick={() => handleEditPatch(p)}
                                >
                                  Edit
                                </Button>
                              </Col>
                              <Col xs="auto">
                                <Button
                                  color="danger"
                                  size="sm"
                                  onClick={() => handleDeletePatch(p)}
                                >
                                  Delete
                                </Button>
                              </Col>
                            </Row>
                          </CardHeader>
                          <CardBody>
                            <Table borderless>
                              <tbody>
                                <tr>
                                  <td>
                                    <strong>Patch name:</strong>
                                  </td>
                                  <td>{patchName}</td>
                                </tr>
                                <tr>
                                  <td>
                                    <strong>Device</strong>
                                  </td>
                                  <td>{patch.$.device}</td>
                                </tr>
                                <tr>
                                  <td>
                                    <strong>ID:</strong>
                                  </td>
                                  <td>{patch.ID[0] || "N/A"}</td>
                                </tr>
                                <tr>
                                  <td>
                                    <strong>Origin ID:</strong>
                                  </td>
                                  <td>{patch.OriginID?.[0] || "N/A"}</td>
                                </tr>
                                <tr>
                                  <td>
                                    <strong>Rhythm Type:</strong>
                                  </td>
                                  <td>{patch.RhythmType?.[0] || "N/A"}</td>
                                </tr>
                                <tr>
                                  <td>
                                    <strong>Stop Mode:</strong>
                                  </td>
                                  <td>{patch.StopMode?.[0] || "N/A"}</td>
                                </tr>
                                <tr>
                                  <td>
                                    <strong>Settings Version:</strong>
                                  </td>
                                  <td>{patch.SettingsVersion?.[0] || "N/A"}</td>
                                </tr>
                              </tbody>
                            </Table>

                            <Card>
                              <CardHeader>Phrases</CardHeader>
                              <Table>
                                <thead>
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
                                  {p.phrases.map(
                                    ({
                                      dir,
                                      data: { JamManPhrase: phrase },
                                      wavPath,
                                    }) => (
                                      <tr key={phrase.ID[0]}>
                                        <td>{dir}</td>
                                        <td>{phrase.ID?.[0] || "N/A"}</td>
                                        <td>
                                          {phrase.BeatsPerMinute?.[0] || "N/A"}
                                        </td>
                                        <td>
                                          {phrase.IsLoop[0] === "1"
                                            ? "Yes"
                                            : "No"}
                                        </td>
                                        <td>
                                          {phrase.IsReversed[0] === "1"
                                            ? "Yes"
                                            : "No"}
                                        </td>
                                        <td>
                                          {phrase.BeatsPerMeasure?.[0] || "N/A"}
                                        </td>
                                        <td>
                                          <PhrasePlayer wavPath={wavPath} />
                                        </td>
                                      </tr>
                                    )
                                  )}
                                </tbody>
                              </Table>
                            </Card>
                          </CardBody>
                        </Card>
                      );
                    })}
                  </div>
                </Col>
              </Row>
            </>
          ) : (
            <Row className="justify-content-center">
              <Col xs="auto">
                <p>
                  No patches loaded. Click "Load SD Card" to select your JamMan
                  SD card.
                </p>
              </Col>
            </Row>
          )}
        </Col>
      </Row>
      <Modal
        isOpen={patchFormModalIsOpen}
        toggle={togglePatchModal}
        onClosed={handleModalClose}
      >
        <ModalHeader toggle={togglePatchModal}>
          {!selectedPatch ? "Create Patch" : "Edit Patch"}
        </ModalHeader>
        <ModalBody>
          <PatchForm
            formId={PATCH_FORM_ID}
            basePath={currentFolder || ""}
            busyPatches={patches.map((p) => p.dir)}
            initialData={selectedPatch}
            onSuccess={handleCreateEditPatchSuccess}
          />
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" onClick={togglePatchModal}>
            Cancel
          </Button>
          <Button type="submit" form={PATCH_FORM_ID} color="primary">
            {!selectedPatch ? "Create" : "Save"}
          </Button>
        </ModalFooter>
      </Modal>
    </Container>
  );
}

export default App;

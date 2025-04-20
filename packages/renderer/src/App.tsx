import { useEffect, useState } from "react";
import { Patch } from "./types";
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
  Table,
  UncontrolledAccordion,
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
          <Row className="flex-nowrap overflow-auto">
            <Col xs="auto">
              <FormGroup>
                <Button type="button" color="success" onClick={handleLoad}>
                  {loading ? "Loading..." : "Load Patches"}
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
              <Row
                style={{ maxHeight: "calc(100vh - 150px)", overflowY: "auto" }}
              >
                <Col>
                  <UncontrolledAccordion defaultOpen={[]} stayOpen>
                    {patches.map((p, i) => {
                      const patch = p.data.JamManPatch;
                      const patchName = patch.PatchName?.[0] || "";

                      return (
                        <AccordionItem key={i}>
                          <AccordionHeader targetId={i.toString()}>
                            <strong>{p.dir}</strong>
                            {!!patchName && (
                              <span className="small ms-2">{patchName}</span>
                            )}
                          </AccordionHeader>
                          <AccordionBody accordionId={i.toString()}>
                            <Row className="mb-3 gy-2">
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>Patch name:</strong>
                              </Col>
                              <Col xs={7} sm={9} md={3} lg={4}>
                                {patchName}
                              </Col>
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>Device:</strong>
                              </Col>
                              <Col xs={7} sm={9} md={3} lg={4}>
                                {patch.$.device}
                              </Col>
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>ID:</strong>
                              </Col>
                              <Col
                                xs={7}
                                sm={9}
                                md={3}
                                lg={4}
                                className="text-truncate"
                              >
                                {patch.ID[0] || "N/A"}
                              </Col>
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>Origin ID:</strong>
                              </Col>
                              <Col
                                xs={7}
                                sm={9}
                                md={3}
                                lg={4}
                                className="text-truncate"
                              >
                                {patch.OriginID?.[0] || "N/A"}
                              </Col>
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>Rhythm Type:</strong>
                              </Col>
                              <Col xs={7} sm={9} md={3} lg={4}>
                                {patch.RhythmType?.[0] || "N/A"}
                              </Col>
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>Stop Mode:</strong>
                              </Col>
                              <Col xs={7} sm={9} md={3} lg={4}>
                                {patch.StopMode?.[0] || "N/A"}
                              </Col>
                              <Col xs={5} sm={3} md={3} lg={2}>
                                <strong>Settings Ver.:</strong>
                              </Col>
                              <Col xs={7} sm={9} md={3} lg={4}>
                                {patch.SettingsVersion?.[0] || "N/A"}
                              </Col>
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
                                {p.phrases.map(
                                  ({
                                    dir,
                                    data: { JamManPhrase: phrase },
                                    wavPath,
                                  }) => (
                                    <tr key={dir}>
                                      <td>{dir}</td>
                                      <td className="text-truncate">
                                        {phrase.ID?.[0] || "N/A"}
                                      </td>
                                      <td>
                                        {phrase.BeatsPerMinute?.[0] || "N/A"}
                                      </td>
                                      <td>
                                        {phrase.IsLoop[0] === "1" ? "✅" : "❌"}
                                      </td>
                                      <td>
                                        {phrase.IsReversed[0] === "1"
                                          ? "✅"
                                          : "❌"}
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
                            <Row className="justify-content-end">
                              <Col xs="auto">
                                <ButtonGroup>
                                  <Button
                                    color="primary"
                                    onClick={() => handleEditPatch(p)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    color="danger"
                                    onClick={() => handleDeletePatch(p)}
                                  >
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

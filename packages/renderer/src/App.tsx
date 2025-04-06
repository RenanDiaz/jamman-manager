import { useEffect, useState } from "react";
import { Patch } from "./types";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Col,
  Container,
  Row,
  Table,
} from "reactstrap";
import PhrasePlayer from "./components/PhrasePlayer";

function App() {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [loading, setLoading] = useState(false);

  const handleLoad = async () => {
    try {
      setLoading(true);
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        const result = await window.electronAPI.readPatches(folder);
        console.log(result);
        setPatches(result);
      }
    } catch (error) {
      console.error("Error loading patches:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.body.setAttribute("data-bs-theme", "dark");
  }, []);

  return (
    <Container fluid>
      <Row className="align-items-center" style={{ minHeight: "100vh" }}>
        <Col>
          <header
            style={{
              marginBottom: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h1 style={{ margin: 0 }}>JamMan Patch Reader</h1>
          </header>
          <div>
            <Button type="button" color="success" onClick={handleLoad}>
              {loading ? "Loading..." : "Load SD Card"}
            </Button>
          </div>

          {patches.length > 0 ? (
            <div>
              <p>Found {patches.length} patches</p>
              <div style={{ display: "grid", gap: 20 }}>
                {patches.map((p, i) => {
                  const patch = p.patch?.JamManPatch;
                  const patchName = patch?.PatchName?.[0] || p.dir;

                  return (
                    <Card key={i}>
                      <CardHeader>{patchName}</CardHeader>
                      <CardBody>
                        <Table borderless>
                          <tbody>
                            <tr>
                              <td>
                                <strong>Directory:</strong>
                              </td>
                              <td>{p.dir}</td>
                            </tr>
                            <tr>
                              <td>
                                <strong>ID:</strong>
                              </td>
                              <td>{patch?.ID?.[0] || "N/A"}</td>
                            </tr>
                            <tr>
                              <td>
                                <strong>Origin ID:</strong>
                              </td>
                              <td>{patch?.OriginID?.[0] || "N/A"}</td>
                            </tr>
                            <tr>
                              <td>
                                <strong>Rhythm Type:</strong>
                              </td>
                              <td>{patch?.RhythmType?.[0] || "N/A"}</td>
                            </tr>
                            <tr>
                              <td>
                                <strong>Stop Mode:</strong>
                              </td>
                              <td>{patch?.StopMode?.[0] || "N/A"}</td>
                            </tr>
                          </tbody>
                        </Table>

                        <Card>
                          <CardHeader>Phrases</CardHeader>
                          <Table className="mb-0">
                            <thead>
                              <tr>
                                <th>Directory</th>
                                <th>ID</th>
                                <th>BPM</th>
                                <th>Loop</th>
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
                                  <tr key={phrase?.ID?.[0]}>
                                    <td>{dir}</td>
                                    <td>{phrase?.ID?.[0] || "N/A"}</td>
                                    <td>
                                      {phrase?.BeatsPerMinute?.[0] || "N/A"}
                                    </td>
                                    <td>
                                      {phrase?.IsLoop?.[0] === "true"
                                        ? "Yes"
                                        : "No"}
                                    </td>
                                    <td>
                                      {phrase?.BeatsPerMeasure?.[0] || "N/A"}
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
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 40 }}>
              <p>
                No patches loaded. Click "Load SD Card" to select your JamMan SD
                card.
              </p>
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
}

export default App;

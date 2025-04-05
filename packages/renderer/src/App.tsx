import { useState } from "react";
import { Patch } from "./types";

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

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
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
        <button
          onClick={handleLoad}
          disabled={loading}
          style={{
            padding: "8px 16px",
            backgroundColor: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {loading ? "Loading..." : "Load SD Card"}
        </button>
      </div>

      {patches.length > 0 ? (
        <div>
          <p>Found {patches.length} patches</p>
          <div style={{ display: "grid", gap: 20 }}>
            {patches.map((p, i) => {
              const patch = p.patch?.JamManPatch;
              const patchName = patch?.PatchName?.[0] || p.dir;

              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <h2 style={{ marginTop: 0 }}>{patchName}</h2>

                  <div>
                    <div>
                      <h3>Patch Details</h3>
                      <table style={{ width: "100%" }}>
                        <tbody>
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
                          <tr>
                            <td>
                              <strong>Directory:</strong>
                            </td>
                            <td>{p.dir}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3>Phrases' Details</h3>
                    <table style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>BPM</th>
                          <th>Loop</th>
                          <th>Time Signature</th>
                          <th>Directory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.phrases.map(
                          ({ data: { JamManPhrase: phrase }, dir }) => (
                            <tr key={phrase?.ID?.[0]}>
                              <td>{phrase?.ID?.[0] || "N/A"}</td>
                              <td>{phrase?.BeatsPerMinute?.[0] || "N/A"}</td>
                              <td>
                                {phrase?.IsLoop?.[0] === "true" ? "Yes" : "No"}
                              </td>
                              <td>{phrase?.BeatsPerMeasure?.[0] || "N/A"}</td>
                              <td>{dir}</td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
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
    </div>
  );
}

export default App;

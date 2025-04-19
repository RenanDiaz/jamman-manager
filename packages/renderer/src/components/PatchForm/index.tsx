import { FC, FormEvent, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Row,
} from "reactstrap";
import { Patch, RhythmType, StopMode } from "../../types";
import classNames from "classnames";

type PhraseForm = {
  name: string;
  wavPath: string;
  beatsPerMinute: number;
  beatsPerMeasure: number;
  isLoop: boolean;
  isReversed: boolean;
};

interface Props {
  formId: string;
  basePath: string;
  busyPatches: string[];
  initialData?: Patch;
  onSuccess: () => void;
}

export const PatchForm: FC<Props> = ({
  formId,
  basePath,
  busyPatches,
  initialData,
  onSuccess,
}) => {
  const [patchName, setPatchName] = useState("");
  const [rhythmType, setRhythmType] = useState<RhythmType>(
    RhythmType.StudioKickAndHighHat
  );
  const [stopMode, setStopMode] = useState<StopMode>(StopMode.StopInstantly);
  const [phrases, setPhrases] = useState<PhraseForm[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (initialData) {
      const data = initialData.data.JamManPatch;
      setPatchName(data.PatchName[0]);
      setRhythmType(data.RhythmType[0] as RhythmType);
      setStopMode(data.StopMode[0] as StopMode);
      setPhrases(
        initialData.phrases.map(
          ({ dir, data: { JamManPhrase: data }, wavPath }) => ({
            name: dir,
            wavPath,
            beatsPerMinute: Number(data.BeatsPerMinute[0]),
            beatsPerMeasure: Number(data.BeatsPerMeasure[0]),
            isLoop: data.IsLoop[0] === "1",
            isReversed: data.IsReversed[0] === "1",
          })
        )
      );
    }
    setIsEditing(!!initialData);
  }, [initialData]);

  const addPhrase = () => {
    const nextChar = String.fromCharCode(65 + phrases.length); // A, B, C...
    setPhrases([
      ...phrases,
      {
        name: `Phrase${nextChar}`,
        wavPath: "",
        beatsPerMinute: 120,
        beatsPerMeasure: 4,
        isLoop: true,
        isReversed: false,
      },
    ]);
  };

  const handleFileSelect = async (index: number) => {
    const filePath = await window.electronAPI.selectFile();
    if (!filePath) return;
    const updated = [...phrases];
    updated[index].wavPath = filePath;
    setPhrases(updated);
  };

  const updatePhrase = (index: number, changes: Partial<PhraseForm>) => {
    const updated = [...phrases];
    updated[index] = { ...updated[index], ...changes };
    setPhrases(updated);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const directory = (e.target as HTMLFormElement).directory.value;
    if (
      !basePath ||
      !directory ||
      phrases.length === 0 ||
      phrases.some((p) => !p.wavPath)
    ) {
      alert("Please complete all fields and select WAV files.");
      return;
    }

    if (isEditing && !!initialData) {
      const patchID = initialData.data.JamManPatch.ID?.[0];
      const patchOriginID = initialData.data.JamManPatch.OriginID?.[0];
      const settingsVersion = initialData.data.JamManPatch.SettingsVersion[0];
      await window.electronAPI.updatePatch({
        basePath,
        directory,
        patchName,
        rhythmType,
        stopMode,
        settingsVersion,
        patchID,
        patchOriginID,
        phrases,
      });
    } else {
      await window.electronAPI.createPatch({
        basePath,
        directory,
        patchName,
        rhythmType,
        stopMode,
        phrases,
      });
    }

    if (isEditing) {
      alert("Patch updated successfully!");
    } else {
      alert("Patch created successfully!");
    }
    // Optionally reset
    setPatchName("");
    setPhrases([]);
    setRhythmType(RhythmType.StudioKickAndHighHat);
    setStopMode(StopMode.StopInstantly);
    setIsEditing(false);
    onSuccess();
  };

  return (
    <Card>
      <CardBody>
        <Form onSubmit={handleSubmit} id={formId}>
          <FormGroup floating>
            <Input
              type="select"
              id="directory"
              placeholder="Directory"
              disabled={isEditing}
            >
              {isEditing ? (
                <option value={initialData?.dir}>{initialData?.dir}</option>
              ) : (
                Array.from({ length: 99 }, (_, i) => {
                  const num = `${i + 1}`.padStart(2, "0");
                  const dir = `Patch${num}`;
                  return (
                    <option
                      key={i}
                      value={dir}
                      hidden={busyPatches.includes(dir)}
                      disabled={busyPatches.includes(dir)}
                    >
                      {dir}
                    </option>
                  );
                })
              )}
            </Input>
            <Label for="directory">Directory</Label>
          </FormGroup>

          <FormGroup floating>
            <Input
              type="text"
              id="patchName"
              value={patchName}
              onChange={(e) => setPatchName(e.target.value)}
              placeholder="Patch Name"
            />
            <Label for="patchName">Patch Name</Label>
          </FormGroup>

          <FormGroup floating>
            <Input
              type="select"
              id="rhythmType"
              value={rhythmType}
              onChange={(e) => setRhythmType(e.target.value as RhythmType)}
              placeholder="Rhythm Type"
            >
              <option value={RhythmType.Silence}>Silence (Off)</option>
              <option value={RhythmType.WoodBlocks}>Wood Blocks (r1)</option>
              <option value={RhythmType.Sticks}>Sticks (r2)</option>
              <option value={RhythmType.Click}>Click (r3)</option>
              <option value={RhythmType.AlternativeKickAndHighHat}>
                Alternative Kick + HH (r4)
              </option>
              <option value={RhythmType.StudioKickAndHighHat}>
                Studio Kick + HH (r5)
              </option>
              <option value={RhythmType.TechnoKickAndHighHat}>
                Techno Kick + HH (r6)
              </option>
              <option value={RhythmType.Cowbell}>Cowbell (r7)</option>
              <option value={RhythmType.Conga}>Conga (r8)</option>
              <option value={RhythmType.Tambourine}>Tambourine (r9)</option>
            </Input>
            <Label for="rythmType">Rhythm Type</Label>
          </FormGroup>
          <FormGroup floating>
            <Input
              type="select"
              id="stopMode"
              placeholder="Stop Mode"
              value={stopMode}
              onChange={(e) => setStopMode(e.target.value as StopMode)}
            >
              <option value={StopMode.StopInstantly}>
                Stop Instantly (STOP)
              </option>
              <option value={StopMode.StopAtEndOfLoop}>
                Stop At End Of Loop (FINISH)
              </option>
              <option value={StopMode.FadeOut}>Fade Out (FADE)</option>
            </Input>
            <Label for="stopMode">Stop Mode</Label>
          </FormGroup>
          <Card>
            <CardHeader>
              <Row className="align-items-center">
                <Col>Phrases</Col>
                <Col xs="auto">
                  <Button
                    type="button"
                    color="primary"
                    size="sm"
                    onClick={addPhrase}
                  >
                    Add
                  </Button>
                </Col>
              </Row>
            </CardHeader>
            <CardBody>
              {phrases.length === 0 ? (
                <>
                  <Row>
                    <Col>
                      <p className="text-center">No phrases added yet.</p>
                    </Col>
                  </Row>
                  <Row className="justify-content-center">
                    <Col xs="auto">
                      <Button
                        type="button"
                        color="primary"
                        size="sm"
                        onClick={addPhrase}
                      >
                        Add Phrase
                      </Button>
                    </Col>
                  </Row>
                </>
              ) : (
                phrases.map((phrase, index) => (
                  <Card
                    key={phrase.name}
                    className={classNames({ "mt-3": index > 0 })}
                  >
                    <CardHeader>{phrase.name}</CardHeader>
                    <CardBody>
                      <FormGroup>
                        <Button
                          color="secondary"
                          onClick={() => handleFileSelect(index)}
                        >
                          Select WAV File
                        </Button>
                      </FormGroup>
                      {phrase.wavPath && (
                        <p className="text-sm">{phrase.wavPath}</p>
                      )}

                      <FormGroup floating>
                        <Input
                          type="number"
                          id={`bpm-${index}`}
                          placeholder="BPM"
                          value={phrase.beatsPerMinute}
                          onChange={(e) =>
                            updatePhrase(index, {
                              beatsPerMinute: Number(e.target.value),
                            })
                          }
                        />
                        <Label for={`bpm-${index}`}>BPM</Label>
                      </FormGroup>
                      <FormGroup floating>
                        <Input
                          type="number"
                          id={`timeSignature-${index}`}
                          placeholder="Time Signature"
                          min="2"
                          max="15"
                          value={phrase.beatsPerMeasure}
                          onChange={(e) =>
                            updatePhrase(index, {
                              beatsPerMeasure: Number(e.target.value),
                            })
                          }
                        />
                        <Label for={`timeSignature-${index}`}>
                          Time Signature
                        </Label>
                      </FormGroup>

                      <FormGroup check>
                        <Label check>
                          <Input
                            type="checkbox"
                            checked={phrase.isLoop}
                            onChange={(e) =>
                              updatePhrase(index, { isLoop: e.target.checked })
                            }
                          />
                          Loop
                        </Label>
                      </FormGroup>
                      <FormGroup check>
                        <Label check>
                          <Input
                            type="checkbox"
                            checked={phrase.isReversed}
                            onChange={(e) =>
                              updatePhrase(index, {
                                isReversed: e.target.checked,
                              })
                            }
                          />
                          Reversed
                        </Label>
                      </FormGroup>
                    </CardBody>
                  </Card>
                ))
              )}
            </CardBody>
          </Card>
        </Form>
      </CardBody>
    </Card>
  );
};

export default PatchForm;

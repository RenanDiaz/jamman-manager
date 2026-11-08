import { FC, FormEvent, useState } from 'react';
import { Patch, RhythmType, StopMode } from '../../types';
import { usePatchStore } from '../../store/usePatchStore';
import {
  ChoiceGroup,
  cx,
  Field,
  Input,
  Knob,
  LedToggle,
  Notice,
  PanelKey,
  Pill,
  Select,
} from '../../ui';
import { RHYTHM_LABEL, RHYTHM_ORDER, STOP_MODES } from '../../utils/patchView';
import { fileName } from '../../utils/format';
import s from './PatchForm.module.css';

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
  /** Slot preselected when creating, e.g. after clicking an empty slot. */
  defaultDirectory?: string;
  onSuccess: () => void;
}

export const PatchForm: FC<Props> = ({
  formId,
  basePath,
  busyPatches,
  initialData,
  defaultDirectory,
  onSuccess,
}) => {
  // The form state is seeded from `initialData` once, at mount. The parent gives the
  // form a `key` per patch, so editing another patch mounts a fresh form.
  const patchData = initialData?.data.JamManPatch;
  const [patchName, setPatchName] = useState(() => patchData?.PatchName[0] ?? '');
  const [rhythmType, setRhythmType] = useState<RhythmType>(
    () => (patchData?.RhythmType?.[0] as RhythmType | undefined) ?? RhythmType.StudioKickAndHighHat,
  );
  const [stopMode, setStopMode] = useState<StopMode>(
    () => (patchData?.StopMode?.[0] as StopMode | undefined) ?? StopMode.StopInstantly,
  );
  const [phrases, setPhrases] = useState<PhraseForm[]>(() =>
    (initialData?.phrases ?? []).map(({ dir, data: { JamManPhrase: data }, wavPath }) => ({
      name: dir,
      wavPath,
      beatsPerMinute: Number(data.BeatsPerMinute[0]),
      beatsPerMeasure: Number(data.BeatsPerMeasure[0]),
      isLoop: data.IsLoop?.[0] === '1',
      isReversed: data.IsReversed?.[0] === '1',
    })),
  );
  const [isEditing, setIsEditing] = useState(() => !!initialData);
  const [error, setError] = useState<string | null>(null);

  const addPhrase = () => {
    const nextChar = String.fromCharCode(65 + phrases.length); // A, B, C...
    setPhrases([
      ...phrases,
      {
        name: `Phrase${nextChar}`,
        wavPath: '',
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

  const { createPatch, updatePatch } = usePatchStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const directory = (e.target as HTMLFormElement).directory.value;
    if (!basePath || !directory || phrases.length === 0 || phrases.some(p => !p.wavPath)) {
      setError(
        phrases.length === 0
          ? 'Add at least one phrase before saving.'
          : phrases.some(p => !p.wavPath)
            ? 'Choose a WAV file for every phrase before saving.'
            : 'Load a card and pick a free slot before saving.',
      );
      return;
    }
    setError(null);

    try {
      if (isEditing && !!initialData) {
        const patchID = initialData.data.JamManPatch.ID?.[0];
        const patchOriginID = initialData.data.JamManPatch.OriginID?.[0];
        const settingsVersion = initialData.data.JamManPatch.SettingsVersion?.[0];
        await updatePatch({
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
        await createPatch({
          basePath,
          directory,
          patchName,
          rhythmType,
          stopMode,
          phrases,
        });
      }

      // Reset form
      setPatchName('');
      setPhrases([]);
      setRhythmType(RhythmType.StudioKickAndHighHat);
      setStopMode(StopMode.StopInstantly);
      setIsEditing(false);
      onSuccess();
    } catch (error) {
      // Error handling is done in the store
      console.error('Form submission error:', error);
    }
  };

  const rhythmIndex = RHYTHM_ORDER.indexOf(rhythmType);
  const stopModeKnown = STOP_MODES.some(m => m.mode === stopMode);

  return (
    <form onSubmit={handleSubmit} id={formId} className={s.form} noValidate>
      <div className={s.identity}>
        <Field label="Slot" htmlFor="directory">
          <Select
            id="directory"
            disabled={isEditing}
            defaultValue={isEditing ? undefined : defaultDirectory}
          >
            {isEditing ? (
              <option value={initialData?.dir}>{initialData?.dir}</option>
            ) : (
              Array.from({ length: 99 }, (_, i) => {
                const num = `${i + 1}`.padStart(2, '0');
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
          </Select>
        </Field>
        <Field label="Name" htmlFor="patchName">
          <Input
            type="text"
            id="patchName"
            value={patchName}
            onChange={e => setPatchName(e.target.value)}
            placeholder="Untitled"
            autoComplete="off"
          />
        </Field>
      </div>

      <div className={s.settings}>
        <div className={s.rhythm}>
          <Knob index={rhythmIndex} count={RHYTHM_ORDER.length} className={s.knob} />
          <Field label="Rhythm" htmlFor="rhythmType" className={s.grow}>
            <Select
              id="rhythmType"
              value={rhythmType}
              onChange={e => setRhythmType(e.target.value as RhythmType)}
            >
              {rhythmIndex < 0 && <option value={rhythmType}>{rhythmType} (as on the card)</option>}
              {RHYTHM_ORDER.map((type, i) => (
                <option key={type} value={type}>
                  {RHYTHM_LABEL[type]} ({i === 0 ? 'Off' : `r${i}`})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ChoiceGroup
          legend="Stop mode"
          name="stopMode"
          value={stopMode}
          onChange={setStopMode}
          hint={
            stopModeKnown
              ? undefined
              : `This patch has “${stopMode}”, which isn't a pedal stop mode. Pick one to replace it.`
          }
          options={STOP_MODES.map(({ mode, short, description }) => ({
            value: mode,
            label: (
              <>
                <Pill>{short}</Pill>
                {description}
              </>
            ),
          }))}
        />
      </div>

      <section className={s.phrases} aria-labelledby="phrases-heading">
        <div className={s.phrasesHead}>
          <h3 id="phrases-heading" className={s.heading}>
            Phrases
          </h3>
          {phrases.length > 0 && <PanelKey label="Add phrase" size="sm" onClick={addPhrase} />}
        </div>

        {phrases.length === 0 ? (
          <div className={s.noPhrases}>
            <p>A patch needs at least one phrase with a WAV file.</p>
            <PanelKey label="Add phrase" onClick={addPhrase} />
          </div>
        ) : (
          <ol className={s.phraseList}>
            {phrases.map((phrase, index) => (
              <li key={phrase.name} className={s.phrase}>
                <span className={s.phraseName}>{phrase.name.replace(/^Phrase/, 'Phrase ')}</span>
                <div className={s.wav}>
                  <PanelKey
                    label={phrase.wavPath ? 'Change WAV' : 'Choose WAV'}
                    size="sm"
                    aria-label={`${phrase.wavPath ? 'Change' : 'Choose'} WAV file for ${phrase.name}`}
                    onClick={() => handleFileSelect(index)}
                  />
                  <span
                    className={cx(s.file, !phrase.wavPath && s.fileMissing)}
                    title={phrase.wavPath || undefined}
                  >
                    {phrase.wavPath ? fileName(phrase.wavPath) : 'No file yet'}
                  </span>
                </div>
                <Field label="BPM" htmlFor={`bpm-${index}`} className={s.number}>
                  <Input
                    type="number"
                    id={`bpm-${index}`}
                    value={phrase.beatsPerMinute}
                    onChange={e =>
                      updatePhrase(index, {
                        beatsPerMinute: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Beats/bar" htmlFor={`timeSignature-${index}`} className={s.number}>
                  <Input
                    type="number"
                    id={`timeSignature-${index}`}
                    min="2"
                    max="15"
                    value={phrase.beatsPerMeasure}
                    onChange={e =>
                      updatePhrase(index, {
                        beatsPerMeasure: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <div className={s.flags}>
                  <LedToggle
                    pressed={phrase.isLoop}
                    onChange={isLoop => updatePhrase(index, { isLoop })}
                  >
                    Loop
                  </LedToggle>
                  <LedToggle
                    pressed={phrase.isReversed}
                    onChange={isReversed => updatePhrase(index, { isReversed })}
                  >
                    Reverse
                  </LedToggle>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {error && (
        <Notice tone="danger" role="alert">
          <p>{error}</p>
        </Notice>
      )}
    </form>
  );
};

export default PatchForm;

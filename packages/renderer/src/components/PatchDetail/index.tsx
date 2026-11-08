import { FC, useMemo } from 'react';
import type { Patch } from '../../types';
import { RHYTHM_ORDER, STOP_MODES, toPatchView } from '../../utils/patchView';
import {
  cx,
  DisplayWindow,
  Knob,
  Led,
  Legend,
  Panel,
  PanelKey,
  Pill,
  SevenSegment,
} from '../../ui';
import PhrasePlayer from '../PhrasePlayer';
import s from './PatchDetail.module.css';

interface Props {
  patch: Patch;
  onEdit: (directory: string) => void;
  onDelete: (directory: string) => void;
}

/** The focused patch on its own control panel: display, rhythm knob, stop mode, phrases. */
export const PatchDetail: FC<Props> = ({ patch, onEdit, onDelete }) => {
  const view = useMemo(() => toPatchView(patch), [patch]);
  const first = view.phrases[0];
  const rhythmIndex = RHYTHM_ORDER.indexOf(view.rhythm as (typeof RHYTHM_ORDER)[number]);
  const stop = STOP_MODES.find(m => m.mode === view.stopMode);

  return (
    <Panel as="aside" screws="top" className={s.detail} aria-label={`Patch ${view.dir}`}>
      <div className={s.display}>
        <DisplayWindow className={s.bigWindow}>
          <SevenSegment value={view.slot} height={56} />
        </DisplayWindow>
        <div className={s.tempo}>
          <Legend tone="muted">Tempo</Legend>
          <span className={s.tempoValue}>{first?.bpm ?? '--'}</span>
          {first?.bpm && (
            <span className={s.tempoBeat}>
              <Led color="yellow" shape="round" on blinkSeconds={60 / first.bpm} />
              {first.beatsPerMeasure && <Pill>{first.beatsPerMeasure} beats/bar</Pill>}
            </span>
          )}
        </div>
      </div>

      <div>
        <h2 className={cx(s.title, !view.name && s.untitled)}>{view.name || 'Untitled'}</h2>
        <div className={s.dir}>{view.dir}</div>
      </div>

      <div className={s.controls}>
        <div className={s.knob}>
          <Knob index={rhythmIndex} count={RHYTHM_ORDER.length} />
          <Legend>Rhythm</Legend>
          <Pill>{view.rhythmLabel}</Pill>
        </div>
        <div>
          <Legend>Stop mode</Legend>
          <ul className={s.stopList} aria-label="Stop mode">
            {STOP_MODES.map(m => {
              const current = m.mode === view.stopMode;
              return (
                <li key={m.mode} aria-current={current || undefined}>
                  <Led color="red" on={current} />
                  <Pill muted={!current} title={m.description}>
                    {m.short}
                  </Pill>
                </li>
              );
            })}
          </ul>
          <p className={s.help}>
            {stop ? `${stop.description} when you press stop.` : view.stopLabel}
          </p>
        </div>
      </div>

      <section aria-label="Phrases">
        <Legend className={s.sectionLegend}>Phrases</Legend>
        {view.phrases.length === 0 ? (
          <p className={s.noPhrases}>This patch has no phrases. Edit it to add one.</p>
        ) : (
          <ul className={s.phrases}>
            {view.phrases.map(phrase => (
              <li key={phrase.dir} className={s.phrase}>
                <div className={s.phraseInfo}>
                  <span className={s.phraseName}>{phrase.dir}</span>
                  <span>{phrase.bpm ?? '--'} bpm</span>
                  {phrase.beatsPerMeasure && <span>{phrase.beatsPerMeasure} beats/bar</span>}
                  <span className={s.ledLabel}>
                    <Led color="green" on={phrase.isLoop} />
                    Loop {phrase.isLoop ? 'on' : 'off'}
                  </span>
                  <span className={s.ledLabel}>
                    <Led color="red" on={phrase.isReversed} />
                    Reverse {phrase.isReversed ? 'on' : 'off'}
                  </span>
                </div>
                <PhrasePlayer
                  wavPath={phrase.wavPath}
                  patchDir={view.dir}
                  patchName={view.name}
                  phraseName={phrase.dir}
                  onPanel
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className={s.facts}>
        <dt>Device</dt>
        <dd>{view.device ?? 'Not set'}</dd>
        <dt>ID</dt>
        <dd title={view.id ?? undefined}>{view.id ?? 'Not set'}</dd>
        <dt>Origin ID</dt>
        <dd title={view.originId ?? undefined}>{view.originId ?? 'Not set'}</dd>
        <dt>Settings version</dt>
        <dd>{view.settingsVersion ?? 'Not set'}</dd>
      </dl>

      <div className={s.actions}>
        <PanelKey label="Delete" tone="danger" onClick={() => onDelete(view.dir)} />
        <PanelKey label="Edit patch" led onClick={() => onEdit(view.dir)} />
      </div>
    </Panel>
  );
};

export default PatchDetail;

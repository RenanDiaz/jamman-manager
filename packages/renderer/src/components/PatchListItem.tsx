import { FC, memo } from 'react';
import { usePlayPhrase } from '../hooks/usePlayPhrase';
import { useAudioPlayerStore } from '../store/useAudioPlayerStore';
import type { Patch } from '../types';
import { slotNumber } from '../utils/format';
import { toPatchView } from '../utils/patchView';
import {
  DisplayWindow,
  Led,
  Pill,
  Plate,
  SevenSegment,
  StompButton,
  VisuallyHidden,
  cx,
} from '../ui';
import s from './PatchListItem.module.css';

interface Props {
  patch: Patch;
  isSelected?: boolean;
  isFocused?: boolean;
  onFocus: (directory: string) => void;
  onToggleSelection?: (directory: string) => void;
  /** The pedal connected over USB has this patch loaded. */
  onPedal?: boolean;
}

/** One patch as a footswitch plate: slot display, name, tempo, loop/reverse LEDs, play. */
export const PatchListItem: FC<Props> = memo(
  ({
    patch,
    isSelected = false,
    isFocused = false,
    onFocus,
    onToggleSelection,
    onPedal = false,
  }) => {
    const view = toPatchView(patch);
    const first = view.phrases[0];
    const playPhrase = usePlayPhrase();
    const isPlaying = useAudioPlayerStore(
      state => !!state.audioInfo && view.phrases.some(p => p.wavPath === state.audioInfo?.wavPath),
    );
    const loops = view.phrases.some(p => p.isLoop);
    const reversed = view.phrases.some(p => p.isReversed);
    const phraseCount = `${view.phrases.length} phrase${view.phrases.length === 1 ? '' : 's'}`;

    return (
      <Plate className={s.row} focused={isFocused}>
        {onToggleSelection ? (
          <button
            type="button"
            className={s.select}
            aria-pressed={isSelected}
            aria-label={`Select ${view.dir}`}
            title={isSelected ? 'Selected' : 'Select'}
            onClick={() => onToggleSelection(view.dir)}
          >
            <Led color="red" shape="round" size={12} on={isSelected} />
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          className={s.main}
          data-patch-dir={view.dir}
          aria-current={isFocused || undefined}
          onClick={() => onFocus(view.dir)}
        >
          <DisplayWindow>
            <SevenSegment value={view.slot} height={20} />
          </DisplayWindow>
          <span className={s.text}>
            <VisuallyHidden>{view.dir} </VisuallyHidden>
            <span className={cx(s.name, !view.name && s.untitled)}>
              {view.name || 'Untitled'}
              {onPedal && (
                <Pill className={s.onPedal} title="The pedal has this patch loaded">
                  On pedal
                </Pill>
              )}
            </span>
            <span className={s.meta}>
              {view.rhythmLabel}, {view.stopLabel.toLowerCase()}, {phraseCount}
            </span>
          </span>
          <span className={s.bpm}>
            {first?.bpm ?? '--'} <small>bpm</small>
          </span>
          <span className={s.flags}>
            <span className={s.flag}>
              <Led color="green" on={loops} size={7} />
              Loop
            </span>
            <span className={s.flag}>
              <Led color="red" on={reversed} size={7} />
              Reverse
            </span>
          </span>
        </button>

        <StompButton
          label={`Play ${view.dir}`}
          active={isPlaying}
          disabled={!first}
          onClick={() =>
            first &&
            playPhrase({
              wavPath: first.wavPath,
              patchDir: view.dir,
              patchName: view.name,
              phraseName: first.dir,
            })
          }
        />
      </Plate>
    );
  },
);

PatchListItem.displayName = 'PatchListItem';

interface EmptySlotProps {
  dir: string;
  /** Without it (read-only source) the slot is shown but cannot be clicked. */
  onCreate?: (directory: string) => void;
}

/** A free slot on the card. Clicking it starts a new patch there. */
export const EmptySlotItem: FC<EmptySlotProps> = memo(({ dir, onCreate }) => (
  <li className={s.empty}>
    <button
      type="button"
      className={s.emptyMain}
      disabled={!onCreate}
      onClick={() => onCreate?.(dir)}
    >
      <span />
      <DisplayWindow className={s.emptyWindow}>
        <SevenSegment value={slotNumber(dir)} height={18} />
      </DisplayWindow>
      <span>
        <VisuallyHidden>{dir}: </VisuallyHidden>
        {onCreate ? 'Empty. Click to store a new patch here.' : 'Empty.'}
      </span>
    </button>
  </li>
));

EmptySlotItem.displayName = 'EmptySlotItem';

export default PatchListItem;

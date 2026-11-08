import { FC, memo, useMemo } from 'react';
import { patchDirForSlot } from '../../utils/format';
import { cx, Legend, Panel } from '../../ui';
import s from './MemoryMap.module.css';

interface Props {
  /** Folders present on the card, e.g. `Patch01`. */
  usedDirs: string[];
  focusedDir: string | null;
  onFocus: (directory: string) => void;
  /** Without it (read-only source) a free slot does nothing. */
  onCreateAt?: (directory: string) => void;
}

const SLOTS = Array.from({ length: 99 }, (_, i) => patchDirForSlot(i + 1));

/**
 * The card's 99 slots at a glance. A used slot focuses its patch; a free one starts a new
 * patch. Pointer shortcut only: keyboard users reach the same actions from the list.
 */
export const MemoryMap: FC<Props> = memo(({ usedDirs, focusedDir, onFocus, onCreateAt }) => {
  const used = useMemo(() => new Set(usedDirs), [usedDirs]);
  return (
    <Panel className={s.map}>
      <div className={s.grid} role="group" aria-label="Card slots">
        {SLOTS.map(dir => {
          const isUsed = used.has(dir);
          return (
            <button
              key={dir}
              type="button"
              className={cx(s.cell, isUsed && s.used, dir === focusedDir && s.focused)}
              aria-label={
                isUsed ? `Show ${dir}` : onCreateAt ? `New patch in ${dir}` : `${dir} (empty)`
              }
              title={isUsed ? dir : `${dir} (empty)`}
              tabIndex={-1}
              disabled={!isUsed && !onCreateAt}
              onClick={() => (isUsed ? onFocus(dir) : onCreateAt?.(dir))}
            />
          );
        })}
      </div>
      <div className={s.stat}>
        <Legend tone="muted">Card mem</Legend>
        <span>{used.size} / 99</span>
        <small>slots in use</small>
      </div>
    </Panel>
  );
});

MemoryMap.displayName = 'MemoryMap';

export default MemoryMap;

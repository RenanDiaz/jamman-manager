import { useRef, type KeyboardEvent } from 'react';
import { PanelKey } from './PanelKey';
import f from './form.module.css';
import { modePanelId, modeTabId } from './modeIds';

interface ModeKeysProps<T extends string> {
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for the tab and panel ids; pair panels with `modePanelId` / `modeTabId`. */
  idPrefix: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/**
 * Tabs drawn as a row of panel keys; the active one stays pressed with its LED lit, like
 * a mode key on the pedal. Arrow keys move between them (ARIA tabs pattern).
 */
export function ModeKeys<T extends string>({
  label,
  idPrefix,
  value,
  options,
  onChange,
}: ModeKeysProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const index = options.findIndex(o => o.value === value);
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(modeTabId(idPrefix, next.value))}`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={f.modeKeys}
      onKeyDown={onKeyDown}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <PanelKey
            key={option.value}
            id={modeTabId(idPrefix, option.value)}
            role="tab"
            aria-selected={selected}
            aria-controls={modePanelId(idPrefix, option.value)}
            tabIndex={selected ? 0 : -1}
            led={selected}
            label={option.label}
            onClick={() => onChange(option.value)}
          />
        );
      })}
    </div>
  );
}

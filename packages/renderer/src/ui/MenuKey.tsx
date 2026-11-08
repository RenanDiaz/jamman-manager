import { useEffect, useId, useRef, useState, type FC } from 'react';
import { PanelKey, type PanelKeyProps } from './PanelKey';
import s from './ui.module.css';

export interface MenuKeyItem {
  label: string;
  onSelect: () => void;
}

interface MenuKeyProps extends Omit<PanelKeyProps, 'onClick'> {
  items: MenuKeyItem[];
}

/** A `PanelKey` that opens a short list of choices under it. */
export const MenuKey: FC<MenuKeyProps> = ({ items, disabled, ...keyProps }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !wrapRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className={s.menuWrap} ref={wrapRef}>
      <PanelKey
        {...keyProps}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(o => !o)}
      />
      {open && !disabled && (
        <ul className={s.menu} role="menu" id={menuId}>
          {items.map(item => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={s.menuItem}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

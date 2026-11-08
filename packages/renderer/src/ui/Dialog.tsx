import { useEffect, useId, useRef, type FC, type ReactNode } from 'react';
import { cx } from './cx';
import { Panel } from './Panel';
import { PanelKey } from './PanelKey';
import { raiseTopLayers } from './raiseTopLayers';
import s from './dialog.module.css';

interface DialogProps {
  isOpen: boolean;
  /** Asked to close: Escape, the close key or a click on the backdrop. */
  onClose: () => void;
  /** Runs once the dialog has actually closed, whatever closed it. */
  onClosed?: () => void;
  title: ReactNode;
  /** Short line under the title. */
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Keys on the bottom edge; the primary one goes last. */
  footer?: ReactNode;
  /** While false, Escape, the close key and the backdrop do nothing (e.g. while saving). */
  dismissible?: boolean;
  children: ReactNode;
}

/**
 * Modal panel lifted over the chassis. Built on the native <dialog>: the browser handles
 * the focus trap, Escape and making the rest of the window inert. The content is only
 * mounted while open, so forms start fresh every time.
 */
export const Dialog: FC<DialogProps> = ({
  isOpen,
  onClose,
  onClosed,
  title,
  subtitle,
  size = 'md',
  footer,
  dismissible = true,
  children,
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // A click only counts as "on the backdrop" if it also started there, so dragging a text
  // selection out of an input doesn't close the dialog.
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      raiseTopLayers();
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const requestClose = () => {
    if (dismissible) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={cx(s.dialog, s[size])}
      aria-labelledby={titleId}
      onCancel={e => {
        e.preventDefault();
        requestClose();
      }}
      onClose={onClosed}
      onMouseDown={e => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={e => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) requestClose();
      }}
    >
      {isOpen && (
        <Panel screws="top" className={s.panel}>
          <header className={s.header}>
            <div className={s.heading}>
              <h2 id={titleId} className={s.title}>
                {title}
              </h2>
              {subtitle && <p className={s.subtitle}>{subtitle}</p>}
            </div>
            <PanelKey
              label="×"
              aria-label="Close"
              hint="Esc"
              size="sm"
              className={s.close}
              onClick={requestClose}
              disabled={!dismissible}
            />
          </header>
          <div className={s.body}>{children}</div>
          {footer && <footer className={s.footer}>{footer}</footer>}
        </Panel>
      )}
    </dialog>
  );
};

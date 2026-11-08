import type { ButtonHTMLAttributes, FC, ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

export interface PanelKeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Text printed on the key; also its accessible name unless `aria-label` is given. */
  label: ReactNode;
  /** Pill under the key: the shortcut or secondary function. Informative only. */
  hint?: string;
  /** Small red LED in the key's corner: on marks the primary action (like STORE). */
  led?: boolean;
  tone?: 'default' | 'danger';
  /** `sm` for keys inside rows and the dialog's close key. */
  size?: 'md' | 'sm';
}

/** Black rubber key from the pedal's control panel. */
export const PanelKey: FC<PanelKeyProps> = ({
  label,
  hint,
  led,
  tone = 'default',
  size = 'md',
  className,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={cx(s.key, tone === 'danger' && s.keyDanger, size === 'sm' && s.keySm, className)}
    {...rest}
  >
    <span className={cx(s.cap, led !== undefined && s.capWithLed)}>
      {led !== undefined && <span className={cx(s.keyDot, led && s.keyDotOn)} />}
      {label}
    </span>
    {hint && (
      <span className={s.pill} aria-hidden="true">
        {hint}
      </span>
    )}
  </button>
);

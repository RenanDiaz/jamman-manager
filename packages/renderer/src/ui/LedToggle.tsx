import type { ButtonHTMLAttributes, FC, ReactNode } from 'react';
import { Led } from './Led';
import { cx } from './cx';
import s from './ui.module.css';

interface LedToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
}

/** On/off switch shown as a green LED next to its label. */
export const LedToggle: FC<LedToggleProps> = ({
  pressed,
  onChange,
  className,
  children,
  ...rest
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    className={cx(s.toggle, className)}
    onClick={() => onChange(!pressed)}
    {...rest}
  >
    <Led color="green" on={pressed} />
    {children}
  </button>
);

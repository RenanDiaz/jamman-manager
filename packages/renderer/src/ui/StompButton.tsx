import type { ButtonHTMLAttributes, FC } from 'react';
import { PlayIcon } from '../utils/Images';
import { cx } from './cx';
import s from './ui.module.css';

interface StompButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, e.g. "Play PhraseA". */
  label: string;
  /** This button's audio is the one loaded in the player. */
  active?: boolean;
  /** Sits on a black panel instead of the blue chassis (changes the ring). */
  onPanel?: boolean;
}

/** Chrome stomp switch. Plays audio. */
export const StompButton: FC<StompButtonProps> = ({
  label,
  active = false,
  onPanel = false,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    aria-label={label}
    title={label}
    className={cx(s.stomp, onPanel && s.stompOnPanel, active && s.stompActive, className)}
    {...rest}
  >
    {children ?? <PlayIcon />}
  </button>
);

import type { FC, HTMLAttributes } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  /** Dims the pill, e.g. an option that is not the chosen one. */
  muted?: boolean;
}

/** White pill printed under a control: its shortcut or secondary function. */
export const Pill: FC<PillProps> = ({ muted = false, className, ...rest }) => (
  <span className={cx(s.pill, muted && s.pillMuted, className)} {...rest} />
);

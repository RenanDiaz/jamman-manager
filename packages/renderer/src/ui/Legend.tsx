import type { FC, HTMLAttributes } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

interface LegendProps extends HTMLAttributes<HTMLSpanElement> {
  /** `muted` is the grey print used for secondary legends on a black panel. */
  tone?: 'default' | 'muted';
}

/** Screen-printed legend: condensed, bold, upper case through CSS only. */
export const Legend: FC<LegendProps> = ({ tone = 'default', className, ...rest }) => (
  <span className={cx(s.legend, tone === 'muted' && s.legendMuted, className)} {...rest} />
);

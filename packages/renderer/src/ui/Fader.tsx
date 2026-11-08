import type { CSSProperties, FC, InputHTMLAttributes } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

interface FaderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: number;
  min?: number;
  max?: number;
}

/** Horizontal slider on a black slot; the filled part is lit in display green. */
export const Fader: FC<FaderProps> = ({ value, min = 0, max = 100, className, style, ...rest }) => {
  const span = max - min;
  const fill = span > 0 ? ((value - min) / span) * 100 : 0;
  return (
    <input
      type="range"
      className={cx(s.fader, className)}
      min={min}
      max={max}
      value={value}
      style={{ ...style, '--jm-fill': `${fill}%` } as CSSProperties}
      {...rest}
    />
  );
};

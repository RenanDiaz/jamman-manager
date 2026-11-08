import type { CSSProperties, FC } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

export type LedColor = 'red' | 'green' | 'yellow';

interface LedProps {
  color: LedColor;
  on?: boolean;
  shape?: 'square' | 'round';
  /** Pixel size of the LED (default 9). */
  size?: number;
  /** Blink period in seconds, e.g. `60 / bpm` for a tempo LED. */
  blinkSeconds?: number;
  className?: string;
}

const ON_CLASS: Record<LedColor, string> = {
  red: s.ledRed,
  green: s.ledGreen,
  yellow: s.ledYellow,
};

/** Status LED. Decorative: the state it shows must also be in text or an ARIA attribute. */
export const Led: FC<LedProps> = ({
  color,
  on = false,
  shape = 'square',
  size,
  blinkSeconds,
  className,
}) => {
  const style: CSSProperties & Record<string, string | number> = {};
  if (size) {
    style.width = size;
    style.height = size;
  }
  if (on && blinkSeconds) style['--jm-blink'] = `${blinkSeconds}s`;

  return (
    <span
      aria-hidden="true"
      className={cx(
        s.led,
        shape === 'round' && s.ledRound,
        on && ON_CLASS[color],
        on && !!blinkSeconds && s.ledBlink,
        className,
      )}
      style={style}
    />
  );
};

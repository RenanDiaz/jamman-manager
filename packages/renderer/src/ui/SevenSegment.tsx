import type { FC, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/** Segment rectangles in a 12×20 cell: [x, y, width, height]. */
const SEGMENTS = {
  a: [2.5, 0.5, 7, 1.6],
  b: [9.6, 2.2, 1.6, 7],
  c: [9.6, 10.8, 1.6, 7],
  d: [2.5, 17.9, 7, 1.6],
  e: [0.8, 10.8, 1.6, 7],
  f: [0.8, 2.2, 1.6, 7],
  g: [2.5, 9.2, 7, 1.6],
} as const;

const GLYPHS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

interface SevenSegmentProps {
  /** Digits, `-`, `:` and spaces. Anything else renders as a blank cell. */
  value: string;
  /** Digit height in pixels. */
  height?: number;
  className?: string;
}

/**
 * Green 7-segment readout, like the pedal's loop display. Unlit segments stay
 * faintly visible. Decorative: give the surrounding element the text value.
 */
export const SevenSegment: FC<SevenSegmentProps> = ({ value, height = 26, className }) => {
  const width = height * 0.6;
  return (
    <span className={cx(s.seg, className)} aria-hidden="true">
      {[...value].map((ch, i) =>
        ch === ':' ? (
          <svg key={i} width={height * 0.2} height={height} viewBox="0 0 4 20">
            <circle cx="2" cy="6.5" r="1.1" className={s.segOn} />
            <circle cx="2" cy="13.5" r="1.1" className={s.segOn} />
          </svg>
        ) : (
          <svg key={i} width={width} height={height} viewBox="0 0 12 20">
            <g transform="skewX(-6) translate(1 0)">
              {Object.entries(SEGMENTS).map(([name, [x, y, w, h]]) => (
                <rect
                  key={name}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={0.8}
                  className={(GLYPHS[ch] ?? '').includes(name) ? s.segOn : s.segOff}
                />
              ))}
            </g>
          </svg>
        ),
      )}
    </span>
  );
};

interface DisplayWindowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Smoked window recessed into the panel that holds a `SevenSegment`. */
export const DisplayWindow: FC<DisplayWindowProps> = ({ className, ...rest }) => (
  <div className={cx(s.window, className)} {...rest} />
);

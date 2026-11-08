import { useId, type FC } from 'react';
import s from './ui.module.css';

interface KnobProps {
  /** Position of the pointer, 0-based. A negative index leaves every tick unmarked. */
  index: number;
  /** Number of printed positions on the scale. */
  count: number;
  className?: string;
}

const START = -135;
const END = 135;

/**
 * Black knob with a white pointer over a printed tick scale. Decorative. With an unknown
 * value (negative index) the pointer is left out rather than pointing at a wrong position.
 */
export const Knob: FC<KnobProps> = ({ index, count, className }) => {
  const gradientId = useId();
  const angleOf = (i: number) => START + ((END - START) * i) / Math.max(1, count - 1);

  return (
    <svg className={className ?? s.knob} viewBox="0 0 78 78" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx=".4" cy=".35">
          <stop offset="0" stopColor="#3a3d43" />
          <stop offset="1" stopColor="#0c0d0f" />
        </radialGradient>
      </defs>
      {Array.from({ length: count }, (_, i) => {
        const t = (angleOf(i) * Math.PI) / 180;
        const current = i === index;
        return (
          <line
            key={i}
            x1={39 + Math.sin(t) * 30}
            y1={39 - Math.cos(t) * 30}
            x2={39 + Math.sin(t) * 36}
            y2={39 - Math.cos(t) * 36}
            stroke="var(--jm-legend)"
            strokeWidth={current ? 2.6 : 1.4}
            opacity={current ? 1 : 0.7}
          />
        );
      })}
      <circle cx="39" cy="40" r="24" fill="#000" />
      <circle cx="39" cy="39" r="23" fill={`url(#${gradientId})`} />
      {index >= 0 && (
        <line
          x1="39"
          y1="39"
          x2="39"
          y2="19"
          stroke="var(--jm-legend)"
          strokeWidth="3"
          strokeLinecap="round"
          transform={`rotate(${angleOf(index)} 39 39)`}
        />
      )}
    </svg>
  );
};

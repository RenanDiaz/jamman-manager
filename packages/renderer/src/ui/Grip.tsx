import type { FC } from 'react';
import s from './ui.module.css';

/** Six dots marking something you can drag. Decorative. */
export const Grip: FC = () => (
  <svg className={s.grip} viewBox="0 0 8 14" aria-hidden="true">
    {[2, 7, 12].map(y => (
      <g key={y}>
        <circle cx="2" cy={y} r="1.2" />
        <circle cx="6" cy={y} r="1.2" />
      </g>
    ))}
  </svg>
);

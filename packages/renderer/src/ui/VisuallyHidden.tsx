import type { FC, ReactNode } from 'react';
import s from './ui.module.css';

/** Text for screen readers and tests only. */
export const VisuallyHidden: FC<{ children: ReactNode }> = ({ children }) => (
  <span className={s.srOnly}>{children}</span>
);

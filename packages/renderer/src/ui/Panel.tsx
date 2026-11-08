import type { FC, HTMLAttributes } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

type PanelTag = 'div' | 'header' | 'footer' | 'aside' | 'section';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: PanelTag;
  /** Corner screws: all four, only the top two, or none. */
  screws?: 'all' | 'top' | 'none';
}

/** Black control panel, the surface for displays, keys and knobs. */
export const Panel: FC<PanelProps> = ({
  as: Tag = 'div',
  screws = 'none',
  className,
  children,
  ...rest
}) => (
  <Tag className={cx(s.panel, className)} {...rest}>
    {screws !== 'none' && (
      <>
        <span className={cx(s.screw, s.screwTl)} aria-hidden="true" />
        <span className={cx(s.screw, s.screwTr)} aria-hidden="true" />
      </>
    )}
    {screws === 'all' && (
      <>
        <span className={cx(s.screw, s.screwBl)} aria-hidden="true" />
        <span className={cx(s.screw, s.screwBr)} aria-hidden="true" />
      </>
    )}
    {children}
  </Tag>
);

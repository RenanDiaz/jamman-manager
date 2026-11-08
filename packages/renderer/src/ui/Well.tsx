import type { FC, HTMLAttributes } from 'react';
import { cx } from './cx';
import f from './form.module.css';

/** Recessed, scrollable list for a short list of names (what will be deleted, backed up…). */
export const Well: FC<HTMLAttributes<HTMLUListElement>> = ({ className, ...rest }) => (
  <ul className={cx(f.well, className)} {...rest} />
);

import type { FC, HTMLAttributes, Ref } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

interface PlateProps extends HTMLAttributes<HTMLElement> {
  as?: 'li' | 'div';
  /** White rim: the patch shown in the detail panel. */
  focused?: boolean;
  /** Picked up while dragging. */
  lifted?: boolean;
  ref?: Ref<HTMLElement>;
}

/** A patch as a raised footswitch plate on the blue chassis. Layout comes from `className`. */
export const Plate: FC<PlateProps> = ({ as = 'li', focused, lifted, className, ref, ...rest }) => {
  const Tag = as as 'div';
  return (
    <Tag
      ref={ref as Ref<HTMLDivElement>}
      className={cx(s.plate, focused && s.plateFocused, lifted && s.plateLifted, className)}
      {...rest}
    />
  );
};

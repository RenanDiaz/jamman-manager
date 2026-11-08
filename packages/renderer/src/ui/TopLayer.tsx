import { useEffect, useRef, type FC, type ReactNode } from 'react';
import { topLayerProps } from './raiseTopLayers';
import s from './ui.module.css';

/**
 * Keeps its children (the toast container) above any open dialog. It is a zero-size,
 * transparent popover: the children position themselves (fixed) as usual.
 */
export const TopLayer: FC<{ children: ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.matches(':popover-open')) el.showPopover();
  }, []);

  return (
    <div ref={ref} popover="manual" className={s.topLayer} {...topLayerProps}>
      {children}
    </div>
  );
};

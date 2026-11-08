import type { FC, HTMLAttributes, ReactNode } from 'react';
import { Led, type LedColor } from './Led';
import { cx } from './cx';
import f from './form.module.css';

type Tone = 'info' | 'success' | 'warning' | 'danger';

interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
}

const LED: Record<Tone, LedColor | null> = {
  info: null,
  success: 'green',
  warning: 'yellow',
  danger: 'red',
};

/** A message on the panel, marked by the LED colour that matches its weight. */
export const Notice: FC<NoticeProps> = ({ tone = 'info', title, className, children, ...rest }) => {
  const led = LED[tone];
  return (
    <div className={cx(f.notice, tone !== 'info' && f[tone], className)} {...rest}>
      <Led color={led ?? 'green'} on={led !== null} />
      <div className={f.noticeBody}>
        {title && <strong className={f.noticeTitle}>{title}</strong>}
        {children}
      </div>
    </div>
  );
};

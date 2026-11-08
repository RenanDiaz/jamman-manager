import type { FC, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import f from './form.module.css';

interface FieldProps {
  label: ReactNode;
  /** id of the control inside; the hint gets the id `${htmlFor}-hint` for aria-describedby. */
  htmlFor: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Printed legend over a control, with an optional hint under it. */
export const Field: FC<FieldProps> = ({ label, htmlFor, hint, className, children }) => (
  <div className={cx(f.field, className)}>
    <label htmlFor={htmlFor} className={f.label}>
      {label}
    </label>
    {children}
    {hint && (
      <p id={`${htmlFor}-hint`} className={f.hint}>
        {hint}
      </p>
    )}
  </div>
);

/** Text or number field, recessed like the display window. */
export const Input: FC<InputHTMLAttributes<HTMLInputElement>> = ({ className, ...rest }) => (
  <input className={cx(f.input, className)} {...rest} />
);

/** Native select with the same recessed look as Input. */
export const Select: FC<SelectHTMLAttributes<HTMLSelectElement>> = ({ className, ...rest }) => (
  <select className={cx(f.input, f.select, className)} {...rest} />
);

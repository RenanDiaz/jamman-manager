import type { ReactNode } from 'react';
import { Led, type LedColor } from './Led';
import { cx } from './cx';
import f from './form.module.css';
import s from './ui.module.css';

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps<T extends string> {
  legend: ReactNode;
  /** Radio group name; must be unique on the screen. */
  name: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  layout?: 'column' | 'row';
  /** Colour of the LED that marks the chosen option. */
  led?: LedColor;
  /** Line under the options, e.g. why none is chosen. */
  hint?: ReactNode;
}

/**
 * Pick one of a few options. Native radios (keyboard and screen readers work as usual)
 * drawn as an LED beside a printed label, like the pedal's stop-mode column.
 */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  layout = 'column',
  led = 'red',
  hint,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className={f.choices} disabled={disabled}>
      <legend className={f.label}>{legend}</legend>
      <div className={cx(f.choiceList, layout === 'row' && f.choiceListRow)}>
        {options.map(option => {
          const checked = option.value === value;
          const optionDisabled = disabled || option.disabled;
          return (
            <label
              key={option.value}
              className={cx(
                f.choice,
                checked && f.choiceChecked,
                optionDisabled && f.choiceDisabled,
              )}
            >
              <input
                type="radio"
                className={s.srOnly}
                name={name}
                value={option.value}
                checked={checked}
                disabled={optionDisabled}
                onChange={() => onChange(option.value)}
              />
              <Led color={led} on={checked} />
              <span className={f.choiceLabel}>{option.label}</span>
              {option.description && (
                <span className={f.choiceDescription}>{option.description}</span>
              )}
            </label>
          );
        })}
      </div>
      {hint && <p className={cx(f.hint, f.choiceHint)}>{hint}</p>}
    </fieldset>
  );
}

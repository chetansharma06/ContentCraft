import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
  leading?: ReactNode
}

export function Input({ label, hint, error, leading, id, className = '', ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  const message = error ?? hint

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={inputId}>{label}</label>
      <div className={`ui-input-wrap${leading ? ' has-leading' : ''}${error ? ' has-error' : ''}`}>
        {leading && <span className="ui-input-leading" aria-hidden="true">{leading}</span>}
        <input
          {...props}
          id={inputId}
          className={`ui-input${className ? ` ${className}` : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
        />
      </div>
      {message && <span id={messageId} className={`ui-field-message${error ? ' is-error' : ''}`}>{message}</span>}
    </div>
  )
}

export type SelectOption = { label: string; value: string; disabled?: boolean }

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label: string
  options: SelectOption[]
  hint?: string
  error?: string
  placeholder?: string
}

export function Select({ label, options, hint, error, placeholder, id, className = '', ...props }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const messageId = `${selectId}-message`
  const message = error ?? hint

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={selectId}>{label}</label>
      <div className={`ui-select-wrap${error ? ' has-error' : ''}`}>
        <select
          {...props}
          id={selectId}
          className={`ui-select${className ? ` ${className}` : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </select>
        <ChevronDown size={15} aria-hidden="true" className="ui-select-chevron" />
      </div>
      {message && <span id={messageId} className={`ui-field-message${error ? ' is-error' : ''}`}>{message}</span>}
    </div>
  )
}
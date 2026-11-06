import type { ReactNode } from 'react'
import { ui } from '../../copy'

// The note step: an optional note of at most 40 characters and chips for the usual ones. The
// field is a plain text input with no form around it and every autofill hint switched off (no
// password manager or browser suggestion). Dock: [Skip] · [Continue].

const MAX = 40

export function NoteStep({
  title,
  value,
  chips,
  onChange,
  visibility,
  children,
}: {
  title: string
  value: string
  chips: readonly string[]
  onChange: (value: string) => void
  /** "Only you and @marko see the note." */
  visibility?: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{title}</h2>
      <div className="pt-4">
        <input
          type="text"
          name="payment-note"
          id="payment-note"
          data-testid="note-input"
          aria-label={ui.steps.noteField}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          inputMode="text"
          maxLength={MAX}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX))}
          className="h-[52px] w-full border-2 border-line-200 bg-surface px-3.5 font-body text-body-l text-navy-900 outline-none focus:border-navy-900"
        />
        <ul className="mt-3.5 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const on = value === chip
            return (
              <li key={chip}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(on ? '' : chip)}
                  className={`h-10 px-3.5 font-body text-body ${
                    on ? 'bg-navy-900 font-medium text-white' : 'border border-line-300 bg-surface text-navy-900'
                  }`}
                >
                  {chip}
                </button>
              </li>
            )
          })}
        </ul>
        {visibility && <p className="mt-3.5 font-body text-body-s text-grey-600">{visibility}</p>}
        {children}
      </div>
    </div>
  )
}

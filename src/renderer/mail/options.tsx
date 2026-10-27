import type { MailpitField, MailpitGroup } from '../../shared/mailpit'
import { MAILPIT_FIELDS } from '../../shared/mailpit'

export function OptionField({ field, value, onChange }: {
  field: MailpitField
  value: string
  onChange: (v: string) => void
}) {
  const id = `mp-${field.key}`
  if (field.kind === 'bool') {
    const checked = value === 'true'
    return (
      <label className="mp-toggle" htmlFor={id} title={field.help}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
        <span className="mp-toggle-track" aria-hidden="true"><span /></span>
        <span className="mp-toggle-text">
          <span>{field.label}</span>
          {field.help && <small>{field.help}</small>}
        </span>
      </label>
    )
  }
  if (field.kind === 'select') {
    return (
      <label className="mp-field" htmlFor={id}>
        <span>{field.label}</span>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Predeterminado</option>
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {field.help && <small>{field.help}</small>}
      </label>
    )
  }
  const type = field.kind === 'number' ? 'number' : field.kind === 'secret' ? 'password' : 'text'
  return (
    <label className="mp-field" htmlFor={id}>
      <span>{field.label}</span>
      <input
        id={id}
        type={type}
        value={value}
        min={field.kind === 'number' ? 0 : undefined}
        spellCheck={false}
        autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <small>{field.help}</small>}
    </label>
  )
}

export function fieldsFor(group: MailpitGroup, showAdvanced: boolean): MailpitField[] {
  return MAILPIT_FIELDS.filter((f) => f.group === group.id && (showAdvanced || !f.advanced))
}

export function hasAdvanced(group: MailpitGroup): boolean {
  return MAILPIT_FIELDS.some((f) => f.group === group.id && f.advanced)
}

import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

export function statusLabel(t, value) {
  if (value == null || value === '') return ''
  const key = `st_${value}`
  const label = t(key)
  if (label !== key) return label
  return String(value).replaceAll('_', ' ')
}

export function PageHead({ title, lede, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  )
}

export function Button({ kind = 'primary', className = '', ...props }) {
  return <button className={`btn ${kind === 'primary' ? '' : kind} ${className}`} {...props} />
}

export function Pill({ value, children }) {
  const { t } = useI18n()
  if (value == null && !children) return null
  return (
    <span className={`status-pill ${value || ''}`}>
      <span className="detail-dot" aria-hidden="true" />
      {children || statusLabel(t, value)}
    </span>
  )
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, wide }) {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>
}

export function ErrorNote({ children }) {
  if (!children) return null
  return <div className="error">{children}</div>
}

export function Timeline({ items = [], onAdd }) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('note')
  return (
    <div className="card timeline">
      <h2>{t('tasks')}</h2>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); if (!title.trim()) return; onAdd({ title, kind }); setTitle('') }}>
        <div className="row-actions">
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="note">Note</option>
            <option value="task">Task</option>
          </select>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('addNote')} />
          <Button kind="soft" type="submit">{t('save')}</Button>
        </div>
      </form>
      {items.map((item) => (
        <div className="event" key={item.id}>
          <div className="check">
            <Pill value={item.kind === 'task' ? 'planned' : 'draft'} />
            <strong>{item.title}</strong>
          </div>
          {item.body ? <p>{item.body}</p> : null}
        </div>
      ))}
      {!items.length ? <div className="empty">No activity yet.</div> : null}
    </div>
  )
}

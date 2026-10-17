import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fill, initialsFrom, markFromName } from './RecordList.jsx'
import { ErrorNote, Pill } from './ui.jsx'
import { money } from '../format.js'
import { useI18n } from '../i18n.jsx'

export const STATUS_DOT = {
  booked: '#a9a8a1',
  assigned: 'oklch(0.6 0.14 255)',
  in_transit: 'oklch(0.75 0.13 75)',
  delivered: 'oklch(0.62 0.12 155)',
  invoiced: 'oklch(0.6 0.14 295)',
  cancelled: '#d9d8d2',
  new: '#a9a8a1',
  quoted: 'oklch(0.6 0.14 255)',
  negotiation: 'oklch(0.75 0.13 75)',
  won: 'oklch(0.62 0.12 155)',
  lost: 'oklch(0.58 0.19 25)',
}

export const ROLE_DOT = {
  customer: 'oklch(0.6 0.14 255)',
  carrier: 'oklch(0.65 0.14 55)',
  both: 'oklch(0.6 0.14 295)',
  broker: 'oklch(0.62 0.12 155)',
}

const OPEN = ['booked', 'assigned', 'in_transit']

export function summarize(orders = []) {
  const live = orders.filter((order) => order.status !== 'cancelled')
  const open = orders.filter((order) => OPEN.includes(order.status))
  return {
    revenue: live.reduce((sum, order) => sum + Number(order.price_cents || 0), 0),
    currency: live.find((order) => order.currency)?.currency || 'EUR',
    orderCount: live.length,
    open,
  }
}

export function RecordStats({ orders, terms }) {
  const { t } = useI18n()
  const stats = summarize(orders)
  const open = stats.open[0]
  const openHint = !stats.open.length
    ? t('noneOpen')
    : stats.open.length === 1
      ? `${open.reference} · ${t(`st_${open.status}`)}`
      : fill(t('nOpen'), { n: stats.open.length })
  return (
    <section className="detail-stats">
      <div className="detail-stat">
        <div className="label">{t('revenue')}</div>
        <div className="value">{money(stats.revenue, stats.currency)}</div>
        <div className="hint">{stats.orderCount === 1 ? t('acrossOne') : fill(t('acrossMany'), { n: stats.orderCount })}</div>
      </div>
      <div className="detail-stat">
        <div className="label">{t('openOrders')}</div>
        <div className="value">{stats.open.length}</div>
        <div className="hint">{openHint}</div>
      </div>
      <div className="detail-stat">
        <div className="label">{t('paymentTerms')}</div>
        <div className="value">{terms == null ? '—' : fill(t('netDays'), { n: terms })}</div>
        <div className="hint">{t('daysAfterInvoice')}</div>
      </div>
    </section>
  )
}

export function OrdersBlock({ orders = [] }) {
  const { t } = useI18n()
  return (
    <section className="detail-card orders">
      <div className="detail-card-head">
        <h2>{t('orders')}</h2>
        <Link className="detail-link" to="/orders">{t('allOrders')} →</Link>
      </div>
      <div className="detail-scroll">
        <div className="detail-table">
          <div className="detail-cols-row">
            <div>{t('reference')}</div>
            <div>{t('lane')}</div>
            <div>{t('status')}</div>
            <div className="detail-price">{t('price')}</div>
          </div>
          {orders.map((order) => (
            <Link className="detail-order" to={`/orders/${order.id}`} key={order.id}>
              <div className="detail-ref">{order.reference}</div>
              <div className="detail-lane">
                <span>{order.origin || '—'}</span>
                <span className="detail-arrow">→</span>
                <span>{order.destination || '—'}</span>
              </div>
              <div className="detail-status">
                <Pill value={order.status} />
              </div>
              <div className="detail-price">{money(order.price_cents, order.currency)}</div>
            </Link>
          ))}
        </div>
      </div>
      {!orders.length ? <div className="detail-empty">{t('noOrdersYet')}</div> : null}
    </section>
  )
}

export function PeopleBlock({ title, action, people = [], empty }) {
  return (
    <section className="detail-card">
      <div className="detail-card-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="detail-people">
        {people.map((person) => (
          <div className="detail-person-block" key={person.id}>
            <Link className="detail-person" to={person.href}>
              <span className={`detail-avatar ${person.square ? 'square' : ''}`} style={{ background: markFromName(person.name) }}>{initialsFrom(person.name)}</span>
              <span className="detail-person-copy">
                <span className="detail-person-name">{person.name}</span>
                {person.role ? <span className="detail-person-role">{person.role}</span> : null}
              </span>
            </Link>
            {person.email ? <a className="detail-mail" href={`mailto:${person.email}`}>{person.email}</a> : null}
          </div>
        ))}
      </div>
      {!people.length ? <div className="detail-empty">{empty}</div> : null}
    </section>
  )
}

function activityTag(item, t) {
  if (item.kind === 'task') return { label: t('kindTask'), tone: 'task' }
  if (item.kind === 'system' && /^draft\b/i.test(item.title || '')) return { label: t('st_draft'), tone: '' }
  if (item.kind === 'email') return { label: t('email'), tone: '' }
  if (item.kind === 'sms') return { label: 'SMS', tone: '' }
  if (item.kind === 'system') return { label: t('kindSystem'), tone: '' }
  return { label: t('kindNote'), tone: '' }
}

export function ActivityPanel({ items = [], onAdd, className = '' }) {
  const { t } = useI18n()
  const [kind, setKind] = useState('note')
  const [draft, setDraft] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const ready = draft.trim().length > 0 && !saving && (kind !== 'task' || Boolean(dueAt))

  async function save() {
    if (!ready) return
    setSaving(true)
    setErr('')
    try {
      await onAdd({ title: draft.trim(), kind, dueAt: kind === 'task' ? dueAt : undefined })
      setDraft('')
      setDueAt('')
    } catch (error) {
      setErr(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`detail-card ${className}`.trim()}>
      <div className="detail-card-head">
        <h2>{t('tasksNotes')}</h2>
        <div className="detail-count">{items.length === 1 ? t('oneItem') : fill(t('manyItems'), { n: items.length })}</div>
      </div>
      <div className="detail-composer">
        <textarea
          rows="2"
          value={draft}
          placeholder={kind === 'note' ? t('addNotePh') : t('taskPh')}
          onChange={(event) => setDraft(event.target.value)}
        />
        {kind === 'task' ? (
          <input type="datetime-local" className="detail-due" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required />
        ) : null}
        <div className="detail-composer-bar">
          <div className="detail-seg">
            {['note', 'task'].map((value) => (
              <button type="button" key={value} className={kind === value ? 'on' : ''} onClick={() => setKind(value)}>
                {value === 'note' ? t('kindNote') : t('kindTask')}
              </button>
            ))}
          </div>
          <button type="button" className={`detail-save ${ready ? 'is-ready' : ''}`} onClick={save}>{t('save')}</button>
        </div>
      </div>
      <ErrorNote>{err}</ErrorNote>
      <div className="detail-notes">
        {items.map((item) => {
          const tag = activityTag(item, t)
          const due = item.due_at ? new Date(item.due_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
          const sub = [item.body, item.owner_name, due && `${t('due')} ${due}`].filter(Boolean).join(' · ')
          return (
            <div className="detail-note" key={item.id}>
              <span className={`detail-tag ${tag.tone}`}>{tag.label}</span>
              <div className="detail-note-copy">
                <div className="detail-note-title">{item.title}</div>
                {sub ? <div className="detail-note-sub">{sub}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

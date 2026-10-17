import { useMemo, useRef, useState } from 'react'
import { api, useFetch } from '../api.js'
import { OrderDrawer } from '../components/OrderDrawer.jsx'
import { ErrorNote, PageHead, Pill } from '../components/ui.jsx'
import { money, when } from '../format.js'
import { useI18n } from '../i18n.jsx'

const STATUSES = ['booked', 'assigned', 'in_transit', 'delivered', 'invoiced']

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date, n) {
  const next = new Date(date)
  next.setDate(next.getDate() + n)
  return next
}

function sameDay(a, b) {
  return a && b && startOfDay(a).getTime() === startOfDay(b).getTime()
}

function rangeFor(view, cursor) {
  if (view === 'month') {
    const start = startOfDay(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
    const end = startOfDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
    return { start, end }
  }
  const start = startOfDay(cursor)
  start.setDate(start.getDate() - start.getDay())
  return { start, end: addDays(start, 7) }
}

function daysIn(range) {
  const days = []
  for (let date = new Date(range.start); date < range.end; date = addDays(date, 1)) days.push(new Date(date))
  return days
}

function initials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function dayIndex(date, days) {
  const stamp = startOfDay(date).getTime()
  return days.findIndex((day) => day.getTime() === stamp)
}

function spanOf(order, days) {
  if (!days.length) return null
  const first = days[0]
  const last = days[days.length - 1]
  const pickup = order.pickup_at ? startOfDay(new Date(order.pickup_at)) : null
  const delivery = order.delivery_at ? startOfDay(new Date(order.delivery_at)) : null
  let start = pickup || delivery || first
  let end = delivery || pickup || start
  if (end < start) end = start
  if (end < first || start > last) return null
  if (start < first) start = first
  if (end > last) end = last
  const from = dayIndex(start, days)
  const to = dayIndex(end, days)
  if (from < 0 || to < 0) return null
  return { from: from + 1, to: to + 2 }
}

function pack(items) {
  const ends = []
  return items
    .slice()
    .sort((a, b) => a.from - b.from || b.to - a.to)
    .map((item) => {
      let lane = ends.findIndex((end) => item.from >= end)
      if (lane < 0) {
        lane = ends.length
        ends.push(item.to)
      } else {
        ends[lane] = item.to
      }
      return { ...item, lane }
    })
}

function dayFromEvent(event, track, days) {
  if (!days.length) return null
  const rect = track.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1)
  const index = Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length)))
  return days[index]
}

export default function Dispatch() {
  const { t, locale } = useI18n()
  const skipClick = useRef(false)
  const [view, setView] = useState('week')
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [err, setErr] = useState('')
  const [openOrderId, setOpenOrderId] = useState(null)
  const range = useMemo(() => rangeFor(view, cursor), [view, cursor])
  const path = `/api/dispatch?from=${range.start.toISOString()}&to=${range.end.toISOString()}${status ? `&status=${status}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  const { data, loading, error, reload } = useFetch(path)
  const days = daysIn(range)
  const drivers = data?.drivers || []
  const orders = data?.orders || []
  const today = startOfDay(new Date())

  function label() {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' }
    return `${range.start.toLocaleDateString(locale, opts)} – ${addDays(range.end, -1).toLocaleDateString(locale, opts)}`
  }

  async function drop(event, driverId, day) {
    event.preventDefault()
    const orderId = event.dataTransfer.getData('text/plain')
    if (!orderId || !day) return
    setErr('')
    try {
      if (!driverId) {
        await api('/api/dispatch/unassign', { method: 'POST', body: { orderId } })
      } else {
        await api('/api/dispatch/assign', {
          method: 'POST',
          body: { orderId, kind: 'own_fleet', driverId, pickupAt: day.toISOString() },
        })
      }
      reload()
    } catch (error) { setErr(error.message) }
  }

  function rowItems(driverId) {
    const items = orders
      .filter((order) => (order.driver_id || null) === (driverId || null))
      .map((order) => {
        const span = spanOf(order, days)
        return span ? { order, ...span } : null
      })
      .filter(Boolean)
    return pack(items)
  }

  function Card({ order, style }) {
    const done = ['delivered', 'invoiced'].includes(order.status)
    const margin = order.price_cents - (order.expense_cents || 0)
    const whenLabel = order.delivery_at && order.pickup_at
      ? `${when(order.pickup_at)} → ${when(order.delivery_at)}`
      : (order.pickup_at ? when(order.pickup_at) : '—')
    return (
      <article
        className={`sched-card ${done ? 'done' : 'booked'}`}
        style={style}
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(event) => {
          skipClick.current = true
          event.dataTransfer.setData('text/plain', order.id)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpenOrderId(order.id)
          }
        }}
        onClick={() => {
          if (skipClick.current) {
            skipClick.current = false
            return
          }
          setOpenOrderId(order.id)
        }}
      >
        <header>
          <strong>{order.reference}</strong>
          <Pill value={order.status} />
        </header>
        <div>{order.company_name}</div>
        <div className="sched-money">{money(order.price_cents, order.currency)} · {money(margin, order.currency)}</div>
        <div className="quiet">{whenLabel}</div>
        <div className="quiet">{order.origin} → {order.destination}</div>
      </article>
    )
  }

  function Row({ driverId, who }) {
    const items = rowItems(driverId)
    return (
      <div className="sched-row">
        <div className="sched-who">
          {who}
        </div>
        <div
          className="sched-track"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => drop(event, driverId, dayFromEvent(event, event.currentTarget, days))}
        >
          <div className="sched-drops">
            {days.map((day) => (
              <div
                key={`${driverId || 'u'}-${day.toISOString()}`}
                className={`sched-cell${sameDay(day, today) ? ' is-today' : ''}`}
              />
            ))}
          </div>
          {items.map(({ order, from, to, lane }) => (
            <Card
              key={order.id}
              order={order}
              style={{ gridColumn: `${from} / ${to}`, gridRow: lane + 1 }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="sched">
      <PageHead title={t('dispatch')} lede={t('dispatchLede')}>
        <div className="sched-tools">
          <button type="button" className="dash-btn" onClick={() => setCursor(addDays(cursor, view === 'month' ? -28 : -7))}>←</button>
          <strong>{label()}</strong>
          <button type="button" className="dash-btn" onClick={() => setCursor(addDays(cursor, view === 'month' ? 28 : 7))}>→</button>
          <button type="button" className="dash-btn" onClick={() => setCursor(startOfDay(new Date()))}>{t('today')}</button>
          <button type="button" className={`dash-btn ${view === 'week' ? 'primary' : ''}`} onClick={() => setView('week')}>{t('week')}</button>
          <button type="button" className={`dash-btn ${view === 'month' ? 'primary' : ''}`} onClick={() => setView('month')}>{t('month')}</button>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t('all')}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`st_${value}`)}</option>)}
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('filterRefCustomer')} />
        </div>
      </PageHead>
      <ErrorNote>{err || error}</ErrorNote>
      {loading ? <p>{t('loading')}</p> : (
        <div className="sched-board">
          <div className="sched-grid" style={{ '--days': days.length }}>
            <div className="sched-head">
              <div className="sched-corner">{t('drivers')}</div>
              {days.map((day) => (
                <div key={day.toISOString()} className={`sched-day${sameDay(day, today) ? ' is-today' : ''}`}>
                  <span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span>
                  <strong>{day.getDate()}</strong>
                </div>
              ))}
            </div>
            <Row
              driverId={null}
              who={(
                <>
                  <div className="sched-avatar">?</div>
                  <div>
                    <strong>{t('unassigned')}</strong>
                    <div className="quiet">{rowItems(null).length} {t('visits')}</div>
                  </div>
                </>
              )}
            />
            {drivers.map((driver) => (
              <Row
                key={driver.id}
                driverId={driver.id}
                who={(
                  <>
                    <div className="sched-avatar">{initials(driver.name)}</div>
                    <div>
                      <strong>{driver.name}</strong>
                      <div className="quiet">{driver.visits} {t('visits')}{driver.plate ? ` · ${driver.plate}` : ''}</div>
                    </div>
                  </>
                )}
              />
            ))}
          </div>
        </div>
      )}
      <OrderDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </div>
  )
}

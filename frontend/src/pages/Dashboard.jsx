import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useFetch } from '../api.js'
import { useInvoiceDrawer } from '../components/InvoiceDrawer.jsx'
import { OrderDrawer } from '../components/OrderDrawer.jsx'
import { useAuth } from '../App.jsx'
import { Pill } from '../components/ui.jsx'
import { money } from '../format.js'
import { useI18n } from '../i18n.jsx'

const ORDER_STAGES = ['booked', 'assigned', 'in_transit', 'delivered']
const AVATARS = {
  'Marek Nowak': '#e6eef9',
  'Elena Ionescu': '#f6ebe2',
  'Anna Kowalska': '#e8f3ec',
}
const AVATAR_FALLBACK = ['#e6eef9', '#f6ebe2', '#e8f3ec', '#f3e8f6', '#f6f3e2']

function greet(t) {
  const hour = new Date().getHours()
  if (hour < 12) return t('goodMorning')
  if (hour < 18) return t('goodAfternoon')
  return t('goodEvening')
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
}

function phrase(t, n, oneKey, manyKey) {
  return fill(t(n === 1 ? oneKey : manyKey), { n })
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function avatarBg(name) {
  if (!name) return '#f0efeb'
  if (AVATARS[name]) return AVATARS[name]
  let hash = 0
  for (const char of name) hash = (hash + char.charCodeAt(0)) % AVATAR_FALLBACK.length
  return AVATAR_FALLBACK[hash]
}

function typeLabel(t, type) {
  const key = `type_${type}`
  const label = t(key)
  if (label !== key) return label
  if (!type) return ''
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function statusCount(rows, status) {
  return rows?.find((row) => row.status === status)?.n || 0
}

export default function Dashboard() {
  const { t, locale } = useI18n()
  const { me } = useAuth()
  const navigate = useNavigate()
  const { open } = useInvoiceDrawer()
  const { data, loading, error, reload } = useFetch('/api/dashboard')
  useEffect(() => {
    const onChange = () => reload()
    window.addEventListener('cargos-invoice', onChange)
    return () => window.removeEventListener('cargos-invoice', onChange)
  }, [reload])
  const [done, setDone] = useState({})
  const [openTask, setOpenTask] = useState(null)
  const first = me?.name?.split(' ')[0]
  const today = locale === 'en'
    ? `${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}, ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
    : new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  async function completeTask(event, task) {
    event.stopPropagation()
    if (done[task.id]) return
    setDone((current) => ({ ...current, [task.id]: true }))
    try {
      await api(`/api/activities/${task.id}`, { method: 'PATCH', body: { done: true } })
      reload()
    } catch {
      setDone((current) => ({ ...current, [task.id]: false }))
    }
  }

  const byStatus = data?.ordersByStatus || []
  const openStages = ORDER_STAGES.map((stage) => ({ stage, amount: statusCount(byStatus, stage) }))
  const maxStage = Math.max(...openStages.map((row) => row.amount), 0)
  const marginPct = data?.revenueCents ? Math.round((data.marginCents / data.revenueCents) * 100) : 0
  const overdue = (data?.overdueCents || 0) > 0
  const fleet = data?.fleet || { total: 0, on_trip: 0, available: 0, maintenance: 0 }
  const available = fleet.available ?? Math.max(0, (fleet.total || 0) - (fleet.on_trip || 0) - (fleet.maintenance || 0))
  const fleetParts = [
    { key: 'trip', n: fleet.on_trip || 0, color: '#d9d8d2' },
    { key: 'free', n: available, color: 'oklch(0.62 0.12 155)' },
    { key: 'shop', n: fleet.maintenance || 0, color: 'oklch(0.75 0.13 75)' },
  ]
  const fleetSegments = fleetParts.filter((part) => part.n > 0)
  const tasks = data?.tasks || []
  const remaining = tasks.filter((task) => !(done[task.id] ?? false)).length
  const overdueHint = data
    ? `${data.overdueCount} ${t(data.overdueCount === 1 ? 'invoiceOne' : 'invoiceMany')}${data.overdueNumber ? ` · ${data.overdueNumber}` : ''}`
    : ''

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="dash-titles">
          <div className="dash-date">{today}{me?.tenant_name ? ` · ${me.tenant_name}` : ''}</div>
          <h1>{greet(t)}{first ? `, ${first}` : ''}</h1>
        </div>
        <div className="dash-actions">
          <button type="button" className="dash-btn" onClick={() => navigate('/tasks')}>{t('tasks')}</button>
          <button type="button" className="dash-btn primary" onClick={() => navigate('/orders', { state: { create: true } })}>{t('newOrder')}</button>
        </div>
      </header>

      {loading ? <p className="quiet">{t('loading')}</p> : null}
      {error ? <div className="error">{error}</div> : null}

      {data ? (
        <>
          <section className="dash-stats">
            <div className="dash-stat">
              <div className="dash-kicker">{t('marginThisMonth')}</div>
              <div className="dash-stat-value">{money(data.marginCents)}</div>
              <div className="dash-hint">{fill(t('marginHint'), { revenue: money(data.revenueCents), pct: marginPct })}</div>
            </div>
            <div className="dash-stat">
              <div className="dash-kicker">{t('openOrders')}</div>
              <div className="dash-stat-value">{data.openOrders}</div>
              <div className="dash-hint">{t('openOrdersHint')}</div>
            </div>
            <div className="dash-stat">
              <div className="dash-kicker">{t('tasks')}</div>
              <div className="dash-stat-value">{data.openTasks ?? data.pipelineCount}</div>
              <div className="dash-hint">{t('openTasksHint')}</div>
            </div>
            <div className="dash-stat">
              <div className="dash-kicker">{t('onTimeDelivery')}</div>
              <div className="dash-stat-value">{data.onTimePct == null ? '—' : `${data.onTimePct}%`}</div>
              <div className="dash-hint">{t('deliveredWindow')}</div>
            </div>
            {data.overdueId ? (
              <button type="button" className="dash-stat" onClick={() => open(data.overdueId)}>
                <div className={`dash-kicker ${overdue ? 'alert' : ''}`}>
                  {overdue ? <span className="dash-alert-dot" /> : null}
                  {t('overdue')}
                </div>
                <div className={`dash-stat-value ${overdue ? 'alert' : ''}`}>{money(data.overdueCents)}</div>
                <div className="dash-hint">{overdueHint}</div>
              </button>
            ) : (
              <div className="dash-stat">
                <div className={`dash-kicker ${overdue ? 'alert' : ''}`}>
                  {overdue ? <span className="dash-alert-dot" /> : null}
                  {t('overdue')}
                </div>
                <div className={`dash-stat-value ${overdue ? 'alert' : ''}`}>{money(data.overdueCents)}</div>
                <div className="dash-hint">{overdueHint}</div>
              </div>
            )}
          </section>

          <div className="dash-main">
            <div className="dash-col">
              <section className="dash-card dash-pipeline">
                <div className="dash-section-head">
                  <h2>{t('orders')}</h2>
                  <Link className="dash-more" to="/orders">{t('allOrders')} →</Link>
                </div>
                <div className="dash-stages">
                  {openStages.map((row) => (
                    <div className="dash-stage" key={row.stage}>
                      <div>{t(`st_${row.stage}`)}</div>
                      <div className="dash-track">
                        <div className="dash-fill" style={{ width: `${maxStage ? (row.amount / maxStage) * 100 : 0}%` }} />
                      </div>
                      <div className={`dash-mono dash-stage-val ${row.amount ? '' : 'is-zero'}`}>{row.amount}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dash-card dash-fleet">
                <div className="dash-section-head">
                  <h2>{t('fleetUtil')}</h2>
                  <div className="dash-date">{phrase(t, fleet.total || 0, 'vehicleOne', 'vehicleMany')}</div>
                </div>
                <div className="dash-fleet-bar">
                  {fleetSegments.length ? fleetSegments.map((part) => (
                    <div key={part.key} className="dash-fleet-seg" style={{ flex: part.n, background: part.color }} />
                  )) : <div className="dash-fleet-seg empty" />}
                </div>
                <div className="dash-legend">
                  <div><span className="dash-swatch" style={{ background: '#d9d8d2' }} />{t('onATrip')} <b>{fleet.on_trip || 0}</b></div>
                  <div><span className="dash-swatch" style={{ background: 'oklch(0.62 0.12 155)' }} />{t('st_available')} <b>{available}</b></div>
                  <div><span className="dash-swatch" style={{ background: 'oklch(0.75 0.13 75)' }} />{t('inMaintenance')} <b>{fleet.maintenance || 0}</b></div>
                </div>
              </section>
            </div>

            <section className="dash-card dash-tasks">
              <div className="dash-section-head">
                <h2>{t('tasks')}</h2>
                <div className="dash-date">{fill(t('remaining'), { n: remaining })}</div>
              </div>
              {tasks.map((task) => {
                const isDone = done[task.id] ?? false
                const who = task.owner_name || t('unassigned')
                return (
                  <div className="dash-task" key={task.id}>
                    <button
                      type="button"
                      className={`dash-check ${isDone ? 'on' : ''}`}
                      onClick={(event) => completeTask(event, task)}
                      aria-pressed={isDone}
                      aria-label={t('st_done')}
                    >
                      {isDone ? '✓' : ''}
                    </button>
                    <button type="button" className="dash-task-open" onClick={() => setOpenTask(task)}>
                      <span className="dash-task-body">
                        <span className={`dash-task-title ${isDone ? 'done' : ''}`}>{task.title}</span>
                        <span className="dash-task-meta">
                          <span className="dash-chip">{typeLabel(t, task.object_type)}</span>
                          <span>{who}</span>
                        </span>
                      </span>
                      <span className="dash-avatar" style={{ background: avatarBg(task.owner_name) }}>{initials(who)}</span>
                    </button>
                  </div>
                )
              })}
              {!tasks.length ? <div className="empty">{t('nothingWaiting')}</div> : null}
            </section>
          </div>

          <section className="dash-card dash-orders">
            <div className="dash-section-head">
              <h2>{t('recentOrders')}</h2>
              <Link className="dash-more" to="/orders">{t('allOrders')} →</Link>
            </div>
            <div className="dash-scroll">
              <div className="dash-table">
                <div className="dash-table-head">
                  <div>{t('reference')}</div>
                  <div>{t('customer')}</div>
                  <div>{t('lane')}</div>
                  <div>{t('status')}</div>
                  <div className="dash-right">{t('price')}</div>
                </div>
                {data.recentOrders.map((order) => (
                  <div
                    className="dash-order"
                    key={order.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/orders/${order.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate(`/orders/${order.id}`)
                      }
                    }}
                  >
                    <div className="dash-mono dash-ref">{order.reference}</div>
                    <div className="dash-ellipsis">{order.company_name}</div>
                    <div className="dash-lane">
                      <span>{order.origin}</span>
                      <span className="dash-arrow">→</span>
                      <span>{order.destination}</span>
                    </div>
                    <div className="dash-status">
                      <Pill value={order.status} />
                    </div>
                    <div className="dash-mono dash-price">{money(order.price_cents, order.currency)}</div>
                  </div>
                ))}
                {!data.recentOrders.length ? <div className="empty">{t('nothingWaiting')}</div> : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
      <OrderDrawer
        orderId={openTask?.order_id || (openTask?.object_type === 'order' ? openTask.object_id : null)}
        task={openTask}
        onClose={() => setOpenTask(null)}
      />
    </div>
  )
}

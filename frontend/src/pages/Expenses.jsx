import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, downloadFile, useFetch } from '../api.js'
import { ExpenseFields, emptyExpense, expenseBody, expenseToForm } from '../components/ExpenseForm.jsx'
import { ListCard, Sheet, fill } from '../components/RecordList.jsx'
import { Button, ErrorNote, Modal, Pill } from '../components/ui.jsx'
import { day, money } from '../format.js'
import { useI18n } from '../i18n.jsx'

const PRESETS = [
  { days: 7, label: 'last7' },
  { days: 30, label: 'last30' },
  { days: 90, label: 'last90' },
]
const WIDTH = 840
const LEFT = 64
const RIGHT = 12
const HEIGHT = 176
const BOTTOM = 28

function longDay(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function frame(count, height, bottom) {
  const top = 16
  const innerW = WIDTH - LEFT - RIGHT
  const innerH = height - top - bottom
  return { top, bottom, innerH, slot: count ? innerW / count : innerW }
}

function centsOf(rows, currency) {
  return rows.filter((row) => !currency || row.currency === currency).reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0)
}

function iso(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function shift(value, days) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return iso(date)
}

function rangeFor(days) {
  const to = iso(new Date())
  return { from: shift(to, -(days - 1)), to }
}

function shortDay(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Expenses() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const initial = rangeFor(30)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [charts, setCharts] = useState(true)
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [focusDay, setFocusDay] = useState('')
  const [focusPay, setFocusPay] = useState('')
  const kind = tab === 'generic' || tab === 'order' ? tab : ''
  const list = useFetch(`/api/expenses?from=${from}&to=${to}`)
  const rows = list.data?.data || []
  const q = query.trim().toLowerCase()
  const scoped = rows.filter((row) => (tab === 'generic' ? !row.order_id : tab === 'order' ? Boolean(row.order_id) : true))
  const matched = scoped.filter((row) => {
    if (focusDay && row.occurred_on !== focusDay) return false
    if (focusPay && row.payment_type !== focusPay) return false
    if (q && !`${row.label} ${row.order_reference || ''} ${row.company_name || ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const totals = list.data?.totals || []
  const currency = list.data?.currency || totals[0]?.currency || 'EUR'
  const primary = totals.find((row) => row.currency === currency) || totals[0]
  const onOrderRows = rows.filter((row) => row.order_id)
  const genericRows = rows.filter((row) => !row.order_id)
  const spent = primary?.amount_cents || 0
  const count = primary?.count || 0
  const avg = count ? Math.round(spent / count) : 0
  const chartFilter = focusDay || focusPay
  const tabs = [
    { id: 'all', label: t('all') },
    { id: 'order', label: t('onOrders') },
    { id: 'generic', label: t('genericExpense') },
  ].map((item) => ({
    ...item,
    count: item.id === 'all'
      ? rows.length
      : rows.filter((row) => (item.id === 'generic' ? !row.order_id : Boolean(row.order_id))).length,
  }))

  function onRange(nextFrom, nextTo) {
    setFrom(nextFrom)
    setTo(nextTo)
    setFocusDay('')
    setFocusPay('')
  }

  async function save(event) {
    event.preventDefault()
    setErr('')
    try {
      const body = expenseBody(form)
      if (form.id) await api(`/api/expenses/${form.id}`, { method: 'PATCH', body })
      else await api('/api/expenses', { method: 'POST', body })
      setForm(null)
      list.reload()
    } catch (error) {
      setErr(error.message)
    }
  }

  async function remove(id) {
    setErr('')
    try {
      await api(`/api/expenses/${id}`, { method: 'DELETE' })
      list.reload()
    } catch (error) {
      setErr(error.message)
    }
  }

  return (
    <Sheet
      title={t('expenses')}
      lede={t('expensesLede')}
      actions={(
        <>
          <button type="button" className="dash-btn" onClick={() => setCharts((open) => !open)}>{charts ? t('hideCharts') : t('showCharts')}</button>
          <button type="button" className="dash-btn" onClick={() => downloadFile(`/api/expenses/export.csv?from=${from}&to=${to}${kind ? `&kind=${kind}` : ''}`, `expenses-${from}-${to}.csv`)}>{t('downloadCsv')}</button>
          <button type="button" className="dash-btn primary" onClick={() => { setErr(''); setForm(emptyExpense()) }}>{t('newExpense')}</button>
        </>
      )}
    >
      <ErrorNote>{err || list.error}</ErrorNote>
      <div className="report-filters expense-filters">
        <div className="report-presets" role="group">
          {PRESETS.map((preset) => {
            const range = rangeFor(preset.days)
            const on = range.from === from && range.to === to
            return (
              <button type="button" key={preset.days} className={on ? 'on' : ''} onClick={() => onRange(range.from, range.to)}>
                {t(preset.label)}
              </button>
            )
          })}
        </div>
        <label className="report-date">
          <span>{t('rangeFrom')}</span>
          <input type="date" value={from} max={to} onChange={(event) => onRange(event.target.value, to)} />
        </label>
        <label className="report-date">
          <span>{t('rangeTo')}</span>
          <input type="date" value={to} min={from} onChange={(event) => onRange(from, event.target.value)} />
        </label>
      </div>
      <section className="dash-stats">
        <div className="dash-stat">
          <div className="dash-kicker">{t('spent')}</div>
          <div className="dash-stat-value">{money(spent, currency)}</div>
          <div className="dash-hint">{t('inThisRange')}</div>
        </div>
        <div className="dash-stat">
          <div className="dash-kicker">{t('expenses')}</div>
          <div className="dash-stat-value">{count}</div>
          <div className="dash-hint">{count === 1 ? t('expenseCountOne') : fill(t('expenseCountMany'), { n: count })}</div>
        </div>
        <div className="dash-stat">
          <div className="dash-kicker">{t('onOrders')}</div>
          <div className="dash-stat-value">{money(centsOf(onOrderRows, currency), currency)}</div>
          <div className="dash-hint">{fill(t('linkedOrders'), { n: onOrderRows.length })}</div>
        </div>
        <div className="dash-stat">
          <div className="dash-kicker">{t('genericExpense')}</div>
          <div className="dash-stat-value">{money(centsOf(genericRows, currency), currency)}</div>
          <div className="dash-hint">{fill(t('noOrderCount'), { n: genericRows.length })}</div>
        </div>
        <div className="dash-stat">
          <div className="dash-kicker">{t('avgExpense')}</div>
          <div className="dash-stat-value">{money(avg, currency)}</div>
          <div className="dash-hint">{t('avgHint')}</div>
        </div>
      </section>
      {charts ? (
        <ExpenseCharts
          days={list.data?.days || []}
          byPayment={list.data?.byPayment || []}
          currency={currency}
          loading={list.loading}
          focusDay={focusDay}
          focusPay={focusPay}
          onDay={(day) => setFocusDay((current) => (current === day ? '' : day))}
          onPay={(type) => setFocusPay((current) => (current === type ? '' : type))}
          onClear={() => { setFocusDay(''); setFocusPay('') }}
          filtered={Boolean(chartFilter)}
          t={t}
        />
      ) : null}
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterExpense')}
        columns="110px minmax(0,1.6fr) 120px 110px 130px 140px 110px"
        minWidth={980}
        pageSize={25}
        heads={[
          { key: 'date', label: t('expenseDate') },
          { key: 'label', label: t('expenseLabel') },
          { key: 'payment', label: t('paymentType') },
          { key: 'order', label: t('type_order') },
          { key: 'company', label: t('relatedCompany') },
          { key: 'amount', label: t('amount'), align: 'right' },
          { key: 'actions', label: '' },
        ]}
        rows={matched}
        rowKey={(row) => row.id}
        onRow={(row) => { setErr(''); setForm({ ...expenseToForm(row), id: row.id }) }}
        loading={list.loading}
        error={null}
        empty={q ? fill(t('noExpenses'), { query: query.trim() }) : t('noExpensesInRange')}
        renderRow={(row) => (
          <>
            <div className="sheet-mono">{day(row.occurred_on)}</div>
            <div className="sheet-name">{row.label}</div>
            <Pill value={row.payment_type}>{t(`pay_${row.payment_type}`)}</Pill>
            <div className="sheet-mono">
              {row.order_id ? (
                <button type="button" className="detail-link" onClick={(event) => { event.stopPropagation(); navigate(`/orders/${row.order_id}`) }}>{row.order_reference}</button>
              ) : '—'}
            </div>
            <div className="sheet-ellipsis">{row.company_name || '—'}</div>
            <div className="sheet-mono sheet-right">{money(row.amount_cents, row.currency)}</div>
            <div className="sheet-row-actions" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="sheet-mini" onClick={() => remove(row.id)}>{t('remove')}</button>
            </div>
          </>
        )}
      />
      {form ? (
        <Modal title={form.id ? t('editExpense') : t('newExpense')} onClose={() => setForm(null)}>
          <form onSubmit={save}>
            <ErrorNote>{err}</ErrorNote>
            <ExpenseFields
              form={form}
              setForm={setForm}
              showOrder
              t={t}
            />
            <div className="modal-actions">
              <Button kind="ghost" type="button" onClick={() => setForm(null)}>{t('cancel')}</Button>
              <Button>{t('save')}</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Sheet>
  )
}

function ExpenseCharts({ days, byPayment, currency, loading, focusDay, focusPay, onDay, onPay, onClear, filtered, t }) {
  const [hover, setHover] = useState(null)
  const count = days.reduce((sum, row) => sum + row.count, 0)
  const active = hover != null ? days[hover] : (focusDay ? days.find((row) => row.day === focusDay) : null)
  const activeIndex = hover != null ? hover : days.findIndex((row) => row.day === focusDay)

  return (
    <section className={`dash-card expense-charts report-chart ${loading ? 'is-loading' : ''}`}>
      {filtered ? (
        <button type="button" className="expense-chart-clear" onClick={onClear}>{t('clearChartFilter')}</button>
      ) : null}
      <div className="report-plots expense-plots">
        <div className="report-plot-wrap" onMouseLeave={() => setHover(null)}>
          <SpendChart
            days={days}
            currency={currency}
            hover={activeIndex >= 0 ? activeIndex : null}
            focusDay={focusDay}
            onHover={setHover}
            onDay={onDay}
          />
          {active && activeIndex >= 0 ? <DayTip day={active} currency={currency} index={activeIndex} count={days.length} t={t} /> : null}
          {count === 0 ? <div className="report-empty">{t('noExpensesInRange')}</div> : null}
        </div>
        <div className="expense-pay-break">
          <h3 className="report-sub">{t('byPayment')}</h3>
          {(byPayment.length ? byPayment : []).map((row) => {
            const peak = Math.max(1, ...byPayment.map((item) => item.amount_cents))
            return (
              <button
                type="button"
                className={`expense-pay-row ${focusPay === row.payment_type ? 'is-on' : ''}`}
                key={row.payment_type}
                onClick={() => { setHover(null); onPay(row.payment_type) }}
              >
                <span>{t(`pay_${row.payment_type}`)}</span>
                <i style={{ width: `${Math.max(6, (row.amount_cents / peak) * 100)}%` }} />
                <strong>{money(row.amount_cents, currency)}</strong>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function DayTip({ day, currency, index, count, t }) {
  const plot = frame(count, HEIGHT, BOTTOM)
  const x = ((LEFT + (index + 0.5) * plot.slot) / WIDTH) * 100
  const edge = x < 18 ? 'is-left' : x > 82 ? 'is-right' : ''
  return (
    <div className={`report-tip ${edge}`} style={{ left: `${x}%`, top: 18 }}>
      <div className="report-tip-day">{longDay(day.day)}</div>
      <div><span>{t('spentOnDay')}</span><strong>{money(day.amount_cents, currency)}</strong></div>
      <div><span>{t('expenses')}</span><strong>{fill(t('expensesOnDay'), { n: day.count })}</strong></div>
    </div>
  )
}

function SpendChart({ days, currency, hover, focusDay, onHover, onDay }) {
  const plot = frame(days.length, HEIGHT, BOTTOM)
  const peak = Math.max(0, ...days.map((row) => row.amount_cents))
  const hi = peak || 1
  const y = (value) => plot.top + ((hi - value) / hi) * plot.innerH
  const zeroY = y(0)
  const every = days.length <= 14 ? 1 : days.length <= 45 ? 5 : 14
  const barW = Math.max(3, Math.min(22, plot.slot * 0.55))

  function indexAt(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH
    const index = Math.floor((x - LEFT) / plot.slot)
    return index >= 0 && index < days.length ? index : null
  }

  return (
    <svg
      className="report-plot"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Expenses by day"
      onMouseMove={(event) => onHover(indexAt(event))}
      onClick={(event) => {
        const index = indexAt(event)
        if (index != null) onDay(days[index].day)
      }}
    >
      <line className="report-zero" x1={LEFT} x2={WIDTH - RIGHT} y1={zeroY} y2={zeroY} />
      <text x={LEFT - 8} y={plot.top + 4} textAnchor="end">{money(hi, currency)}</text>
      {days.map((row, index) => {
        const x = LEFT + index * plot.slot + (plot.slot - barW) / 2
        const top = y(row.amount_cents)
        const height = Math.max(row.amount_cents ? 2 : 0, zeroY - top)
        const show = index % every === 0 || index === days.length - 1
        const on = hover === index || focusDay === row.day
        return (
          <g key={row.day} style={{ cursor: 'pointer' }}>
            {on ? <rect className="report-hover" x={LEFT + index * plot.slot} y={plot.top} width={plot.slot} height={plot.innerH} /> : null}
            {height ? <rect className="report-bar-price" x={x} y={top} width={barW} height={height} rx="3" /> : null}
            {show ? <text x={LEFT + (index + 0.5) * plot.slot} y={HEIGHT - 8} textAnchor="middle">{shortDay(row.day)}</text> : null}
          </g>
        )
      })}
    </svg>
  )
}

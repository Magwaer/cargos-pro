import { useEffect, useState } from 'react'
import { api, useFetch } from '../api.js'
import { OrderDrawer } from '../components/OrderDrawer.jsx'
import { PageHead, Pill } from '../components/ui.jsx'
import { money } from '../format.js'
import { useI18n } from '../i18n.jsx'

const PRESETS = [
  { days: 7, label: 'last7' },
  { days: 30, label: 'last30' },
  { days: 90, label: 'last90' },
]

const WIDTH = 840
const LEFT = 64
const RIGHT = 12
const DAILY_H = 176
const DAILY_BOTTOM = 28

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

function longDay(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function axisMoney(cents, currency) {
  const value = (Number(cents) || 0) / 100
  const abs = Math.abs(value)
  const digits = abs >= 10000 ? 1 : 0
  const notation = abs >= 10000 ? 'compact' : 'standard'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation, maximumFractionDigits: digits }).format(value)
  } catch {
    return money(cents, currency, 0)
  }
}

function axisTicks(min, max) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  if (hi <= lo) return [Math.round(lo)]
  const target = Math.max(1, (hi - lo) / 4)
  const pow = 10 ** Math.floor(Math.log10(target))
  const step = [1, 2, 2.5, 5, 10].map((ratio) => ratio * pow).find((size) => size >= target - 1e-6) || pow * 10
  const start = Math.ceil(lo / step - 1e-6) * step
  const ticks = []
  for (let value = start; value <= hi + step * 0.01; value += step) {
    const rounded = Math.round(value)
    if (ticks[ticks.length - 1] !== rounded) ticks.push(rounded)
  }
  return ticks.length ? ticks : [Math.round(lo), Math.round(hi)]
}

function frame(count, height, bottom) {
  const top = 16
  const innerW = WIDTH - LEFT - RIGHT
  const innerH = height - top - bottom
  return { top, bottom, innerH, slot: count ? innerW / count : innerW }
}

function yScale(values, top, innerH) {
  const peak = Math.max(0, ...values)
  const floor = Math.min(0, ...values)
  const hi = peak === 0 && floor === 0 ? 1 : peak + Math.max(peak - floor, peak, 1) * 0.08
  const lo = floor
  const span = hi - lo || 1
  return {
    hi,
    lo,
    y: (value) => top + ((hi - value) / span) * innerH,
  }
}

function barPath(x, width, valueY, zeroY) {
  const top = Math.min(valueY, zeroY)
  const bottom = Math.max(valueY, zeroY)
  const height = bottom - top
  if (height < 0.6) return ''
  const radius = Math.min(4, width / 2, height)
  if (valueY <= zeroY) {
    return `M ${x} ${bottom} V ${top + radius} Q ${x} ${top} ${x + radius} ${top} H ${x + width - radius} Q ${x + width} ${top} ${x + width} ${top + radius} V ${bottom} Z`
  }
  return `M ${x} ${top} V ${bottom - radius} Q ${x} ${bottom} ${x + radius} ${bottom} H ${x + width - radius} Q ${x + width} ${bottom} ${x + width} ${bottom - radius} V ${top} Z`
}

function linePath(points, xAt, yAt) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${xAt(index).toFixed(1)} ${yAt(point).toFixed(1)}`).join(' ')
}

function usePaidSeries(from, to) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  useEffect(() => {
    let cancel = false
    setState((current) => ({ ...current, loading: true, error: '' }))
    api(`/api/reports/paid?from=${from}&to=${to}`)
      .then((data) => { if (!cancel) setState({ loading: false, data, error: '' }) })
      .catch((error) => { if (!cancel) setState((current) => ({ loading: false, data: current.data, error: error.message })) })
    return () => { cancel = true }
  }, [from, to])
  return state
}

export default function Reports() {
  const { t } = useI18n()
  const { data, loading, error } = useFetch('/api/reports')
  const initial = rangeFor(30)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [openOrderId, setOpenOrderId] = useState(null)
  const series = usePaidSeries(from, to)

  function applyRange(nextFrom, nextTo) {
    if (!nextFrom || !nextTo) return
    if (nextFrom > nextTo) {
      setFrom(nextTo)
      setTo(nextFrom)
      return
    }
    setFrom(nextFrom)
    setTo(nextTo)
  }

  if (loading) return <p>{t('loading')}</p>
  if (error) return <div className="error">{error}</div>
  const revenue = data.profit.reduce((sum, row) => sum + row.price_cents, 0)
  const cost = data.profit.reduce((sum, row) => sum + row.cost_cents, 0)
  return (
    <div>
      <PageHead title={t('reports')} lede={`Revenue ${money(revenue)} · cost ${money(cost)} · margin ${money(revenue - cost)}`} />
      <PaidCard t={t} from={from} to={to} onRange={applyRange} series={series} />
      <div className="split">
        <div className="card">
          <h2>Order margin</h2>
          <table>
            <thead><tr><th>Order</th><th>Status</th><th className="right">Price</th><th className="right">Cost</th><th className="right">Margin</th></tr></thead>
            <tbody>
              {data.profit.map((row) => (
                <tr
                  key={row.id || row.reference}
                  className="click"
                  role="link"
                  tabIndex={0}
                  onClick={() => setOpenOrderId(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setOpenOrderId(row.id)
                    }
                  }}
                >
                  <td><strong>{row.reference}</strong><br /><span className="quiet">{row.company_name}</span></td>
                  <td><Pill value={row.status} /></td>
                  <td className="right">{money(row.price_cents, row.currency)}</td>
                  <td className="right">{money(row.cost_cents, row.currency)}</td>
                  <td className="right">{money(row.price_cents - row.cost_cents, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Invoices</h2>
            {data.invoices.map((row) => <p key={row.status} style={{ marginTop: 8 }}><Pill value={row.status} /> {row.n} · {money(row.amount_cents)}</p>)}
          </div>
          <div className="card">
            <h2>Fleet</h2>
            {data.fleet.map((row) => <p key={row.status} style={{ marginTop: 8 }}><Pill value={row.status} /> {row.n}</p>)}
          </div>
        </div>
      </div>
      <OrderDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </div>
  )
}

function PaidCard({ t, from, to, onRange, series }) {
  const days = series.data?.days || []
  const currency = series.data?.currency || 'EUR'
  const price = days.reduce((sum, day) => sum + day.price_cents, 0)
  const margin = days.reduce((sum, day) => sum + day.margin_cents, 0)
  const invoices = days.reduce((sum, day) => sum + day.invoices, 0)
  const [hover, setHover] = useState(null)
  const active = days[hover] || null

  return (
    <section className={`card report-chart ${series.loading ? 'is-loading' : ''}`}>
      <div className="report-head">
        <div>
          <h2>{t('paidByDay')}</h2>
          <p className="quiet">{t('paidByDayLede')}</p>
        </div>
        <div className="report-filters">
          <div className="report-presets" role="group" aria-label={t('paidByDay')}>
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
      </div>
      {series.error ? <div className="error">{series.error}</div> : null}
      <div className="report-stats">
        <div><span>{t('price')}</span><strong>{money(price, currency)}</strong></div>
        <div><span>{t('margin')}</span><strong className="is-margin">{money(margin, currency)}</strong></div>
        <div><span>{t('invoices')}</span><strong>{invoices}</strong></div>
      </div>
      <div className="report-legend">
        <span><i className="price" />{t('price')}</span>
        <span><i className="margin" />{t('margin')}</span>
      </div>
      <div className="report-plots" onMouseLeave={() => setHover(null)}>
        {!series.data && series.loading ? <p className="quiet">{t('loading')}</p> : (
          <>
            <div className="report-plot-wrap">
              <DailyChart days={days} currency={currency} hover={hover} onHover={setHover} />
              {active ? <Tooltip day={active} currency={currency} index={hover} count={days.length} t={t} /> : null}
              {invoices === 0 ? <div className="report-empty">{t('noPaidInRange')}</div> : null}
            </div>
            <div className="report-plot-wrap">
              <h3 className="report-sub">{t('cumulative')}</h3>
              <CumulativeChart days={days} currency={currency} hover={hover} onHover={setHover} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Tooltip({ day, currency, index, count, t }) {
  const plot = frame(count, DAILY_H, DAILY_BOTTOM)
  const x = ((LEFT + (index + 0.5) * plot.slot) / WIDTH) * 100
  const edge = x < 18 ? 'is-left' : x > 82 ? 'is-right' : ''
  return (
    <div className={`report-tip ${edge}`} style={{ left: `${x}%`, top: 18 }}>
      <div className="report-tip-day">{longDay(day.day)}</div>
      <div><span>{t('price')}</span><strong>{money(day.price_cents, currency)}</strong></div>
      <div><span>{t('margin')}</span><strong>{money(day.margin_cents, currency)}</strong></div>
    </div>
  )
}

function DailyChart({ days, currency, hover, onHover }) {
  const height = DAILY_H
  const bottom = DAILY_BOTTOM
  const plot = frame(days.length, height, bottom)
  const scale = yScale(days.flatMap((day) => [day.price_cents, day.margin_cents]), plot.top, plot.innerH)
  const ticks = axisTicks(scale.lo, scale.hi)
  const zeroY = scale.y(0)
  const every = days.length <= 14 ? 1 : days.length <= 45 ? 5 : days.length <= 120 ? 14 : 30
  const barW = Math.max(3, Math.min(22, plot.slot * 0.28))
  const gap = Math.min(3, barW * 0.35)

  function indexAt(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH
    const index = Math.floor((x - LEFT) / plot.slot)
    onHover(index >= 0 && index < days.length ? index : null)
  }

  return (
    <svg className="report-plot" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Price and margin by day" onMouseMove={indexAt}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? 'report-zero' : 'report-grid'} x1={LEFT} x2={WIDTH - RIGHT} y1={scale.y(tick)} y2={scale.y(tick)} />
          <text x={LEFT - 8} y={scale.y(tick) + 4} textAnchor="end">{axisMoney(tick, currency)}</text>
        </g>
      ))}
      {days.map((day, index) => {
        const group = LEFT + index * plot.slot + (plot.slot - (barW * 2 + gap)) / 2
        const showLabel = index % every === 0 || index === days.length - 1
        return (
          <g key={day.day}>
            {hover === index ? <rect className="report-hover" x={LEFT + index * plot.slot} y={plot.top} width={plot.slot} height={plot.innerH} /> : null}
            {barPath(group, barW, scale.y(day.price_cents), zeroY) ? <path className="report-bar-price" d={barPath(group, barW, scale.y(day.price_cents), zeroY)} /> : null}
            {barPath(group + barW + gap, barW, scale.y(day.margin_cents), zeroY) ? <path className="report-bar-margin" d={barPath(group + barW + gap, barW, scale.y(day.margin_cents), zeroY)} /> : null}
            {showLabel ? <text x={LEFT + (index + 0.5) * plot.slot} y={height - 8} textAnchor="middle">{shortDay(day.day)}</text> : null}
          </g>
        )
      })}
    </svg>
  )
}

function CumulativeChart({ days, currency, hover, onHover }) {
  const height = 148
  const bottom = 12
  const plot = frame(days.length, height, bottom)
  let price = 0
  let margin = 0
  const points = days.map((day) => {
    price += day.price_cents
    margin += day.margin_cents
    return { day: day.day, price, margin, invoices: day.invoices }
  })
  const scale = yScale(points.flatMap((point) => [point.price, point.margin]), plot.top, plot.innerH)
  const ticks = axisTicks(scale.lo, scale.hi)
  const xAt = (index) => LEFT + (index + 0.5) * plot.slot
  const zeroY = scale.y(0)
  const priceLine = linePath(points, xAt, (point) => scale.y(point.price))
  const marginLine = linePath(points, xAt, (point) => scale.y(point.margin))
  const area = points.length
    ? `${priceLine} L ${xAt(points.length - 1)} ${zeroY} L ${xAt(0)} ${zeroY} Z`
    : ''

  function indexAt(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH
    const index = Math.floor((x - LEFT) / plot.slot)
    onHover(index >= 0 && index < days.length ? index : null)
  }

  return (
    <svg className="report-plot compact" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Running total" onMouseMove={indexAt}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? 'report-zero' : 'report-grid'} x1={LEFT} x2={WIDTH - RIGHT} y1={scale.y(tick)} y2={scale.y(tick)} />
          <text x={LEFT - 8} y={scale.y(tick) + 4} textAnchor="end">{axisMoney(tick, currency)}</text>
        </g>
      ))}
      {hover != null ? <line className="report-rule" x1={xAt(hover)} x2={xAt(hover)} y1={plot.top} y2={plot.top + plot.innerH} /> : null}
      <path className="report-area" d={area} />
      <path className="report-line" d={priceLine} />
      <path className="report-line margin" d={marginLine} />
      {points.map((point, index) => point.invoices ? (
        <g key={point.day}>
          <circle className="report-dot price" cx={xAt(index)} cy={scale.y(point.price)} r="3.5" />
          <circle className="report-dot margin" cx={xAt(index)} cy={scale.y(point.margin)} r="3.5" />
        </g>
      ) : null)}
    </svg>
  )
}

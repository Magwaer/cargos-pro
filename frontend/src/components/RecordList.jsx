import { useEffect, useRef, useState } from 'react'
import { ErrorNote } from './ui.jsx'
import { useI18n } from '../i18n.jsx'

const SIZES = [5, 10, 25]
export const MARKS = ['#e6eef9', '#f6ebe2', '#e8f3ec', '#efe9f6', '#f3f1e4']

export function markColor(index) {
  return MARKS[index % MARKS.length]
}

export function markFromName(name) {
  let hash = 0
  const text = String(name || '')
  for (let index = 0; index < text.length; index += 1) hash = (hash + text.charCodeAt(index)) % MARKS.length
  return MARKS[hash]
}

export function initialsFrom(name) {
  const parts = String(name || '').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return letters || '?'
}

export function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
}

export function matchesRole(role, tab) {
  if (tab === 'all') return true
  if (tab === 'customer') return role === 'customer' || role === 'both'
  if (tab === 'carrier') return role === 'carrier' || role === 'both'
  return role === tab
}

export function Sheet({ title, lede, actions, children }) {
  return (
    <div className="sheet">
      <header className="sheet-head">
        <div className="sheet-titles">
          <h1>{title}</h1>
          {lede ? <p>{lede}</p> : null}
        </div>
        {actions ? <div className="sheet-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}

export function ListCard({
  tabs,
  tab,
  onTab,
  query,
  onQuery,
  filterPlaceholder,
  columns,
  heads,
  rows,
  renderRow,
  rowKey,
  onRow,
  rowMuted,
  loading,
  error,
  empty,
  minWidth = 720,
  view = 'table',
  onView,
  summary,
  board,
  pageSize,
}) {
  const { t } = useI18n()
  const fixedSize = Number.isFinite(pageSize)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(fixedSize ? pageSize : 5)

  useEffect(() => { setPage(1) }, [tab, query])

  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(page, pages)
  const start = (current - 1) * size
  const pageRows = rows.slice(start, start + size)
  const range = rows.length
    ? fill(t('rangeOf'), { from: start + 1, to: start + pageRows.length, total: rows.length })
    : t('rangeEmpty')

  return (
    <>
      <ErrorNote>{error}</ErrorNote>
      <section className="sheet-card">
        <div className="sheet-bar">
          {view === 'board' ? <div className="sheet-summary">{summary}</div> : (
            <div className="sheet-tabs" role="tablist">
              {tabs.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'on' : ''} onClick={() => onTab(item.id)}>
                  {item.label} <span>{item.count}</span>
                </button>
              ))}
            </div>
          )}
          <div className="sheet-tools">
            <label className={`sheet-filter${onView ? ' is-wide' : ''}`}>
              <span className="sheet-lens" aria-hidden="true" />
              <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={filterPlaceholder} />
            </label>
            {onView ? <ViewSwitch view={view} onView={onView} /> : null}
          </div>
        </div>
        {view === 'board' ? board : (
        <>
        <div className="sheet-scroll">
          <div className="sheet-table" style={{ minWidth }}>
            <div className="sheet-cols" style={{ gridTemplateColumns: columns }}>
              {heads.map((head) => (
                <div key={head.key} className={head.align === 'right' ? 'sheet-right' : ''}>{head.label}</div>
              ))}
            </div>
            {loading ? <div className="sheet-empty">{t('loading')}</div> : null}
            {!loading && rows.length === 0 ? <div className="sheet-empty">{empty}</div> : null}
            {!loading ? pageRows.map((row) => (
              <div
                key={rowKey(row)}
                className={`sheet-row${onRow ? ' is-link' : ''}${rowMuted?.(row) ? ' is-muted' : ''}`}
                style={{ gridTemplateColumns: columns }}
                role={onRow ? 'link' : undefined}
                tabIndex={onRow ? 0 : undefined}
                onClick={onRow ? () => onRow(row) : undefined}
                onKeyDown={onRow ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRow(row)
                  }
                } : undefined}
              >
                {renderRow(row)}
              </div>
            )) : null}
          </div>
        </div>
        <div className="sheet-foot">
          <div className="sheet-foot-meta">
            <span className="sheet-range">{range}</span>
            {fixedSize ? null : (
              <div className="sheet-sizes">
                <span>{t('rowsPerPage')}</span>
                {SIZES.map((n) => (
                  <button key={n} type="button" className={n === size ? 'on' : ''} onClick={() => { setSize(n); setPage(1) }}>{n}</button>
                ))}
              </div>
            )}
          </div>
          <div className="sheet-pager">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>{t('prevPage')}</button>
            {Array.from({ length: pages }, (_, index) => {
              const n = index + 1
              return (
                <button key={n} type="button" className={`num${n === current ? ' on' : ''}`} onClick={() => setPage(n)}>{n}</button>
              )
            })}
            <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>{t('nextPage')}</button>
          </div>
        </div>
        </>
        )}
      </section>
    </>
  )
}

function ViewSwitch({ view, onView }) {
  const { t } = useI18n()
  return (
    <div className="view-switch" role="group" aria-label={t('board')}>
      <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} title={t('table')} onClick={() => onView('table')}>
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <rect x="0.75" y="0.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1.5 4.2h11M1.5 7.8h11" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button type="button" className={view === 'board' ? 'on' : ''} aria-pressed={view === 'board'} title={t('board')} onClick={() => onView('board')}>
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <rect x="0.75" y="0.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.2 8.6V5.2M7 8.6V3.4M10.8 8.6V2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export function StatusBoard({ columns, onMove, onOpen, empty, renderCard }) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const dragged = useRef(false)

  return (
    <div className="board-scroll">
      <div className="board" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(260px, 1fr))` }}>
        {columns.map((column) => (
          <div
            key={column.id}
            className={`board-col${overId === column.id && dragId ? ' is-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              if (overId !== column.id) setOverId(column.id)
            }}
            onDrop={(event) => {
              event.preventDefault()
              const id = event.dataTransfer.getData('text/plain') || dragId
              setDragId(null)
              setOverId(null)
              if (id) onMove(id, column.id)
            }}
          >
            <div className="board-col-head">
              <div className="board-col-name"><span className="sheet-dot" style={{ background: column.dot }} />{column.label}</div>
              <div className="board-col-meta">
                {column.sum ? <span className="board-sum">{column.sum}</span> : null}
                <span className="board-count">{column.items.length}</span>
              </div>
            </div>
            {column.items.map((item) => (
              <article
                key={item.id}
                className={`board-card${dragId === item.id ? ' is-dragging' : ''}`}
                draggable
                onDragStart={(event) => {
                  dragged.current = true
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                  setDragId(item.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                  setTimeout(() => { dragged.current = false }, 0)
                }}
                onClick={() => {
                  if (dragged.current) return
                  onOpen?.(item)
                }}
              >
                {renderCard(item)}
              </article>
            ))}
            {column.items.length === 0 ? <div className="board-empty">{empty}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export function BoardCard({ kicker, title, aside, from, to, meta, price, action, onAction }) {
  return (
    <>
      {title ? (
        <div className="board-deal-head">
          <div className="board-deal-title">{kicker}</div>
          {aside ? <div className="board-customer is-block">{aside}</div> : null}
        </div>
      ) : (
        <div className="board-card-top">
          <span className="board-ref">{kicker}</span>
          {aside ? <span className="board-customer">{aside}</span> : null}
        </div>
      )}
      <div className="board-lane"><span>{from || '—'}</span><span className="sheet-faint">→</span><span>{to || '—'}</span></div>
      {meta ? <div className="board-meta">{meta}</div> : null}
      <div className="board-foot">
        <span className="board-price">{price}</span>
        {action ? (
          <button type="button" className="board-act" onClick={(event) => { event.stopPropagation(); onAction() }}>{action}</button>
        ) : null}
      </div>
    </>
  )
}

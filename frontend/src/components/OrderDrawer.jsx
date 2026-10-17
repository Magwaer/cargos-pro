import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { downloadFile, useFetch } from '../api.js'
import { day, leg, money, when } from '../format.js'
import { useI18n } from '../i18n.jsx'
import { fill } from './RecordList.jsx'
import { useInvoiceDrawer } from './InvoiceDrawer.jsx'
import { Pill } from './ui.jsx'

const ROLES = ['customer', 'broker']

export function OrderDrawer({ orderId, task, onClose }) {
  const { t } = useI18n()
  const titleId = useId()
  const { open: openInvoice } = useInvoiceDrawer()
  const { data, loading, error } = useFetch(orderId ? `/api/orders/${orderId}` : null)
  const open = Boolean(orderId || task)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  const expenses = data?.expense_cents ?? 0
  const margin = data ? data.price_cents - expenses : 0
  const pct = data?.price_cents ? Math.round((margin / data.price_cents) * 100) : 0
  const custom = data?.custom && typeof data.custom === 'object' ? data.custom : {}
  const distance = data ? leg(data.distance_km, data.duration_min) : null

  return createPortal(
    <div className="inv-back" onMouseDown={onClose}>
      <aside
        className="inv-drawer order-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="inv-head">
          <div>
            <div className="inv-kicker">{task?.title || t('type_order')}</div>
            <h2 id={titleId}>{data?.reference || (loading ? t('loading') : t('type_order'))}</h2>
          </div>
          <button type="button" className="inv-close" onClick={onClose} aria-label={t('dismiss')}>×</button>
        </header>
        <div className="inv-body">
          {error ? <div className="error">{error}</div> : null}
          {loading && orderId ? <p className="quiet">{t('loading')}</p> : null}
          {!orderId ? <p className="quiet">{t('noOrderYet')}</p> : null}
          {data ? (
            <>
              <div className="inv-summary">
                <div>
                  {data.company_id ? (
                    <Link className="inv-link-text" to={`/companies/${data.company_id}`} onClick={onClose}>{data.company_name}</Link>
                  ) : <div>{data.company_name || '—'}</div>}
                  <div className="inv-muted">{data.origin || '—'} → {data.destination || '—'}</div>
                </div>
                <Pill value={data.status} />
              </div>
              <section>
                <h3>{t('lane')}</h3>
                <div className="order-place">
                  <div className="order-kicker">{t('origin')}</div>
                  <div>{data.origin || '—'}</div>
                  <div className="inv-muted">{t('pickup')}{data.pickup_at ? ` · ${when(data.pickup_at)}` : ` · ${t('notScheduled')}`}</div>
                </div>
                <div className="order-place" style={{ marginTop: 12 }}>
                  <div className="order-kicker">{t('destination')}</div>
                  <div>{data.destination || '—'}</div>
                  <div className="inv-muted">{t('delivery')}{data.delivery_at ? ` · ${when(data.delivery_at)}` : ` · ${t('notScheduled')}`}</div>
                </div>
                {distance ? <div className="inv-muted" style={{ marginTop: 8 }}>{distance}</div> : null}
              </section>
              <dl className="inv-facts">
                <dt>{t('loadType')}</dt><dd>{data.load_type || '—'}</dd>
                <dt>{t('weight')}</dt><dd>{data.weight_kg ? `${Number(data.weight_kg).toLocaleString()} kg` : '—'}</dd>
                <dt>{t('rate')}</dt><dd>{money(data.price_cents, data.currency)}</dd>
                <dt>{t('expenses')}</dt><dd>{money(expenses, data.currency)}</dd>
                <dt>{t('margin')}</dt><dd>{money(margin, data.currency)}{data.price_cents ? ` · ${fill(t('pctOfRevenue'), { pct })}` : ''}</dd>
              </dl>
              {data.cargo || data.notes ? (
                <section>
                  <h3>{t('kind')}</h3>
                  {data.cargo ? <div>{data.cargo}</div> : null}
                  {data.notes ? <p className="inv-note">{data.notes}</p> : null}
                </section>
              ) : null}
              <section>
                <h3>{t('companies')}</h3>
                {ROLES.map((role) => {
                  const party = data.parties?.[role]
                  return (
                    <div className="order-drawer-party" key={role}>
                      <div className="order-kicker">{t(`st_${role}`)}</div>
                      {party?.company?.id ? (
                        <Link className="inv-link-text" to={`/companies/${party.company.id}`} onClick={onClose}>{party.company.name}</Link>
                      ) : <div>{party?.company?.name || t('noneYet')}</div>}
                      {party?.contact?.name ? <div className="inv-muted">{party.contact.name}</div> : null}
                    </div>
                  )
                })}
              </section>
              {(data.expenses || []).length ? (
                <section>
                  <h3>{t('expenses')}</h3>
                  {data.expenses.map((row) => (
                    <div className="order-expense" key={row.id}>
                      <span>
                        <div>{row.label}</div>
                        <div className="inv-muted">{[day(row.occurred_on), t(`pay_${row.payment_type || 'cash'}`), row.company_name].filter(Boolean).join(' · ')}</div>
                      </span>
                      <span className="sheet-mono">{money(row.amount_cents, row.currency || data.currency)}</span>
                    </div>
                  ))}
                </section>
              ) : null}
              {(data.properties || []).length ? (
                <section>
                  <h3>{t('orderFields')}</h3>
                  <dl className="inv-facts">
                    {data.properties.map((def) => {
                      const value = custom[def.key]
                      const shown = Array.isArray(value) ? value.join(', ') : (value || '—')
                      return [
                        <dt key={`${def.id}-n`}>{def.name}</dt>,
                        <dd key={`${def.id}-v`}>{shown}</dd>,
                      ]
                    })}
                  </dl>
                </section>
              ) : null}
              <section>
                <h3>{t('st_carrier')}</h3>
                {data.relations?.length ? data.relations.map((relation) => (
                  <div className="order-drawer-party" key={relation.id}>
                    <div>{relation.kind === 'own_fleet' ? `${relation.plate || t('ownFleet')} · ${relation.driver_name || '—'}` : (relation.carrier_name || t('subcontracted'))}</div>
                    <div className="inv-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {money(relation.cost_cents, relation.currency)}
                      <Pill value={relation.status} />
                    </div>
                  </div>
                )) : <div className="inv-muted">{t('notAssigned')}</div>}
              </section>
              <section>
                <h3>{t('type_invoice')}</h3>
                {data.invoice ? (
                  <button type="button" className="detail-deal" onClick={() => openInvoice(data.invoice.id)}>
                    <div className="detail-deal-copy">
                      <div className="order-invoice-no">{data.invoice.number}</div>
                      <div className="detail-deal-amount">{money(data.invoice.amount_cents, data.invoice.currency)}</div>
                    </div>
                    <Pill value={data.invoice.status} />
                  </button>
                ) : <div className="inv-muted">{t('noInvoiceYet')}</div>}
              </section>
              <section>
                <h3>{t('documents')}</h3>
                {data.documents?.length ? data.documents.map((doc) => (
                  <button type="button" className="order-doc" key={doc.id} onClick={() => downloadFile(`/api/documents/${doc.id}/file`, doc.filename)}>
                    <span className="order-doc-kind">{t(`kind_${doc.kind}`) === `kind_${doc.kind}` ? doc.kind : t(`kind_${doc.kind}`)}</span>
                    <span className="order-doc-name">{doc.filename}</span>
                  </button>
                )) : <div className="inv-muted">{t('noneYet')}</div>}
              </section>
            </>
          ) : null}
        </div>
        {orderId ? (
          <footer className="inv-actions">
            <Link className="dash-btn primary" to={`/orders/${orderId}`} onClick={onClose}>{t('openOrder')}</Link>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  )
}

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { InvoiceIssuer } from '../components/InvoiceDrawer.jsx'
import { Pill } from '../components/ui.jsx'
import { day, money } from '../format.js'
import { useI18n } from '../i18n.jsx'

export default function PublicInvoice() {
  const { token } = useParams()
  const { t } = useI18n()
  const [invoice, setInvoice] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setInvoice(null)
    setError('')
    fetch(`/api/public/invoices/${token}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || t('invoiceMissing'))
        return body
      })
      .then((row) => { if (live) setInvoice(row) })
      .catch((err) => { if (live) setError(err.message || t('invoiceMissing')) })
    return () => { live = false }
  }, [token, t])

  const lane = [invoice?.origin, invoice?.destination].filter(Boolean).join(' → ')
  const place = [invoice?.company_city, invoice?.company_country].filter(Boolean).join(', ')

  return (
    <main className="public-invoice">
      <article className="public-sheet inv-root">
        {error ? <div className="error">{error}</div> : null}
        {!invoice && !error ? <p className="quiet">{t('loading')}</p> : null}
        {invoice ? (
          <>
            <header className="inv-head">
              <div>
                <div className="inv-kicker">{invoice.issuer_name || invoice.tenant_name}</div>
                <h2>{invoice.number}</h2>
              </div>
              <Pill value={invoice.status} />
            </header>
            <div className="inv-amount">{money(invoice.amount_cents, invoice.currency)}</div>
            <InvoiceIssuer invoice={invoice} />
            <section>
              <h3>{t('billTo')}</h3>
              <div>{invoice.company_name || '—'}</div>
              {place ? <div className="inv-muted">{place}</div> : null}
              {invoice.company_vat ? <div className="inv-muted">{t('vat')} {invoice.company_vat}</div> : null}
            </section>
            {invoice.reference || lane || invoice.cargo ? (
              <section>
                <h3>{t('shipment')}</h3>
                {invoice.reference ? <div className="inv-mono">{invoice.reference}</div> : null}
                {lane ? <div>{lane}</div> : null}
                {invoice.cargo ? <div className="inv-muted">{invoice.cargo}</div> : null}
              </section>
            ) : null}
            <dl className="inv-facts">
              <dt>{t('issued')}</dt><dd>{day(invoice.issued_at) || '—'}</dd>
              <dt>{t('due')}</dt><dd>{day(invoice.due_at) || '—'}</dd>
              <dt>{t('paidOn')}</dt><dd>{day(invoice.paid_at) || '—'}</dd>
            </dl>
            <a className="dash-btn primary" href={`/api/public/invoices/${token}/pdf`}>{t('downloadPdf')}</a>
          </>
        ) : null}
      </article>
    </main>
  )
}

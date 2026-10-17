import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api, downloadFile } from '../api.js'
import { day, money } from '../format.js'
import { useI18n } from '../i18n.jsx'
import { fill } from './RecordList.jsx'
import { Pill } from './ui.jsx'

const InvoiceContext = createContext(null)

export function InvoiceProvider({ children }) {
  const [id, setId] = useState(null)
  const open = useCallback((next) => { if (next) setId(next) }, [])
  const close = useCallback(() => setId(null), [])
  return (
    <InvoiceContext.Provider value={{ open, close }}>
      {children}
      <InvoiceDrawer id={id} onClose={close} />
    </InvoiceContext.Provider>
  )
}

export function useInvoiceDrawer() {
  const ctx = useContext(InvoiceContext)
  if (!ctx) throw new Error('Invoice drawer is unavailable')
  return ctx
}

function InvoiceDrawer({ id, onClose }) {
  const { t } = useI18n()
  const titleId = useId()
  const [invoice, setInvoice] = useState(null)
  const [shownFor, setShownFor] = useState(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState('')
  const linkRef = useRef(null)
  if (id !== shownFor) {
    setShownFor(id)
    setInvoice(null)
    setEmail('')
    setError('')
    setNote('')
    setCopied(false)
    setBusy('')
  }

  useEffect(() => {
    if (!id) return undefined
    let live = true
    setInvoice(null)
    setError('')
    setNote('')
    setCopied(false)
    setEmail('')
    api(`/api/invoices/${id}`)
      .then((row) => {
        if (!live) return
        setInvoice(row)
        setEmail(row.company_email || '')
      })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [id])

  useEffect(() => {
    if (!id) return undefined
    let live = true
    const onChange = () => {
      api(`/api/invoices/${id}`).then((row) => {
        if (!live) return
        setInvoice(row)
        setEmail((current) => current || row.company_email || '')
      }).catch(() => {})
    }
    window.addEventListener('cargos-invoice', onChange)
    return () => {
      live = false
      window.removeEventListener('cargos-invoice', onChange)
    }
  }, [id])

  useEffect(() => {
    if (!id) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [id, onClose])

  if (!id) return null

  const lane = [invoice?.origin, invoice?.destination].filter(Boolean).join(' → ')
  const place = [invoice?.company_city, invoice?.company_country].filter(Boolean).join(', ')
  const canPay = invoice && invoice.status !== 'paid' && invoice.status !== 'void'

  async function markPaid() {
    setBusy('paid')
    setError('')
    setNote('')
    try {
      await api(`/api/invoices/${id}`, { method: 'PATCH', body: { status: 'paid' } })
      setInvoice(await api(`/api/invoices/${id}`))
      window.dispatchEvent(new Event('cargos-invoice'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function sendEmail() {
    setBusy('email')
    setError('')
    setNote('')
    try {
      const row = await api(`/api/invoices/${id}/email`, { method: 'POST', body: { email } })
      setInvoice(row)
      setNote(fill(t('emailSent'), { email: email.trim() }))
      window.dispatchEvent(new Event('cargos-invoice'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function downloadPdf() {
    setBusy('pdf')
    setError('')
    try {
      await downloadFile(`/api/invoices/${id}/pdf`, `${invoice.number}.pdf`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  function markCopied() {
    setCopied(true)
    setError('')
    window.setTimeout(() => setCopied(false), 2000)
  }

  async function copyLink() {
    const url = invoice?.public_url
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      markCopied()
      return
    } catch { /* the field below is the fallback */ }
    const input = linkRef.current
    if (input) {
      input.focus()
      input.select()
      try {
        if (document.execCommand('copy')) {
          markCopied()
          return
        }
      } catch { /* show the hint */ }
    }
    setError(t('copyFailed'))
  }

  return createPortal(
    <div className="inv-back" onMouseDown={onClose}>
      <aside
        className="inv-drawer inv-root"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="inv-head">
          <div>
            <div className="inv-kicker">{invoice?.issuer_name || invoice?.tenant_name || t('type_invoice')}</div>
            <h2 id={titleId}>{invoice?.number || t('loading')}</h2>
          </div>
          <button type="button" className="inv-close" onClick={onClose} aria-label={t('dismiss')}>×</button>
        </header>
        <div className="inv-body">
          {error ? <div className="error">{error}</div> : null}
          {note ? <div className="banner ok">{note}</div> : null}
          {!invoice && !error ? <p className="quiet">{t('loading')}</p> : null}
          {invoice ? (
            <>
              <div className="inv-summary">
                <div className="inv-amount">{money(invoice.amount_cents, invoice.currency)}</div>
                <Pill value={invoice.status} />
              </div>
              <InvoiceIssuer invoice={invoice} />
              <section>
                <h3>{t('billTo')}</h3>
                {invoice.company_id ? (
                  <Link className="inv-link-text" to={`/companies/${invoice.company_id}`} onClick={onClose}>{invoice.company_name}</Link>
                ) : <div>{invoice.company_name || '—'}</div>}
                {place ? <div className="inv-muted">{place}</div> : null}
                {invoice.company_vat ? <div className="inv-muted">{t('vat')} {invoice.company_vat}</div> : null}
              </section>
              {invoice.order_id || lane || invoice.cargo ? (
                <section>
                  <h3>{t('shipment')}</h3>
                  {invoice.order_id ? (
                    <Link className="inv-link-text" to={`/orders/${invoice.order_id}`} onClick={onClose}>{invoice.reference || t('type_order')}</Link>
                  ) : null}
                  {lane ? <div>{lane}</div> : null}
                  {invoice.cargo ? <div className="inv-muted">{invoice.cargo}</div> : null}
                </section>
              ) : null}
              <dl className="inv-facts">
                <dt>{t('issued')}</dt><dd>{day(invoice.issued_at) || '—'}</dd>
                <dt>{t('due')}</dt><dd>{day(invoice.due_at) || '—'}</dd>
                <dt>{t('paidOn')}</dt><dd>{day(invoice.paid_at) || '—'}</dd>
              </dl>
              <section>
                <h3>{t('copyLink')}</h3>
                <p className="inv-muted">{t('publicHint')}</p>
                <div className="inv-share">
                  <input ref={linkRef} readOnly value={invoice.public_url || ''} onFocus={(event) => event.target.select()} aria-label={t('copyLink')} />
                  <button type="button" className="dash-btn" onClick={copyLink}>{copied ? t('copied') : t('copyLink')}</button>
                </div>
              </section>
            </>
          ) : null}
        </div>
        {invoice ? (
          <footer className="inv-actions">
            {canPay ? (
              <button type="button" className="dash-btn primary" disabled={Boolean(busy)} onClick={markPaid}>
                {t('markPaid')}
              </button>
            ) : null}
            <label className="inv-email">
              <span>{t('emailTo')}</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('emailTo')} />
            </label>
            {!email.trim() ? <p className="inv-muted">{t('noCustomerEmail')}</p> : null}
            <button type="button" className="dash-btn" disabled={Boolean(busy) || !email.includes('@')} onClick={sendEmail}>
              {t('sendEmail')}
            </button>
            <button type="button" className="dash-btn" disabled={Boolean(busy)} onClick={downloadPdf}>
              {t('downloadPdf')}
            </button>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  )
}

export function InvoiceIssuer({ invoice }) {
  const { t } = useI18n()
  if (!invoice) return null
  const place = [invoice.issuer_city, invoice.issuer_country].filter(Boolean).join(', ')
  const bank = [invoice.issuer_bank, invoice.issuer_iban, invoice.issuer_swift].filter(Boolean).join(' · ')
  const lines = [
    invoice.issuer_address,
    place,
    invoice.issuer_vat ? `${t('vat')} ${invoice.issuer_vat}` : '',
    invoice.issuer_email,
    invoice.issuer_phone,
    bank,
  ].filter(Boolean)
  if (!lines.length && !invoice.issuer_footer) return null
  return (
    <section>
      <h3>{t('fromAccount')}</h3>
      <div>{invoice.issuer_name || invoice.tenant_name}</div>
      {lines.map((line, index) => <div className="inv-muted" key={`${index}-${line}`}>{line}</div>)}
      {invoice.issuer_footer ? <p className="inv-note">{invoice.issuer_footer}</p> : null}
    </section>
  )
}

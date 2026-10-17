import { useEffect, useState } from 'react'
import { api, useFetch } from '../api.js'
import { useInvoiceDrawer } from '../components/InvoiceDrawer.jsx'
import { ListCard, Sheet, fill } from '../components/RecordList.jsx'
import { Pill } from '../components/ui.jsx'
import { day, money } from '../format.js'
import { useI18n } from '../i18n.jsx'

const TABS = ['draft', 'sent', 'paid', 'overdue']

export default function Invoices() {
  const { t } = useI18n()
  const { open } = useInvoiceDrawer()
  const { data, loading, error, reload } = useFetch('/api/invoices')
  useEffect(() => {
    const onChange = () => reload()
    window.addEventListener('cargos-invoice', onChange)
    return () => window.removeEventListener('cargos-invoice', onChange)
  }, [reload])
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const invoices = data?.data || []
  const q = query.trim().toLowerCase()
  const rows = invoices.filter((row) => (tab === 'all' || row.status === tab) && (!q || `${row.number} ${row.company_name || ''} ${row.reference || ''}`.toLowerCase().includes(q)))
  const statuses = invoices.some((row) => row.status === 'void') ? [...TABS, 'void'] : TABS
  const tabs = [{ id: 'all', label: t('all') }, ...statuses.map((status) => ({ id: status, label: t(`st_${status}`) }))]
    .map((item) => ({ ...item, count: invoices.filter((row) => item.id === 'all' || row.status === item.id).length }))

  async function patch(id, body) {
    await api(`/api/invoices/${id}`, { method: 'PATCH', body })
    window.dispatchEvent(new Event('cargos-invoice'))
  }

  return (
    <Sheet title={t('invoices')} lede={t('invoicesLede')}>
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterNumberCustomer')}
        columns="120px minmax(0,1.4fr) 110px 120px 110px 100px minmax(180px,auto)"
        minWidth={980}
        heads={[
          { key: 'number', label: t('numberCol') },
          { key: 'customer', label: t('customer') },
          { key: 'order', label: t('type_order') },
          { key: 'status', label: t('status') },
          { key: 'due', label: t('due') },
          { key: 'amount', label: t('amount'), align: 'right' },
          { key: 'actions', label: '' },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        onRow={(row) => open(row.id)}
        loading={loading}
        error={error}
        empty={q ? fill(t('noInvoices'), { query: query.trim() }) : t('emptyView')}
        renderRow={(row) => (
          <>
            <div className="sheet-mono">{row.number}</div>
            <div className="sheet-ellipsis">{row.company_name || '—'}</div>
            <div className="sheet-mono">{row.reference || '—'}</div>
            <Pill value={row.status} />
            <div className="sheet-mono">{day(row.due_at)}</div>
            <div className="sheet-mono sheet-right">{money(row.amount_cents, row.currency)}</div>
            <div className="sheet-row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              {row.status === 'draft' ? <button type="button" className="sheet-mini" onClick={() => patch(row.id, { status: 'sent' })}>{t('send')}</button> : null}
              {row.status === 'sent' || row.status === 'overdue' ? <button type="button" className="sheet-mini" onClick={() => patch(row.id, { status: 'paid' })}>{t('markPaid')}</button> : null}
              <button type="button" className="sheet-mini" onClick={() => api(`/api/invoices/${row.id}/quickbooks`, { method: 'POST', body: {} }).then(reload).catch((err) => alert(err.message))}>QuickBooks</button>
            </div>
          </>
        )}
      />
    </Sheet>
  )
}

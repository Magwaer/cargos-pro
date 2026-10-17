import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, downloadFile, useFetch } from '../api.js'
import { useInvoiceDrawer } from '../components/InvoiceDrawer.jsx'
import { ActivityPanel, STATUS_DOT } from '../components/RecordDetail.jsx'
import { BoardCard, ListCard, Sheet, StatusBoard, fill } from '../components/RecordList.jsx'
import { ExpenseFields, emptyExpense, expenseBody, expenseToForm } from '../components/ExpenseForm.jsx'
import { Lookup } from '../components/Lookup.jsx'
import { Button, ErrorNote, Field, Modal, Pill } from '../components/ui.jsx'
import { day, eurosToCents, leg, money, when } from '../format.js'
import { useI18n } from '../i18n.jsx'

const STATUSES = ['booked', 'assigned', 'in_transit', 'delivered', 'invoiced']
const ORDER_STATUSES = [...STATUSES, 'cancelled']
const CURRENCIES = ['EUR', 'PLN', 'RON', 'MDL', 'GBP', 'USD']
const DOC_KINDS = ['cmr', 'pod', 'invoice', 'other']

function dateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function priceInput(cents) {
  if (cents == null || cents === '') return ''
  const value = Number(cents) / 100
  return Number.isFinite(value) ? String(value) : ''
}

function orderForm(row) {
  return {
    companyId: row?.company_id || '',
    companyName: row?.company_name || '',
    status: row?.status || 'booked',
    origin: row?.origin || '',
    destination: row?.destination || '',
    cargo: row?.cargo || '',
    weightKg: row?.weight_kg ?? '',
    loadType: row?.load_type || 'FTL',
    price: priceInput(row?.price_cents),
    currency: row?.currency || 'EUR',
    pickupAt: dateTimeInput(row?.pickup_at),
    deliveryAt: dateTimeInput(row?.delivery_at),
    notes: row?.notes || '',
  }
}

export default function Orders() {
  const { id } = useParams()
  return id ? <OrderDetail id={id} /> : <OrderList />
}

function OrderList() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { open: openInvoice } = useInvoiceDrawer()
  const { data, loading, error, reload } = useFetch('/api/orders')
  const addresses = useFetch('/api/addresses')
  const [mode, setMode] = useState('table')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [listErr, setListErr] = useState('')
  const [form, setForm] = useState({ companyId: '', companyName: '', origin: '', destination: '', cargo: '', weightKg: '', loadType: 'FTL', price: '', currency: 'EUR', pickupAt: '', deliveryAt: '', notes: '' })

  useEffect(() => {
    if (!location.state?.create) return
    const companyId = location.state.companyId || ''
    const companyName = location.state.companyName || ''
    if (companyId) setForm((current) => ({ ...current, companyId, companyName: companyName || current.companyName }))
    setOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  async function create(event) {
    event.preventDefault()
    try {
      const row = await api('/api/orders', { method: 'POST', body: { ...form, companyId: form.companyId || null, priceCents: eurosToCents(form.price), weightKg: form.weightKg ? Number(form.weightKg) : null } })
      setOpen(false)
      navigate(`/orders/${row.id}`)
    } catch (error) { setErr(error.message) }
  }

  const orders = data?.data || []
  const q = query.trim().toLowerCase()
  const matched = orders.filter((order) => !q || `${order.reference} ${order.company_name || ''} ${order.origin || ''} ${order.destination || ''}`.toLowerCase().includes(q))
  const statuses = orders.some((order) => order.status === 'cancelled') ? [...STATUSES, 'cancelled'] : STATUSES
  const rows = matched.filter((order) => tab === 'all' || order.status === tab)
  const tabs = [{ id: 'all', label: t('all') }, ...statuses.map((status) => ({ id: status, label: t(`st_${status}`) }))]
    .map((item) => ({ ...item, count: item.id === 'all' ? matched.length : matched.filter((order) => order.status === item.id).length }))
  const currency = matched.find((order) => order.currency)?.currency || 'EUR'
  const total = matched.reduce((sum, order) => sum + Number(order.price_cents || 0), 0)

  async function move(id, status) {
    const current = orders.find((order) => order.id === id)
    if (!current || current.status === status) return
    setListErr('')
    try {
      await api(`/api/orders/${id}`, { method: 'PATCH', body: { status } })
      reload()
    } catch (error) { setListErr(error.message) }
  }

  async function invoice(order) {
    setListErr('')
    try {
      const created = await api(`/api/orders/${order.id}/invoice`, { method: 'POST', body: {} })
      reload()
      if (created?.id) openInvoice(created.id)
    } catch (error) { setListErr(error.message) }
  }

  function actionFor(order) {
    if (order.status === 'booked') return { label: t('assign'), run: () => move(order.id, 'assigned') }
    if (order.status === 'assigned') return { label: t('startTransit'), run: () => move(order.id, 'in_transit') }
    if (order.status === 'in_transit') return { label: t('markDeliveredShort'), run: () => move(order.id, 'delivered') }
    if (order.status === 'delivered') return { label: t('generateInvoice'), run: () => invoice(order) }
    return null
  }

  const columns = STATUSES.map((status) => {
    const items = matched.filter((order) => order.status === status)
    const sum = items.reduce((acc, order) => acc + Number(order.price_cents || 0), 0)
    return {
      id: status,
      label: t(`st_${status}`),
      dot: STATUS_DOT[status] || '#a9a8a1',
      sum: items.length ? money(sum, items[0].currency || currency) : '',
      items,
    }
  })

  return (
    <Sheet
      title={t('orders')}
      lede={t('ordersLede')}
      actions={<button type="button" className="dash-btn primary" onClick={() => setOpen(true)}>{t('newOrder')}</button>}
    >
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterRefCustomer')}
        columns="110px minmax(0,1.2fr) minmax(0,1.6fr) 120px 90px"
        minWidth={760}
        heads={[
          { key: 'ref', label: t('reference') },
          { key: 'customer', label: t('customer') },
          { key: 'lane', label: t('lane') },
          { key: 'status', label: t('status') },
          { key: 'price', label: t('price'), align: 'right' },
        ]}
        rows={rows}
        rowKey={(order) => order.id}
        onRow={(order) => navigate(`/orders/${order.id}`)}
        loading={loading}
        error={listErr || error}
        empty={q ? fill(t('noOrders'), { query: query.trim() }) : t('emptyView')}
        view={mode}
        onView={setMode}
        pageSize={5}
        summary={fill(matched.length === 1 ? t('orderTotalOne') : t('orderTotalMany'), { n: matched.length, sum: money(total, currency) })}
        board={loading ? <div className="sheet-empty">{t('loading')}</div> : (
          <StatusBoard
            columns={columns}
            empty={t('dropOrders')}
            onMove={move}
            onOpen={(order) => navigate(`/orders/${order.id}`)}
            renderCard={(order) => {
              const action = actionFor(order)
              const meta = [order.cargo, leg(order.distance_km, order.duration_min)].filter(Boolean).join(' · ')
              return (
                <BoardCard
                  kicker={order.reference}
                  aside={order.company_name}
                  from={order.origin}
                  to={order.destination}
                  meta={meta}
                  price={money(order.price_cents, order.currency)}
                  action={action?.label}
                  onAction={action?.run}
                />
              )
            }}
          />
        )}
        renderRow={(order) => (
          <>
            <div className="sheet-mono sheet-ref">{order.reference}</div>
            <div className="sheet-ellipsis">{order.company_name}</div>
            <div className="sheet-lane"><span>{order.origin}</span><span className="sheet-faint">→</span><span>{order.destination}</span></div>
            <Pill value={order.status} />
            <div className="sheet-mono sheet-right">{money(order.price_cents, order.currency)}</div>
          </>
        )}
      />
      {open ? (
        <Modal title="New order" onClose={() => setOpen(false)}>
          <form onSubmit={create}>
            <ErrorNote>{err}</ErrorNote>
            <OrderFields form={form} setForm={setForm} addresses={addresses.data?.data} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </Sheet>
  )
}

function OrderDetail({ id }) {
  const { t } = useI18n()
  const { open } = useInvoiceDrawer()
  const { data, loading, error, reload } = useFetch(`/api/orders/${id}`)
  const addresses = useFetch('/api/addresses')
  useEffect(() => {
    const onChange = () => reload()
    window.addEventListener('cargos-invoice', onChange)
    return () => window.removeEventListener('cargos-invoice', onChange)
  }, [reload])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [docKind, setDocKind] = useState('cmr')
  const [file, setFile] = useState(null)
  const fileRef = useRef(null)
  const [partyRole, setPartyRole] = useState('')
  const [partyForm, setPartyForm] = useState({ companyId: '', companyName: '', contactId: '', contactName: '' })
  const [expenseForm, setExpenseForm] = useState(null)
  const [custom, setCustom] = useState(null)
  if (!data && loading) return <div className="detail"><p className="quiet">{t('loading')}</p></div>
  if (!data && error) return <div className="detail"><div className="error">{error}</div></div>
  if (!data) return null
  const expenses = data.expense_cents ?? 0
  const margin = data.price_cents - expenses
  const pct = data.price_cents ? Math.round((margin / data.price_cents) * 100) : 0
  const fields = data.custom && typeof data.custom === 'object' ? data.custom : {}
  const draftCustom = custom ?? fields
  const step = STATUSES.indexOf(data.status)
  const distance = leg(data.distance_km, data.duration_min)
  const source = data.distance_source === 'google' ? t('googleMaps') : data.distance_source === 'estimate' ? t('roadEstimate') : ''

  async function act(fn) {
    setErr('')
    try { await fn(); reload() } catch (error) { setErr(error.message) }
  }

  function openEdit() {
    setErr('')
    setForm(orderForm(data))
    setEditing(true)
  }

  async function save(event) {
    event.preventDefault()
    setErr('')
    try {
      await api(`/api/orders/${id}`, {
        method: 'PATCH',
        body: {
          companyId: form.companyId || null,
          status: form.status,
          origin: form.origin,
          destination: form.destination,
          cargo: form.cargo,
          weightKg: form.weightKg === '' || form.weightKg == null ? null : Number(form.weightKg),
          loadType: form.loadType,
          priceCents: eurosToCents(form.price),
          currency: form.currency,
          pickupAt: form.pickupAt || null,
          deliveryAt: form.deliveryAt || null,
          notes: form.notes,
        },
      })
      setEditing(false)
      reload()
    } catch (error) { setErr(error.message) }
  }

  async function upload() {
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    form.set('objectType', 'order')
    form.set('objectId', id)
    form.set('kind', docKind)
    setErr('')
    try {
      await api('/api/documents', { method: 'POST', form })
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      reload()
    } catch (error) { setErr(error.message) }
  }

  return (
    <div className="detail">
      <nav className="detail-crumb">
        <Link to="/orders">{t('orders')}</Link>
        <span className="detail-sep">/</span>
        <span className="order-crumb">{data.reference}</span>
      </nav>
      <div className="detail-head">
        <div className="detail-id">
          <div className="detail-title">
            <h1 className="order-ref">{data.reference}</h1>
            <Pill value={data.status} />
          </div>
          {data.company_id ? <Link className="order-company" to={`/companies/${data.company_id}`}>{data.company_name}</Link> : data.company_name ? <span className="order-company">{data.company_name}</span> : null}
        </div>
        <div className="dash-actions">
          <button type="button" className="dash-btn" onClick={openEdit}>{t('edit')}</button>
          <button type="button" className="dash-btn primary" onClick={async () => {
            setErr('')
            try {
              const invoice = await api(`/api/orders/${id}/invoice`, { method: 'POST', body: {} })
              reload()
              if (invoice?.id) open(invoice.id)
            } catch (error) { setErr(error.message) }
          }}>{t('generateInvoice')}</button>
        </div>
      </div>
      <ErrorNote>{err}</ErrorNote>
      <section className="order-steps">
        <div className="order-step-grid">
          {STATUSES.map((status, index) => (
            <div className={`order-step ${index < step ? 'done' : ''} ${index === step ? 'now' : ''}`} key={status}>
              <div className="order-step-bar" />
              <div>{t(`st_${status}`)}</div>
            </div>
          ))}
        </div>
      </section>
      <div className="detail-cols">
        <div className="detail-main">
          <section className="detail-card order-lane">
            <div className="order-lane-top">
              <div className="order-place">
                <div className="order-kicker">{t('origin')}</div>
                <div className="order-city">{data.origin || '—'}</div>
                <div className="order-when">{t('pickup')}{data.pickup_at ? <span> · {when(data.pickup_at)}</span> : <span className="faint"> · {t('notScheduled')}</span>}</div>
              </div>
              <div className="order-leg">
                <div className="order-leg-km">{distance || t('distanceUnavailable')}</div>
                <div className="order-track"><span className="order-pin" /><span className="order-dash" /><span className="order-pin fill" /></div>
                {source ? <div className="order-source">{source}</div> : null}
              </div>
              <div className="order-place end">
                <div className="order-kicker">{t('destination')}</div>
                <div className="order-city">{data.destination || '—'}</div>
                <div className="order-when">{t('delivery')}{data.delivery_at ? <span> · {when(data.delivery_at)}</span> : <span className="faint"> · {t('notScheduled')}</span>}</div>
              </div>
            </div>
            <div className="order-facts">
              <Fact label={t('loadType')} value={data.load_type} empty={t('notSet')} />
              <Fact label={t('weight')} value={data.weight_kg ? `${Number(data.weight_kg).toLocaleString()} kg` : ''} empty={t('notSet')} />
              <Fact label={t('pickupDate')} value={data.pickup_at ? when(data.pickup_at) : ''} empty={t('notSet')} />
              <Fact label={t('deliveryDate')} value={data.delivery_at ? when(data.delivery_at) : ''} empty={t('notSet')} />
            </div>
          </section>
          <section className="detail-stats">
            <div className="detail-stat">
              <div className="label">{t('rate')}</div>
              <div className="value">{money(data.price_cents, data.currency)}</div>
            </div>
            <div className="detail-stat">
              <div className="label">{t('expenses')}</div>
              <div className="value">{money(expenses, data.currency)}</div>
            </div>
            <div className="detail-stat">
              <div className="label">{t('margin')}</div>
              <div className={`value ${margin > 0 ? 'is-won' : ''}`}>{money(margin, data.currency)}</div>
              <div className="hint">{fill(t('pctOfRevenue'), { pct })}</div>
            </div>
          </section>
          <section className="detail-card">
            <div className="detail-card-head">
              <h2>{t('expenses')}</h2>
              <button type="button" className="detail-link" onClick={() => { setErr(''); setExpenseForm(emptyExpense({ currency: data.currency })) }}>{t('addPlus')}</button>
            </div>
            {(data.expenses || []).map((row) => (
              <div className="order-expense" key={row.id}>
                <span>
                  <div>{row.label}</div>
                  <div className="quiet">{[day(row.occurred_on), t(`pay_${row.payment_type || 'cash'}`), row.company_name].filter(Boolean).join(' · ')}</div>
                </span>
                <span className="sheet-mono">{money(row.amount_cents, row.currency || data.currency)}</span>
                <button type="button" className="detail-link" onClick={() => { setErr(''); setExpenseForm({ ...expenseToForm(row, data.currency), id: row.id }) }}>{t('edit')}</button>
                <button type="button" className="detail-link" onClick={() => act(() => api(`/api/orders/${id}/expenses/${row.id}`, { method: 'DELETE' }))}>{t('remove')}</button>
              </div>
            ))}
          </section>
          {(data.properties || []).length ? (
            <section className="detail-card">
              <div className="detail-card-head">
                <h2>{t('orderFields')}</h2>
                <button type="button" className="detail-link" onClick={() => act(() => api(`/api/orders/${id}`, { method: 'PATCH', body: { custom: draftCustom } }).then(() => setCustom(null)))}>{t('save')}</button>
              </div>
              <CustomFields defs={data.properties} values={draftCustom} onChange={setCustom} />
            </section>
          ) : null}
          <section className="detail-card">
            <h2>{t('type_invoice')}</h2>
            {data.invoice ? (
              <button type="button" className="detail-deal" onClick={() => open(data.invoice.id)}>
                <div className="detail-deal-copy">
                  <div className="order-invoice-no">{data.invoice.number}</div>
                  <div className="detail-deal-amount">{money(data.invoice.amount_cents, data.invoice.currency)}</div>
                </div>
                <Pill value={data.invoice.status} />
              </button>
            ) : (
              <div className="order-empty"><div>{t('noInvoiceYet')}</div></div>
            )}
          </section>
          <section className="detail-card">
            <div className="detail-card-head">
              <h2>{t('documents')}</h2>
              <div className="detail-count">{data.documents.length ? (data.documents.length === 1 ? t('uploadedOne') : fill(t('uploadedMany'), { n: data.documents.length })) : t('noneYet')}</div>
            </div>
            {data.documents.map((doc) => (
              <button type="button" className="order-doc" key={doc.id} onClick={() => downloadFile(`/api/documents/${doc.id}/file`, doc.filename)}>
                <span className="order-doc-kind">{t(`kind_${doc.kind}`) === `kind_${doc.kind}` ? doc.kind : t(`kind_${doc.kind}`)}</span>
                <span className="order-doc-name">{doc.filename}</span>
                <span className="order-doc-time">{docWhen(doc.created_at, t)}</span>
              </button>
            ))}
            <div className="order-drop">
              <div className="order-drop-copy">
                <div className="detail-seg docs">
                  {DOC_KINDS.map((kind) => (
                    <button type="button" key={kind} className={docKind === kind ? 'on' : ''} onClick={() => setDocKind(kind)}>{t(`kind_${kind}`)}</button>
                  ))}
                </div>
                <div className={`order-file ${file ? 'is-set' : ''}`}>{file ? file.name : t('noFileChosen')}</div>
              </div>
              <div className="dash-actions">
                <label className="order-choose">{t('chooseFile')}<input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
                <button type="button" className={`order-upload ${file ? 'is-ready' : ''}`} onClick={upload}>{t('upload')}</button>
              </div>
            </div>
          </section>
        </div>
        <div className="detail-side detail-sticky">
          <section className="detail-card">
            <h2>{t('companies')}</h2>
            {['customer', 'broker'].map((role) => (
              <PartyBlock
                key={role}
                role={role}
                party={data.parties?.[role]}
                t={t}
                onAdd={() => { setPartyRole(role); setPartyForm({ companyId: '', companyName: '', contactId: '', contactName: '' }); setErr('') }}
                onReplace={() => { setPartyRole(role); setPartyForm({ companyId: data.parties?.[role]?.company_id || '', companyName: data.parties?.[role]?.company?.name || '', contactId: data.parties?.[role]?.contact_id || '', contactName: data.parties?.[role]?.contact?.name || '' }); setErr('') }}
                onRemove={() => act(() => api(`/api/orders/${id}/parties/${role}`, { method: 'DELETE' }))}
              />
            ))}
          </section>
          <CarrierCard relations={data.relations} t={t} />
          <ActivityPanel
            items={data.activities}
            onAdd={async (body) => {
              await api('/api/activities', { method: 'POST', body: { ...body, objectType: 'order', objectId: id } })
              reload()
            }}
          />
        </div>
      </div>
      {expenseForm ? (
        <Modal title={expenseForm.id ? t('editExpense') : t('newExpense')} onClose={() => setExpenseForm(null)}>
          <form onSubmit={(event) => {
            event.preventDefault()
            act(async () => {
              const body = expenseBody(expenseForm, { includeOrder: false })
              if (expenseForm.id) await api(`/api/orders/${id}/expenses/${expenseForm.id}`, { method: 'PATCH', body })
              else await api(`/api/orders/${id}/expenses`, { method: 'POST', body })
              setExpenseForm(null)
            })
          }}>
            <ErrorNote>{err}</ErrorNote>
            <ExpenseFields form={expenseForm} setForm={setExpenseForm} t={t} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setExpenseForm(null)}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
      {partyRole ? (
        <Modal title={`${t('assign')} ${t(`st_${partyRole}`)}`} onClose={() => setPartyRole('')}>
          <form onSubmit={(event) => {
            event.preventDefault()
            act(async () => {
              await api(`/api/orders/${id}/parties/${partyRole}`, { method: 'PUT', body: { companyId: partyForm.companyId, contactId: partyForm.contactId || null } })
              setPartyRole('')
            })
          }}>
            <ErrorNote>{err}</ErrorNote>
            <PartyFields role={partyRole} form={partyForm} setForm={setPartyForm} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setPartyRole('')}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
      {editing && form ? (
        <Modal title={t('editOrder')} onClose={() => setEditing(false)}>
          <form onSubmit={save}>
            <ErrorNote>{err}</ErrorNote>
            <OrderFields form={form} setForm={setForm} addresses={addresses.data?.data} showStatus />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setEditing(false)}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

function OrderFields({ form, setForm, addresses = [], showStatus = false }) {
  const { t } = useI18n()
  return (
    <div className="form-grid">
      <Field label={t('customer')} wide>
        <Lookup
          kind="company"
          role="customer"
          value={form.companyId}
          label={form.companyName}
          onChange={(id, item) => setForm({ ...form, companyId: id, companyName: item?.title || '' })}
        />
      </Field>
      {showStatus ? (
        <Field label={t('status')}>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            {ORDER_STATUSES.map((status) => <option key={status} value={status}>{t(`st_${status}`)}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label={t('origin')}><input list="order-addresses" value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} required /></Field>
      <Field label={t('destination')}><input list="order-addresses" value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} required /></Field>
      <datalist id="order-addresses">{addresses.map((address) => <option key={address.id} value={address.label} />)}</datalist>
      <Field label="Cargo" wide><input value={form.cargo} onChange={(event) => setForm({ ...form, cargo: event.target.value })} /></Field>
      <Field label="Weight kg"><input value={form.weightKg} onChange={(event) => setForm({ ...form, weightKg: event.target.value })} /></Field>
      <Field label={t('loadType')}><select value={form.loadType} onChange={(event) => setForm({ ...form, loadType: event.target.value })}><option>FTL</option><option>LTL</option><option>parcel</option></select></Field>
      <Field label={t('price')}><input value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required /></Field>
      <Field label="Currency"><select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
      <Field label={t('pickup')}><input type="datetime-local" value={form.pickupAt} onChange={(event) => setForm({ ...form, pickupAt: event.target.value })} /></Field>
      <Field label={t('delivery')}><input type="datetime-local" value={form.deliveryAt} onChange={(event) => setForm({ ...form, deliveryAt: event.target.value })} /></Field>
      <Field label="Notes" wide><textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
    </div>
  )
}

function CarrierCard({ relations, t }) {
  const rows = relations || []
  return (
    <section className="detail-card">
      <div className="detail-card-head">
        <h2>{t('st_carrier')}</h2>
        <Link className="detail-link" to="/dispatch">{t('dispatch')}</Link>
      </div>
      {rows.length ? rows.map((relation) => (
        <div className="order-party" key={relation.id}>
          <div className="detail-card-head">
            <h3>{relation.kind === 'own_fleet' ? t('ownFleet') : t('subcontracted')}</h3>
            <Pill value={relation.status} />
          </div>
          {relation.kind === 'own_fleet' ? (
            <div>
              {relation.driver_id ? (
                <Link className="order-company" to="/fleet">{relation.driver_name || t('role_driver')}</Link>
              ) : (
                <div>{relation.driver_name || t('ownFleet')}</div>
              )}
              <div className="quiet">{[relation.plate, relation.vehicle_kind].filter(Boolean).join(' · ') || '—'}</div>
              {relation.driver_phone ? <div className="quiet">{relation.driver_phone}</div> : null}
              <div className="quiet">{relation.cost_cents ? money(relation.cost_cents, relation.currency) : t('noCarrierCost')}</div>
            </div>
          ) : (
            <div>
              {relation.carrier_company_id ? (
                <Link className="order-company" to={`/companies/${relation.carrier_company_id}`}>{relation.carrier_name || t('subcontracted')}</Link>
              ) : (
                <div>{relation.carrier_name || t('subcontracted')}</div>
              )}
              <div className="quiet">{relation.cost_cents ? money(relation.cost_cents, relation.currency) : t('noCarrierCost')}</div>
            </div>
          )}
        </div>
      )) : (
        <div className="order-empty">
          <div>{t('notAssigned')}</div>
          <Link className="order-assign" to="/dispatch">{t('assignDispatch')}</Link>
        </div>
      )}
    </section>
  )
}

function PartyBlock({ role, party, t, onAdd, onReplace, onRemove }) {
  return (
    <div className="order-party">
      <div className="detail-card-head">
        <h3>{t(`st_${role}`)}</h3>
        {party ? (
          <div className="dash-actions">
            <button type="button" className="detail-link" onClick={onReplace}>{t('replace')}</button>
            <button type="button" className="detail-link" onClick={onRemove}>{t('remove')}</button>
          </div>
        ) : (
          <button type="button" className="detail-link" onClick={onAdd}>{t('addPlus')}</button>
        )}
      </div>
      {party ? (
        <div>
          {party.company?.id ? <Link className="order-company" to={`/companies/${party.company.id}`}>{party.company.name}</Link> : <div>{party.company?.name}</div>}
          <div className="quiet">{party.contact?.name || t('noContactSelected')}</div>
          {party.contact?.email ? <div className="quiet">{party.contact.email}</div> : null}
        </div>
      ) : <div className="order-empty">{t('noneYet')}</div>}
    </div>
  )
}

function PartyFields({ role, form, setForm }) {
  const { t } = useI18n()
  return (
    <div className="form-grid">
      <Field label={t('type_company')} wide>
        <Lookup
          kind="company"
          role={role === 'broker' ? 'broker' : 'customer'}
          value={form.companyId}
          label={form.companyName}
          required
          onChange={(id, item) => setForm({ companyId: id, companyName: item?.title || '', contactId: '', contactName: '' })}
        />
      </Field>
      <Field label={t('contacts')} wide>
        <Lookup
          kind="contact"
          companyId={form.companyId}
          needsCompany
          value={form.contactId}
          label={form.contactName}
          disabled={!form.companyId}
          onChange={(id, item) => setForm({ ...form, contactId: id, contactName: item?.title || '' })}
        />
      </Field>
    </div>
  )
}

function CustomFields({ defs, values, onChange }) {
  function set(key, value) {
    onChange({ ...values, [key]: value })
  }
  return (
    <div className="form-grid">
      {defs.map((def) => {
        const value = values[def.key]
        const options = def.options || []
        if (def.type === 'text') return <Field key={def.id} label={def.name} wide><input value={value || ''} onChange={(event) => set(def.key, event.target.value)} /></Field>
        if (def.type === 'number') return <Field key={def.id} label={def.name}><input type="number" value={value ?? ''} onChange={(event) => set(def.key, event.target.value)} /></Field>
        if (def.type === 'select') {
          return (
            <Field key={def.id} label={def.name}>
              <select value={value || ''} onChange={(event) => set(def.key, event.target.value)}>
                <option value="">—</option>
                {options.map((option) => <option key={option}>{option}</option>)}
              </select>
            </Field>
          )
        }
        if (def.type === 'radio') {
          return (
            <Field key={def.id} label={def.name} wide>
              <div className="prop-options">
                {options.map((option) => (
                  <label key={option}><input type="radio" name={def.key} checked={value === option} onChange={() => set(def.key, option)} /> {option}</label>
                ))}
              </div>
            </Field>
          )
        }
        const selected = Array.isArray(value) ? value : []
        return (
          <Field key={def.id} label={def.name} wide>
            <div className="prop-options">
              {options.map((option) => (
                <label key={option}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(event) => set(def.key, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))}
                  /> {option}
                </label>
              ))}
            </div>
          </Field>
        )
      })}
    </div>
  )
}

function Fact({ label, value, empty }) {
  return (
    <div className="order-fact">
      <div className="order-kicker">{label}</div>
      <div className={value ? '' : 'unset'}>{value || empty}</div>
    </div>
  )
}

function docWhen(value, t) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (Date.now() - date.getTime() < 60_000) return t('justNow')
  return when(value)
}

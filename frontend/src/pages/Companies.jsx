import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, useFetch } from '../api.js'
import { ActivityPanel, OrdersBlock, PeopleBlock, RecordStats } from '../components/RecordDetail.jsx'
import { SmsCard } from '../components/SmsThread.jsx'
import { ListCard, Sheet, fill, initialsFrom, markColor, markFromName, matchesRole } from '../components/RecordList.jsx'
import { Button, ErrorNote, Field, Modal, Pill } from '../components/ui.jsx'
import { ContactFields } from './Contacts.jsx'
import { useI18n } from '../i18n.jsx'

const empty = { name: '', role: 'customer', email: '', phone: '', vat: '', vatEu: '', city: '', country: '', paymentTermsDays: 14, notes: '', qboCustomerId: '' }

export default function Companies() {
  const { id } = useParams()
  return id ? <CompanyDetail id={id} /> : <CompanyList />
}

function CompanyList() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, loading, error } = useFetch('/api/companies')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState('')
  const companies = (data?.data || []).map((row, index) => ({ ...row, _i: index }))
  const q = query.trim().toLowerCase()
    const rows = companies.filter((row) => matchesRole(row.role, tab) && (!q || `${row.name} ${row.city || ''} ${row.vat || ''} ${row.vat_eu || ''}`.toLowerCase().includes(q)))
  const tabs = [
    { id: 'all', label: t('all') },
    { id: 'customer', label: t('customers') },
    { id: 'carrier', label: t('carriers') },
    { id: 'broker', label: t('brokers') },
  ].map((item) => ({ ...item, count: companies.filter((row) => matchesRole(row.role, item.id)).length }))

  async function create(event) {
    event.preventDefault()
    try {
      const row = await api('/api/companies', { method: 'POST', body: form })
      setOpen(false)
      navigate(`/companies/${row.id}`)
    } catch (error) { setErr(error.message) }
  }

  return (
    <Sheet
      title={t('companies')}
      lede={t('companiesLede')}
      actions={<button type="button" className="dash-btn primary" onClick={() => { setForm(empty); setOpen(true) }}>{t('newCompany')}</button>}
    >
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterNameCity')}
        columns="minmax(0,2fr) 110px minmax(0,1fr) 140px 140px 110px 70px"
        minWidth={920}
        heads={[
          { key: 'name', label: t('name') },
          { key: 'role', label: t('role') },
          { key: 'city', label: t('city') },
          { key: 'vat', label: t('vatId') },
          { key: 'vatEu', label: t('vatEu') },
          { key: 'terms', label: t('paymentTerms') },
          { key: 'orders', label: t('orders'), align: 'right' },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        onRow={(row) => navigate(`/companies/${row.id}`)}
        rowMuted={(row) => row.blacklisted}
        loading={loading}
        error={error}
        empty={q ? fill(t('noCompanies'), { query: query.trim() }) : t('emptyView')}
        renderRow={(row) => (
          <>
            <div className="sheet-id">
              <span className="sheet-avatar" style={{ background: markColor(row._i) }}>{initialsFrom(row.name)}</span>
              <span className="sheet-name">{row.name}</span>
              {row.warning ? <span className="sheet-flag watch">{t('watch')}</span> : null}
              {row.blacklisted ? <span className="sheet-flag blacklisted">{t('blacklisted')}</span> : null}
            </div>
            <Pill value={row.role} />
            <div className="sheet-city"><span>{row.city || '—'}</span>{row.country ? <span className="sheet-country">{row.country}</span> : null}</div>
            <div className="sheet-mono">{row.vat || '—'}</div>
            <div className="sheet-mono">{row.vat_eu || '—'}</div>
            <div className="sheet-mono">{fill(t('netDays'), { n: row.payment_terms_days })}</div>
            <div className={`sheet-mono sheet-right ${row.order_count ? '' : 'is-faint'}`}>{row.order_count}</div>
          </>
        )}
      />
      {open ? (
        <Modal title="New company" onClose={() => setOpen(false)}>
          <form onSubmit={create}>
            <ErrorNote>{err}</ErrorNote>
            <CompanyFields form={form} setForm={setForm} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </Sheet>
  )
}

function companyForm(data) {
  return {
    name: data?.name || '',
    role: data?.role || 'customer',
    email: data?.email || '',
    phone: data?.phone || '',
    vat: data?.vat || '',
    vatEu: data?.vat_eu || '',
    city: data?.city || '',
    country: data?.country || '',
    paymentTermsDays: data?.payment_terms_days ?? 14,
    notes: data?.notes || '',
    qboCustomerId: data?.qbo_customer_id || '',
  }
}

const blankContact = { name: '', email: '', phone: '', mobile: '', fax: '', title: '' }

function CompanyDetail({ id }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useFetch(`/api/companies/${id}`)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(empty)
  const [contactOpen, setContactOpen] = useState(false)
  const [contact, setContact] = useState(blankContact)
  const [err, setErr] = useState('')

  if (!data && loading) return <div className="detail"><p className="quiet">{t('loading')}</p></div>
  if (!data && error) return <div className="detail"><div className="error">{error}</div></div>
  if (!data) return null

  const place = [data.city, data.country].filter(Boolean).join(', ')

  async function saveCompany(event) {
    event.preventDefault()
    try {
      await api(`/api/companies/${id}`, { method: 'PATCH', body: form })
      setEditing(false)
      reload()
    } catch (error) { setErr(error.message) }
  }

  async function saveContact(event) {
    event.preventDefault()
    try {
      await api('/api/contacts', { method: 'POST', body: { ...contact, companyId: id } })
      setContactOpen(false)
      reload()
    } catch (error) { setErr(error.message) }
  }

  return (
    <div className="detail">
      <nav className="detail-crumb">
        <Link to="/companies">{t('companies')}</Link>
        <span className="detail-sep">/</span>
        <span>{data.name}</span>
      </nav>
      <div className="detail-head">
        <div className="detail-who">
          <div className="detail-mark" style={{ background: markFromName(data.name) }}>{initialsFrom(data.name)}</div>
          <div className="detail-id">
            <div className="detail-title">
              <h1>{data.name}</h1>
              <Pill value={data.role} />
              {data.warning ? <span className="sheet-flag watch">{t('watch')}</span> : null}
              {data.blacklisted ? <span className="sheet-flag blacklisted">{t('blacklisted')}</span> : null}
            </div>
            <div className="detail-meta">
              {place ? <span>{place}</span> : null}
              {data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : null}
              {data.phone ? <span>{data.phone}</span> : null}
              {data.vat ? <span>{t('vatId')} {data.vat}</span> : null}
              {data.vat_eu ? <span>{t('vatEu')} {data.vat_eu}</span> : null}
            </div>
          </div>
        </div>
        <div className="dash-actions">
          <button type="button" className="dash-btn" onClick={() => { setForm(companyForm(data)); setErr(''); setEditing(true) }}>{t('edit')}</button>
          <button type="button" className="dash-btn primary" onClick={() => navigate('/orders', { state: { create: true, companyId: id, companyName: data.name } })}>{t('newOrder')}</button>
        </div>
      </div>
      <RecordStats orders={data.orders} terms={data.payment_terms_days} />
      <div className="detail-cols">
        <div className="detail-main">
          <CompanySms id={id} />
          <OrdersBlock orders={data.orders} />
        </div>
        <div className="detail-side">
          <PeopleBlock
            title={t('contacts')}
            empty={t('noContactsYet')}
            action={<button type="button" className="detail-link" onClick={() => { setContact(blankContact); setErr(''); setContactOpen(true) }}>{t('addPlus')}</button>}
            people={data.contacts.map((row) => ({ id: row.id, name: row.name, role: row.title, email: row.email, href: `/contacts/${row.id}` }))}
          />
          <ActivityPanel
            items={data.activities}
            onAdd={async (body) => { await api('/api/activities', { method: 'POST', body: { ...body, objectType: 'company', objectId: id } }); reload() }}
          />
        </div>
      </div>
      {editing ? (
        <Modal title={t('editCompany')} onClose={() => setEditing(false)}>
          <form onSubmit={saveCompany}>
            <ErrorNote>{err}</ErrorNote>
            <CompanyFields form={form} setForm={setForm} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setEditing(false)}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
      {contactOpen ? (
        <Modal title={t('newContact')} onClose={() => setContactOpen(false)}>
          <form onSubmit={saveContact}>
            <ErrorNote>{err}</ErrorNote>
            <ContactFields form={contact} setForm={setContact} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setContactOpen(false)}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

function CompanySms({ id }) {
  const { t } = useI18n()
  const sms = useFetch(`/api/sms/companies/${id}`)
  useEffect(() => {
    const timer = setInterval(() => sms.reload(), 15000)
    return () => clearInterval(timer)
  }, [sms.reload])
  if (!sms.data?.connected || !sms.data.conversations?.length) return null
  return (
    <div className="sms-stack">
      {sms.data.conversations.map((row) => (
        <SmsCard
          key={row.contactId}
          title={row.name}
          href={`/contacts/${row.contactId}`}
          phone={row.phone}
          messages={row.messages}
          contactId={row.contactId}
          onSent={sms.reload}
          empty={t('startConversation')}
        />
      ))}
    </div>
  )
}

function CompanyFields({ form, setForm }) {
  const { t } = useI18n()
  return (
    <div className="form-grid">
      <Field label={t('name')} wide><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
      <Field label={t('role')}><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="customer">{t('st_customer')}</option><option value="carrier">{t('st_carrier')}</option><option value="broker">{t('st_broker')}</option><option value="both">{t('st_both')}</option></select></Field>
      <Field label={t('city')}><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
      <Field label={t('country')}><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
      <Field label={t('email')}><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label={t('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label={t('vatId')}><input value={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.value })} /></Field>
      <Field label={t('vatEu')}><input value={form.vatEu} onChange={(e) => setForm({ ...form, vatEu: e.target.value })} /></Field>
      <Field label={t('paymentTerms')}><input type="number" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })} /></Field>
      <Field label="QuickBooks customer id"><input value={form.qboCustomerId} onChange={(e) => setForm({ ...form, qboCustomerId: e.target.value })} /></Field>
      <Field label="Notes" wide><textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, useFetch } from '../api.js'
import { ActivityPanel, OrdersBlock, PeopleBlock, RecordStats } from '../components/RecordDetail.jsx'
import { SmsCard } from '../components/SmsThread.jsx'
import { ListCard, Sheet, fill, initialsFrom, markColor, markFromName, matchesRole } from '../components/RecordList.jsx'
import { Lookup } from '../components/Lookup.jsx'
import { Button, ErrorNote, Field, Modal, Pill } from '../components/ui.jsx'
import { useI18n } from '../i18n.jsx'

const emptyContact = { name: '', email: '', phone: '', mobile: '', fax: '', title: '', companyId: '', companyName: '' }

export function ContactFields({ form, setForm, showCompany = false }) {
  const { t } = useI18n()
  return (
    <div className="form-grid">
      <Field label={t('name')} wide><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
      {showCompany ? (
        <Field label={t('type_company')} wide>
          <Lookup
            kind="company"
            value={form.companyId}
            label={form.companyName}
            onChange={(id, item) => setForm({ ...form, companyId: id, companyName: item?.title || '' })}
          />
        </Field>
      ) : null}
      <Field label={t('titleCol')}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label={t('email')}><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label={t('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label={t('mobile')}><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
      <Field label={t('fax')}><input value={form.fax} onChange={(e) => setForm({ ...form, fax: e.target.value })} /></Field>
    </div>
  )
}

export default function Contacts() {
  const { id } = useParams()
  return id ? <ContactDetail id={id} /> : <ContactList />
}

function ContactList() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useFetch('/api/contacts')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyContact)
  const [err, setErr] = useState('')
  const contacts = (data?.data || []).map((row, index) => ({ ...row, _i: index }))
  const q = query.trim().toLowerCase()
  const rows = contacts.filter((row) => matchesRole(row.company_role, tab) && (!q || `${row.name} ${row.company_name || ''} ${row.email || ''} ${row.phone || ''} ${row.mobile || ''}`.toLowerCase().includes(q)))
  const tabs = [
    { id: 'all', label: t('all') },
    { id: 'customer', label: t('customers') },
    { id: 'carrier', label: t('carriers') },
    { id: 'broker', label: t('brokers') },
  ].map((item) => ({ ...item, count: contacts.filter((row) => matchesRole(row.company_role, item.id)).length }))

  async function create(event) {
    event.preventDefault()
    try {
      await api('/api/contacts', { method: 'POST', body: { ...form, companyId: form.companyId || null } })
      setOpen(false)
      setForm(emptyContact)
      reload()
    } catch (error) { setErr(error.message) }
  }

  return (
    <Sheet
      title={t('contacts')}
      lede={t('contactsLede')}
      actions={<button type="button" className="dash-btn primary" onClick={() => setOpen(true)}>{t('newContact')}</button>}
    >
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterNameCompany')}
        columns="minmax(0,1.3fr) minmax(0,1.2fr) minmax(0,0.8fr) minmax(0,1.2fr) 130px 130px 120px"
        minWidth={980}
        heads={[
          { key: 'name', label: t('name') },
          { key: 'company', label: t('type_company') },
          { key: 'title', label: t('titleCol') },
          { key: 'email', label: t('email') },
          { key: 'phone', label: t('phone') },
          { key: 'mobile', label: t('mobile') },
          { key: 'fax', label: t('fax') },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        onRow={(row) => navigate(`/contacts/${row.id}`)}
        loading={loading}
        error={error}
        empty={q ? fill(t('noContacts'), { query: query.trim() }) : t('emptyView')}
        renderRow={(row) => (
          <>
            <div className="sheet-id">
              <span className="sheet-avatar" style={{ background: markColor(row._i) }}>{initialsFrom(row.name)}</span>
              <span className="sheet-name">{row.name}</span>
            </div>
            <div className="sheet-id">
              <span className="sheet-ellipsis">{row.company_name || '—'}</span>
              {row.company_role ? <Pill value={row.company_role} /> : null}
            </div>
            <div className="sheet-ellipsis">{row.title || '—'}</div>
            <div className="sheet-ellipsis">{row.email || '—'}</div>
            <div className="sheet-mono">{row.phone || '—'}</div>
            <div className="sheet-mono">{row.mobile || '—'}</div>
            <div className="sheet-mono">{row.fax || '—'}</div>
          </>
        )}
      />
      {open ? (
        <Modal title="New contact" onClose={() => setOpen(false)}>
          <form onSubmit={create}>
            <ErrorNote>{err}</ErrorNote>
            <ContactFields form={form} setForm={setForm} showCompany />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </Sheet>
  )
}

function ContactSms({ id }) {
  const { t } = useI18n()
  const thread = useFetch(`/api/sms/thread?contact=${id}`)
  useEffect(() => {
    const timer = setInterval(() => thread.reload(), 15000)
    return () => clearInterval(timer)
  }, [thread.reload])
  if (!thread.data?.connected) return null
  return (
    <SmsCard
      title={t('messages')}
      phone={thread.data.contact?.phone}
      messages={thread.data.messages}
      contactId={id}
      onSent={thread.reload}
      empty={t('startConversation')}
    />
  )
}

function ContactDetail({ id }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useFetch(`/api/contacts/${id}`)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(emptyContact)
  const [err, setErr] = useState('')

  if (!data && loading) return <div className="detail"><p className="quiet">{t('loading')}</p></div>
  if (!data && error) return <div className="detail"><div className="error">{error}</div></div>
  if (!data) return null

  const place = [data.title, data.company_name].filter(Boolean).join(' · ')

  async function saveContact(event) {
    event.preventDefault()
    try {
      await api(`/api/contacts/${id}`, { method: 'PATCH', body: { ...form, companyId: form.companyId || null } })
      setEditing(false)
      reload()
    } catch (error) { setErr(error.message) }
  }

  return (
    <div className="detail">
      <nav className="detail-crumb">
        <Link to="/contacts">{t('contacts')}</Link>
        <span className="detail-sep">/</span>
        <span>{data.name}</span>
      </nav>
      <div className="detail-head">
        <div className="detail-who">
          <div className="detail-mark round" style={{ background: markFromName(data.name) }}>{initialsFrom(data.name)}</div>
          <div className="detail-id">
            <div className="detail-title">
              <h1>{data.name}</h1>
              {data.company_role ? <Pill value={data.company_role} /> : null}
            </div>
            <div className="detail-meta">
              {place ? <span>{place}</span> : null}
              {data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : null}
              {data.phone ? <span>{t('phone')} {data.phone}</span> : null}
              {data.mobile ? <span>{t('mobile')} {data.mobile}</span> : null}
              {data.fax ? <span>{t('fax')} {data.fax}</span> : null}
            </div>
          </div>
        </div>
        <div className="dash-actions">
          <button type="button" className="dash-btn" onClick={() => { setForm({ name: data.name || '', email: data.email || '', phone: data.phone || '', mobile: data.mobile || '', fax: data.fax || '', title: data.title || '', companyId: data.company_id || '', companyName: data.company_name || '' }); setErr(''); setEditing(true) }}>{t('edit')}</button>
          <button type="button" className="dash-btn primary" onClick={() => navigate('/orders', { state: { create: true, companyId: data.company_id || '', companyName: data.company_name || '' } })}>{t('newOrder')}</button>
        </div>
      </div>
      <RecordStats orders={data.orders} terms={data.payment_terms_days} />
      <div className="detail-cols">
        <div className="detail-main">
          <ContactSms id={id} />
          <OrdersBlock orders={data.orders} />
        </div>
        <div className="detail-side">
          <PeopleBlock
            title={t('type_company')}
            empty={t('noCompanyYet')}
            people={data.company_id ? [{
              id: data.company_id,
              name: data.company_name,
              role: [data.city, data.country].filter(Boolean).join(', '),
              email: data.company_email,
              href: `/companies/${data.company_id}`,
              square: true,
            }] : []}
          />
          <ActivityPanel
            items={data.activities}
            onAdd={async (body) => { await api('/api/activities', { method: 'POST', body: { ...body, objectType: 'contact', objectId: id } }); reload() }}
          />
        </div>
      </div>
      {editing ? (
        <Modal title={t('editContact')} onClose={() => setEditing(false)}>
          <form onSubmit={saveContact}>
            <ErrorNote>{err}</ErrorNote>
            <ContactFields form={form} setForm={setForm} showCompany />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setEditing(false)}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

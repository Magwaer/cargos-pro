import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, getToken, setToken, useFetch } from '../api.js'
import { useAuth } from '../App.jsx'
import { Button, ErrorNote, Field, Modal, PageHead, Pill } from '../components/ui.jsx'
import { money, when } from '../format.js'
import { useI18n } from '../i18n.jsx'

export default function Settings() {
  const { t } = useI18n()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [tab, setTab] = useState(params.get('billing') ? 'billing' : 'team')
  const tabs = [['team', t('team')], ['account', t('account')], ['fields', t('orderFields')], ['billing', t('billing')], ['api', t('apiKeys')], ['integrations', t('integrations')], ['audit', t('audit')]]
  return (
    <div>
      <PageHead title={t('settings')} lede="Seats, subscriptions, keys, and the connections this workspace actually has." />
      {params.get('billing') === 'success' ? <div className="banner ok">Checkout returned. The plan updates when Stripe sends the webhook.</div> : null}
      {params.get('integration') ? <div className="banner ok">{params.get('integration')} connection updated.</div> : null}
      <div className="tabs">
        {tabs.map(([id, label]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'team' ? <Team /> : null}
      {tab === 'account' ? <Account /> : null}
      {tab === 'fields' ? <OrderFieldsTab /> : null}
      {tab === 'billing' ? <Billing /> : null}
      {tab === 'api' ? <Keys /> : null}
      {tab === 'integrations' ? <Integrations /> : null}
      {tab === 'audit' ? <Audit /> : null}
    </div>
  )
}

const ROLES = ['owner', 'dispatcher', 'sales', 'finance', 'driver']

function Team() {
  const { t } = useI18n()
  const { me, setMe } = useAuth()
  const { data, reload, error } = useFetch('/api/users')
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'dispatcher' })
  const [err, setErr] = useState('')
  const [listErr, setListErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [edit, setEdit] = useState({ email: '', role: 'dispatcher', password: '' })
  const [editErr, setEditErr] = useState('')
  async function invite(event) {
    event.preventDefault()
    setErr('')
    try { await api('/api/users', { method: 'POST', body: form }); setForm({ name: '', email: '', password: '', role: 'dispatcher' }); reload() }
    catch (error) { setErr(error.message) }
  }
  function openEdit(user) {
    setEditErr('')
    setEdit({ email: user.email, role: user.role, password: '' })
    setEditing(user)
  }
  async function saveEdit(event) {
    event.preventDefault()
    setEditErr('')
    try {
      const body = { email: edit.email, role: edit.role }
      if (edit.password) body.password = edit.password
      const row = await api(`/api/users/${editing.id}`, { method: 'PATCH', body })
      if (row.token) {
        setToken(row.token)
        setMe(await api('/api/auth/me'))
      }
      setEditing(null)
      reload()
    } catch (error) { setEditErr(error.message) }
  }
  return (
    <div className="split">
      <div className="card">
        <ErrorNote>{error || listErr}</ErrorNote>
        <table>
          <thead><tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('role')}</th><th>{t('status')}</th><th></th></tr></thead>
          <tbody>
            {data?.data?.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.name}</strong></td>
                <td>{user.email}</td>
                <td>{t(`role_${user.role}`)}</td>
                <td><Pill value={user.active ? 'active' : 'inactive'} /></td>
                <td className="right row-actions">
                  <Button kind="ghost" className="small" type="button" onClick={() => openEdit(user)}>{t('edit')}</Button>
                  {user.active ? <Button kind="ghost" className="small" type="button" onClick={() => api(`/api/users/${user.id}`, { method: 'PATCH', body: { active: false } }).then(reload).catch((error) => setListErr(error.message))}>{t('deactivate')}</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="card stack" onSubmit={invite}>
        <h2>Add a seat</h2>
        <ErrorNote>{err}</ErrorNote>
        <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label="Password"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength="8" /></Field>
        <Field label={t('role')}><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((role) => <option key={role} value={role}>{t(`role_${role}`)}</option>)}</select></Field>
        <Button type="submit">{t('save')}</Button>
      </form>
      {editing ? (
        <Modal title={t('editUser')} onClose={() => setEditing(null)}>
          <form onSubmit={saveEdit}>
            <ErrorNote>{editErr}</ErrorNote>
            <p className="quiet">{editing.name}{editing.id === me?.id ? ` · ${t('you')}` : ''}</p>
            <div className="form-grid">
              <Field label={t('email')} wide><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} required autoComplete="off" /></Field>
              <Field label={t('role')} wide><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{ROLES.map((role) => <option key={role} value={role}>{t(`role_${role}`)}</option>)}</select></Field>
              <Field label={t('password')} wide><input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" minLength={edit.password ? 8 : undefined} /></Field>
            </div>
            <p className="quiet">{t('passwordHint')}</p>
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setEditing(null)}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

function Account() {
  const { t } = useI18n()
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    api('/api/account').then(setForm).catch((error) => setErr(error.message))
  }, [])
  function set(key) {
    return (event) => {
      setSaved(false)
      setForm((current) => ({ ...current, [key]: event.target.value }))
    }
  }
  async function save(event) {
    event.preventDefault()
    setErr('')
    setSaved(false)
    try {
      setForm(await api('/api/account', { method: 'PATCH', body: form }))
      setSaved(true)
    } catch (error) {
      setErr(error.message)
    }
  }
  if (!form) return <p className="quiet">{err || t('loading')}</p>
  return (
    <form className="card stack" onSubmit={save}>
      <h2>{t('account')}</h2>
      <p className="quiet">{t('accountLede')}</p>
      <p className="quiet">{t('workspaceName')}: {form.name}. {t('legalNameHint')}</p>
      {saved ? <div className="banner ok">{t('saved')}</div> : null}
      <div className="form-grid">
        <Field label={t('legalName')}>
          <input value={form.legalName} onChange={set('legalName')} placeholder={form.name} />
        </Field>
        <Field label={t('vat')}>
          <input value={form.vat} onChange={set('vat')} />
        </Field>
        <Field label={t('address')}>
          <input value={form.address} onChange={set('address')} />
        </Field>
        <Field label={t('city')}>
          <input value={form.city} onChange={set('city')} />
        </Field>
        <Field label={t('country')}>
          <input value={form.country} onChange={set('country')} />
        </Field>
        <Field label={t('email')}>
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label={t('phone')}>
          <input value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label={t('bank')}>
          <input value={form.bankName} onChange={set('bankName')} />
        </Field>
        <Field label={t('iban')}>
          <input value={form.iban} onChange={set('iban')} spellCheck="false" />
        </Field>
        <Field label={t('swift')}>
          <input value={form.swift} onChange={set('swift')} spellCheck="false" />
        </Field>
      </div>
      <Field label={t('invoiceNote')}>
        <textarea rows={3} value={form.invoiceFooter} onChange={set('invoiceFooter')} />
      </Field>
      <ErrorNote>{err}</ErrorNote>
      <Button>{t('save')}</Button>
    </form>
  )
}

function Billing() {
  const { data, error } = useFetch('/api/billing')
  const [interval, setInterval] = useState('month')
  const [seats, setSeats] = useState(3)
  const [drivers, setDrivers] = useState(2)
  const [err, setErr] = useState('')
  if (error) return <div className="error">{error}</div>
  if (!data) return <p>Loading…</p>
  const seat = interval === 'year' ? data.prices.seatAnnual : data.prices.seatMonthly
  const driver = interval === 'year' ? data.prices.driverAnnual : data.prices.driverMonthly
  async function checkout() {
    setErr('')
    try {
      const result = await api('/api/billing/checkout', { method: 'POST', body: { interval, seats: Number(seats), drivers: Number(drivers) } })
      location.href = result.url
    } catch (error) { setErr(error.message) }
  }
  return (
    <div className="split">
      <div className="card">
        <h2>This workspace</h2>
        <p style={{ marginTop: 8 }}>Plan: {data.plan}</p>
        <p className="quiet">Seats {data.seatsUsed}/{data.seatLimit} · drivers {data.driversUsed}/{data.driverLimit}</p>
        {data.trialEndsAt ? <p className="quiet">Trial ends {String(data.trialEndsAt).slice(0, 10)}</p> : null}
      </div>
      <div className="card stack">
        <h2>Subscribe</h2>
        <p className="quiet">Seat {money(interval === 'year' ? 3500 : 4000, 'USD')} per month{interval === 'year' ? ', billed yearly' : ''}. Driver {money(interval === 'year' ? 700 : 1000, 'USD')} per month.</p>
        <div className="seg">
          <button className={interval === 'month' ? 'on' : ''} type="button" onClick={() => setInterval('month')}>Monthly</button>
          <button className={interval === 'year' ? 'on' : ''} type="button" onClick={() => setInterval('year')}>Annual</button>
        </div>
        <Field label="Seats"><input type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        <Field label="Drivers"><input type="number" min="0" value={drivers} onChange={(e) => setDrivers(e.target.value)} /></Field>
        <strong>{money(seat * Number(seats) + driver * Number(drivers), 'USD')} / {interval}</strong>
        <ErrorNote>{err}</ErrorNote>
        <Button onClick={checkout} disabled={!data.stripeConfigured}>{data.stripeConfigured ? 'Continue to Stripe' : 'Stripe is not configured'}</Button>
      </div>
    </div>
  )
}

function Keys() {
  const { data, reload } = useFetch('/api/api-keys')
  const [name, setName] = useState('ERP')
  const [scope, setScope] = useState('read')
  const [token, setToken] = useState('')
  async function create(event) {
    event.preventDefault()
    const row = await api('/api/api-keys', { method: 'POST', body: { name, scope } })
    setToken(row.token)
    reload()
  }
  return (
    <div className="split">
      <div className="card">
        <table>
          <tbody>
            {data?.data?.map((key) => (
              <tr key={key.id}>
                <td><strong>{key.name}</strong><br /><span className="quiet">{key.prefix}… · {key.scope}</span></td>
                <td className="right">{key.revoked_at ? 'Revoked' : <Button kind="ghost" className="small" onClick={() => api(`/api/api-keys/${key.id}/revoke`, { method: 'POST', body: {} }).then(reload)}>Revoke</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {token ? <div className="banner ok" style={{ marginTop: 12 }}>Copy this key now. It will not be shown again.<br />{token}</div> : null}
      </div>
      <form className="card stack" onSubmit={create}>
        <h2>New key</h2>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Scope"><select value={scope} onChange={(e) => setScope(e.target.value)}><option value="read">Read</option><option value="write">Read and write</option></select></Field>
        <Button>Create</Button>
      </form>
    </div>
  )
}

function Integrations() {
  const { data, error, reload } = useFetch('/api/integrations')
  const [err, setErr] = useState('')
  const items = data?.data || []
  const twilio = items.find((item) => item.provider === 'twilio')
  const rest = items.filter((item) => item.provider !== 'twilio')
  async function connect(provider) {
    setErr('')
    try {
      if (provider === 'google' || provider === 'quickbooks') {
        const result = await api(`/api/integrations/${provider}/start`, { method: 'POST', body: {} })
        location.href = result.url
      }
    } catch (error) { setErr(error.message) }
  }
  return (
    <div className="stack">
      <ErrorNote>{error || err}</ErrorNote>
      {twilio ? <TwilioCard item={twilio} onChange={reload} /> : null}
      {rest.map((item) => (
        <div className="card" key={item.provider}>
          <div className="check">
            <strong className="grow">{item.label}</strong>
            <Pill value={item.status} />
          </div>
          <p className="quiet" style={{ marginTop: 6 }}>{item.purpose}</p>
          <div className="row-actions" style={{ marginTop: 10 }}>
            {item.provider === 'google' || item.provider === 'quickbooks' ? <Button kind="soft" className="small" onClick={() => connect(item.provider)}>Connect</Button> : null}
            {item.status === 'connected' ? <Button kind="ghost" className="small" onClick={() => api(`/api/integrations/${item.provider}`, { method: 'DELETE' }).then(reload)}>Disconnect</Button> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function TwilioCard({ item, onChange }) {
  const log = useFetch(item.status === 'connected' ? '/api/integrations/twilio' : null)
  const [form, setForm] = useState(twilioForm(item))
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [audio, setAudio] = useState(null)
  const [audioErr, setAudioErr] = useState('')

  useEffect(() => { setForm(twilioForm(item)) }, [item.accountSid, item.fromNumber, item.voiceNumber, item.tokenSet])
  useEffect(() => () => { if (audio?.url) URL.revokeObjectURL(audio.url) }, [audio])

  async function save(event) {
    event.preventDefault()
    setErr('')
    setNotice('')
    setSaving(true)
    try {
      const row = await api('/api/integrations/twilio', { method: 'POST', body: form })
      setNotice(row.webhookSet
        ? 'Connected. Inbound SMS on this number now come into Cargos.'
        : 'Connected. Paste the webhook into the number’s messaging settings in Twilio so inbound SMS arrive here.')
      setForm((current) => ({ ...current, authToken: '' }))
      onChange()
      log.reload()
      window.dispatchEvent(new CustomEvent('cargos-twilio', { detail: { connected: true } }))
    } catch (error) { setErr(error.message) }
    finally { setSaving(false) }
  }

  async function disconnect() {
    setErr('')
    await api('/api/integrations/twilio', { method: 'DELETE' })
    setNotice('')
    onChange()
    window.dispatchEvent(new CustomEvent('cargos-twilio', { detail: { connected: false } }))
  }

  async function play(sid) {
    setAudioErr('')
    const res = await fetch(`/api/integrations/twilio/recordings/${sid}`, { headers: { Authorization: `Bearer ${getToken()}` } })
    if (!res.ok) { setAudioErr('Recording is not available.'); return }
    if (audio?.url) URL.revokeObjectURL(audio.url)
    setAudio({ sid, url: URL.createObjectURL(await res.blob()) })
  }

  return (
    <form className="card stack" onSubmit={save}>
      <div className="check">
        <strong className="grow">{item.label}</strong>
        <Pill value={item.status} />
      </div>
      <p className="quiet">{item.purpose}</p>
      <ErrorNote>{err}</ErrorNote>
      {notice ? <div className="banner ok">{notice}</div> : null}
      <div className="form-grid">
        <Field label="Account SID" wide><input value={form.accountSid} onChange={(e) => setForm({ ...form, accountSid: e.target.value })} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off" required /></Field>
        <Field label="Auth token" wide>
          <input type="password" value={form.authToken} onChange={(e) => setForm({ ...form, authToken: e.target.value })} placeholder={item.tokenSet ? `Saved ${item.tokenHint}. Leave blank to keep it.` : 'From the Twilio console'} autoComplete="new-password" required={!item.tokenSet} />
        </Field>
        <Field label="SMS number"><input value={form.fromNumber} onChange={(e) => setForm({ ...form, fromNumber: e.target.value })} placeholder="+40722123456" required /></Field>
        <Field label="Voice number"><input value={form.voiceNumber} onChange={(e) => setForm({ ...form, voiceNumber: e.target.value })} placeholder="Same as SMS if empty" /></Field>
      </div>
      <p className="quiet">SMS are sent from the SMS number. Inbound texts are posted to the webhook, which is set on that number when Twilio lists it on the account. Call logs and recordings are read from the account. A recording appears when Twilio recorded the call.</p>
      {item.webhookUrl ? (
        <div>
          <span className="quiet">Inbound SMS webhook{item.webhookSet ? ' · set on the SMS number' : ''}</span>
          <code className="twilio-url">{item.webhookUrl}</code>
        </div>
      ) : null}
      <div className="row-actions">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Twilio'}</Button>
        {item.status === 'connected' ? <Button kind="ghost" type="button" onClick={disconnect}>Disconnect</Button> : null}
      </div>
      {item.status === 'connected' ? <TwilioLog log={log} audio={audio} audioErr={audioErr} onPlay={play} /> : null}
    </form>
  )
}

function twilioForm(item) {
  return {
    accountSid: item.accountSid || '',
    authToken: '',
    fromNumber: item.fromNumber || '',
    voiceNumber: item.voiceNumber || '',
  }
}

function way(direction) {
  if (direction === 'inbound') return 'In'
  if (String(direction || '').startsWith('outbound')) return 'Out'
  return direction || ''
}

function TwilioLog({ log, audio, audioErr, onPlay }) {
  if (log.loading && !log.data) return <p className="quiet">Loading Twilio activity…</p>
  if (log.error) return <ErrorNote>{log.error}</ErrorNote>
  const data = log.data || { messages: [], calls: [], recordings: [] }
  return (
    <div className="twilio-logs">
      <section>
        <h3>Messages</h3>
        <ul>
          {data.messages.map((row) => (
            <li key={row.sid}>
              <strong>{way(row.direction)}</strong> {row.from} → {row.to}
              <div className="quiet">{row.body || '—'}</div>
              <div className="quiet">{when(row.at)} · {row.status}</div>
            </li>
          ))}
          {!data.messages.length ? <li className="quiet">No messages yet.</li> : null}
        </ul>
      </section>
      <section>
        <h3>Calls</h3>
        <ul>
          {data.calls.map((row) => (
            <li key={row.sid}>
              <strong>{way(row.direction)}</strong> {row.from} → {row.to}
              <div className="quiet">{when(row.at)} · {row.status} · {row.duration}s</div>
            </li>
          ))}
          {!data.calls.length ? <li className="quiet">No calls yet.</li> : null}
        </ul>
      </section>
      <section>
        <h3>Recordings</h3>
        <ErrorNote>{audioErr}</ErrorNote>
        <ul>
          {data.recordings.map((row) => (
            <li key={row.sid}>
              <div className="quiet">{when(row.at)} · {row.duration}s · {row.status}</div>
              <button type="button" className="btn ghost small" onClick={() => onPlay(row.sid)}>Play</button>
              {audio?.sid === row.sid ? <audio src={audio.url} controls /> : null}
            </li>
          ))}
          {!data.recordings.length ? <li className="quiet">No recordings yet. They appear when Twilio records a call.</li> : null}
        </ul>
      </section>
      {data.error ? <p className="quiet">{data.error}</p> : null}
    </div>
  )
}

const PROPERTY_TYPES = ['text', 'checkboxes', 'radio', 'number', 'select', 'multiselect']

function OrderFieldsTab() {
  const { t } = useI18n()
  const { data, reload, error } = useFetch('/api/order-properties')
  const [form, setForm] = useState({ name: '', type: 'text', options: '' })
  const [err, setErr] = useState('')
  async function create(event) {
    event.preventDefault()
    setErr('')
    try {
      await api('/api/order-properties', {
        method: 'POST',
        body: { name: form.name, type: form.type, options: form.options.split(',').map((item) => item.trim()).filter(Boolean) },
      })
      setForm({ name: '', type: 'text', options: '' })
      reload()
    } catch (error) { setErr(error.message) }
  }
  return (
    <div className="split">
      <div className="card">
        <h2>{t('orderFields')}</h2>
        <ErrorNote>{error}</ErrorNote>
        {(data?.data || []).map((row, index, list) => (
          <div className="check" key={row.id} style={{ marginTop: 10 }}>
            <strong className="grow">{row.name}</strong>
            <span className="quiet">{t(`prop_${row.type}`)}</span>
            <Button kind="ghost" className="small" disabled={index === 0} onClick={() => {
              const prev = list[index - 1]
              Promise.all([
                api(`/api/order-properties/${row.id}`, { method: 'PATCH', body: { sortOrder: prev.sort_order } }),
                api(`/api/order-properties/${prev.id}`, { method: 'PATCH', body: { sortOrder: row.sort_order } }),
              ]).then(reload)
            }}>↑</Button>
            <Button kind="ghost" className="small" disabled={index === list.length - 1} onClick={() => {
              const next = list[index + 1]
              Promise.all([
                api(`/api/order-properties/${row.id}`, { method: 'PATCH', body: { sortOrder: next.sort_order } }),
                api(`/api/order-properties/${next.id}`, { method: 'PATCH', body: { sortOrder: row.sort_order } }),
              ]).then(reload)
            }}>↓</Button>
            <Button kind="ghost" className="small" onClick={() => api(`/api/order-properties/${row.id}`, { method: 'DELETE' }).then(reload)}>{t('remove')}</Button>
          </div>
        ))}
        {!data?.data?.length ? <p className="quiet">{t('noneYet')}</p> : null}
      </div>
      <form className="card" onSubmit={create}>
        <h2>{t('newField')}</h2>
        <ErrorNote>{err}</ErrorNote>
        <Field label={t('name')}><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
        <Field label={t('kind')}>
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {PROPERTY_TYPES.map((type) => <option key={type} value={type}>{t(`prop_${type}`)}</option>)}
          </select>
        </Field>
        {['checkboxes', 'radio', 'select', 'multiselect'].includes(form.type) ? (
          <Field label={t('options')}><input value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} placeholder="A, B, C" required /></Field>
        ) : null}
        <div className="modal-actions"><Button>{t('save')}</Button></div>
      </form>
    </div>
  )
}

function Audit() {
  const { data, error } = useFetch('/api/audit')
  if (error) return <div className="error">{error}</div>
  return (
    <div className="card">
      <table>
        <tbody>
          {data?.data?.map((row) => (
            <tr key={row.id}>
              <td>{when(row.created_at)}</td>
              <td>{row.user_name || 'System'}</td>
              <td>{row.action} {row.object_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

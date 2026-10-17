import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, setToken } from '../api.js'
import { useAuth } from '../App.jsx'
import { Button, ErrorNote, Field } from '../components/ui.jsx'
import { Mark } from '../components/Icons.jsx'
import { useI18n } from '../i18n.jsx'

export default function Auth({ mode }) {
  const { t } = useI18n()
  const { me, setMe } = useAuth()
  const [form, setForm] = useState({ name: '', company: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (me) return <Navigate to={me.role === 'driver' ? '/drive' : '/'} replace />

  function set(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const result = await api(path, { method: 'POST', body: form })
      setToken(result.token)
      const profile = await api('/api/auth/me')
      setMe(profile)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-side">
        <div className="brand"><Mark /><div><strong>Cargos</strong><small>.pro</small></div></div>
        <div>
          <h1>The desk for forwarders who still run the truck.</h1>
          <p className="quiet" style={{ marginTop: 12 }}>Orders, own fleet and subcontracted relations, then the invoice.</p>
        </div>
        <div className="points">
          <div>Order board and dispatch in the same workspace.</div>
          <div>Own-fleet or subcontracted relation, with margin on the order.</div>
          <div>Driver view for status, POD photos, and a signature.</div>
        </div>
      </section>
      <section className="auth-card">
        <form onSubmit={submit}>
          <h2>{mode === 'login' ? t('signIn') : t('createWorkspace')}</h2>
          <p className="quiet">{mode === 'login' ? 'Demo: anna@northlane.example · demo1234' : '14-day trial. Seats and drivers are billed later in Settings.'}</p>
          <ErrorNote>{error}</ErrorNote>
          {mode === 'register' ? <Field label={t('yourName')}><input value={form.name} onChange={set('name')} required /></Field> : null}
          {mode === 'register' ? <Field label={t('companyName')}><input value={form.company} onChange={set('company')} required /></Field> : null}
          <Field label={t('email')}><input type="email" value={form.email} onChange={set('email')} required /></Field>
          <Field label={t('password')}><input type="password" value={form.password} onChange={set('password')} required minLength="8" /></Field>
          <Button disabled={busy} type="submit">{busy ? t('loading') : mode === 'login' ? t('signIn') : t('createWorkspace')}</Button>
          {mode === 'login'
            ? <Link to="/register">{t('needAccount')}</Link>
            : <Link to="/login">{t('haveAccount')}</Link>}
        </form>
      </section>
    </div>
  )
}

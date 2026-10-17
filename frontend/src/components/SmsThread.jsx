import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { when } from '../format.js'
import { useI18n } from '../i18n.jsx'

export function SmsLog({ messages, empty }) {
  const { t } = useI18n()
  const notSent = t('notSent')
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])
  return (
    <div className="sms-log" ref={ref}>
      {messages?.length ? messages.map((message) => (
        <div key={message.id} className={`sms-bubble ${message.direction === 'out' ? 'out' : 'in'}`}>
          <p>{message.body || '…'}</p>
          <time>{when(message.at)}{message.status === 'failed' || message.status === 'undelivered' ? ` · ${notSent}` : ''}</time>
        </div>
      )) : <p className="sms-empty">{empty}</p>}
    </div>
  )
}

export function SmsComposer({ contactId, peer, onSent }) {
  const { t } = useI18n()
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function send(event) {
    event.preventDefault()
    const text = body.trim()
    if (!text || saving) return
    setSaving(true)
    setErr('')
    try {
      await api('/api/sms', { method: 'POST', body: { contactId: contactId || undefined, peer: peer || undefined, body: text } })
      setBody('')
      await onSent?.()
    } catch (error) {
      setErr(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="sms-compose" onSubmit={send}>
      {err ? <p className="error">{err}</p> : null}
      <textarea
        value={body}
        rows={2}
        placeholder={t('writeMessage')}
        aria-label={t('writeMessage')}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) send(event)
        }}
      />
      <button type="submit" className="dash-btn primary" disabled={!body.trim() || saving}>{saving ? t('loading') : t('send')}</button>
    </form>
  )
}

export function SmsCard({ title, phone, href, messages, contactId, peer, onSent, empty }) {
  const { t } = useI18n()
  const canSend = Boolean(phone)
  return (
    <section className="detail-card sms-card">
      <div className="detail-card-head">
        <h2>{href ? <Link to={href}>{title}</Link> : title}</h2>
        {phone ? <span className="sms-phone">{phone}</span> : null}
      </div>
      <SmsLog messages={messages} empty={canSend ? empty : t('noPhoneSms')} />
      {canSend ? <SmsComposer contactId={contactId} peer={peer} onSent={onSent} /> : null}
    </section>
  )
}

export function threadLabel(thread) {
  return thread?.name || thread?.phone || thread?.peer || ''
}

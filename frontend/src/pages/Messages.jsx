import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFetch } from '../api.js'
import { SmsComposer, SmsLog, threadLabel } from '../components/SmsThread.jsx'
import { initialsFrom, markFromName } from '../components/RecordList.jsx'
import { when } from '../format.js'
import { useI18n } from '../i18n.jsx'

export default function Messages() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const inbox = useFetch('/api/sms')
  const contact = params.get('contact') || ''
  const peer = params.get('peer') || ''
  const threadPath = contact
    ? `/api/sms/thread?contact=${encodeURIComponent(contact)}`
    : peer
      ? `/api/sms/thread?peer=${encodeURIComponent(peer)}`
      : null
  const thread = useFetch(threadPath)
  const threads = inbox.data?.threads || []
  const activeKey = contact || peer

  useEffect(() => {
    if (contact || peer || !threads.length) return
    const first = threads[0]
    const next = new URLSearchParams()
    if (first.contactId) next.set('contact', first.contactId)
    else next.set('peer', first.peer)
    setParams(next, { replace: true })
  }, [contact, peer, threads, setParams])

  useEffect(() => {
    const timer = setInterval(() => {
      inbox.reload()
      thread.reload()
    }, 15000)
    return () => clearInterval(timer)
  }, [inbox.reload, thread.reload])

  function open(row) {
    const next = new URLSearchParams()
    if (row.contactId) next.set('contact', row.contactId)
    else next.set('peer', row.peer)
    setParams(next)
  }

  const current = threads.find((row) => (row.contactId || row.peer) === activeKey)
  const title = thread.data?.contact?.name || current?.name || peer
  const phone = thread.data?.contact?.phone || thread.data?.peer || current?.phone || ''

  return (
    <div className="detail messages-page">
      <header className="sheet-head">
        <div className="sheet-titles">
          <h1>{t('messages')}</h1>
          <p>{t('messagesLede')}</p>
        </div>
      </header>
      {inbox.loading && !inbox.data ? <p className="sms-empty">{t('loading')}</p> : null}
      {inbox.error ? <p className="error">{inbox.error}</p> : null}
      {inbox.data && !inbox.data.connected ? (
        <section className="detail-card">
          <p className="sms-empty"><Link to="/settings">{t('connectTwilio')}</Link></p>
        </section>
      ) : null}
      {inbox.data?.connected ? (
        <div className="sms-layout">
          <aside className="sms-list">
            {threads.map((row) => {
              const key = row.contactId || row.peer
              return (
                <button type="button" key={key} className={`sms-thread ${key === activeKey ? 'on' : ''}`} onClick={() => open(row)}>
                  <span className="sheet-avatar" style={{ background: markFromName(threadLabel(row)) }}>{initialsFrom(threadLabel(row))}</span>
                  <span className="sms-thread-copy">
                    <strong>{threadLabel(row)}</strong>
                    <span>{row.lastBody || row.phone}</span>
                  </span>
                  <time>{when(row.lastAt)}</time>
                </button>
              )
            })}
            {!threads.length && !inbox.loading ? <p className="sms-empty">{t('noChats')}</p> : null}
          </aside>
          <section className="sms-pane">
            {activeKey ? (
              <>
                <div className="sms-pane-head">
                  <strong>{title}</strong>
                  {phone ? <span>{phone}</span> : null}
                </div>
                <SmsLog messages={thread.data?.messages} empty={thread.loading ? t('loading') : t('startConversation')} />
                {thread.error ? <p className="error">{thread.error}</p> : null}
                <SmsComposer
                  contactId={thread.data?.contact?.id || contact || undefined}
                  peer={thread.data?.contact ? undefined : (thread.data?.peer || peer)}
                  onSent={async () => { await thread.reload(); inbox.reload() }}
                />
              </>
            ) : <p className="sms-empty">{inbox.loading ? t('loading') : t('startFromContact')}</p>}
          </section>
        </div>
      ) : null}
    </div>
  )
}

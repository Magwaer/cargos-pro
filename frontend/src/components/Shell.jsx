import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api, clearToken, getToken } from '../api.js'
import { useAuth } from '../App.jsx'
import { when } from '../format.js'
import { useI18n } from '../i18n.jsx'
import { Icon, Mark } from './Icons.jsx'
import { useInvoiceDrawer } from './InvoiceDrawer.jsx'
import { fill } from './RecordList.jsx'

const NAV = [
  { group: 'overview', items: [
    { to: '/', label: 'dashboard', icon: 'home', end: true },
    { to: '/reports', label: 'reports', icon: 'chart' },
  ]},
  { group: 'crm', items: [
    { to: '/companies', label: 'companies', icon: 'building' },
    { to: '/contacts', label: 'contacts', icon: 'users' },
    { to: '/tasks', label: 'tasks', icon: 'check' },
  ]},
  { group: 'transport', items: [
    { to: '/orders', label: 'orders', icon: 'box' },
    { to: '/dispatch', label: 'dispatch', icon: 'columns' },
    { to: '/fleet', label: 'fleet', icon: 'truck' },
  ]},
  { group: 'finance', items: [
    { to: '/invoices', label: 'invoices', icon: 'invoice' },
    { to: '/expenses', label: 'expenses', icon: 'expense' },
    { to: '/documents', label: 'documents', icon: 'file' },
  ]},
  { group: 'system', items: [
    { to: '/workflows', label: 'workflows', icon: 'zap' },
    { to: '/settings', label: 'settings', icon: 'settings' },
    { to: '/drive', label: 'driverApp', icon: 'truck' },
  ]},
]

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
  { code: 'ro', label: 'Română' },
]

function Flag({ code }) {
  const rawId = useId().replace(/:/g, '')
  if (code === 'pl') {
    return (
      <svg className="flag" viewBox="0 0 20 14" aria-hidden="true">
        <rect width="20" height="7" fill="#fff" />
        <rect y="7" width="20" height="7" fill="#dc143c" />
      </svg>
    )
  }
  if (code === 'ro') {
    return (
      <svg className="flag" viewBox="0 0 20 14" aria-hidden="true">
        <rect width="6.67" height="14" fill="#002b7f" />
        <rect x="6.67" width="6.66" height="14" fill="#fcd116" />
        <rect x="13.33" width="6.67" height="14" fill="#ce1126" />
      </svg>
    )
  }
  return (
    <svg className="flag" viewBox="0 0 60 30" aria-hidden="true">
      <defs>
        <clipPath id={rawId}><rect width="60" height="30" /></clipPath>
      </defs>
      <g clipPath={`url(#${rawId})`}>
        <rect width="60" height="30" fill="#012169" />
        <path d="M0 0 60 30M60 0 0 30" stroke="#fff" strokeWidth="8" />
        <path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" strokeWidth="4" />
        <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="14" />
        <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="8" />
      </g>
    </svg>
  )
}

function LanguageMenu({ locale, setLocale, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = LANGS.find((lang) => lang.code === locale) || LANGS[0]

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(code) {
    setLocale(code)
    api('/api/auth/me', { method: 'PATCH', body: { locale: code } }).catch(() => {})
    setOpen(false)
  }

  return (
    <div className="lang" ref={ref}>
      <button
        type="button"
        className="lang-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current.code.toUpperCase()}</span>
        <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <ul className="lang-menu" role="listbox" aria-label={label}>
          {LANGS.map((lang) => (
            <li key={lang.code}>
              <button type="button" role="option" aria-selected={locale === lang.code} className={locale === lang.code ? 'on' : ''} onClick={() => choose(lang.code)}>
                <Flag code={lang.code} />
                <span>{lang.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function noteCopy(item, t) {
  if (item.kind === 'invoice_paid') return { title: fill(t('notePaid'), { number: item.title }), body: item.body }
  if (item.kind === 'invoice_overdue') return { title: fill(t('noteOverdue'), { number: item.title }), body: item.body }
  if (item.kind === 'order_status') {
    const [name, status] = String(item.body || '').split('\n')
    return { title: fill(t('noteOrder'), { reference: item.title, status: status ? t(`st_${status}`) : '' }), body: name }
  }
  return { title: item.title, body: item.body }
}

let audioCtx
function unlockSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return
  if (!audioCtx) audioCtx = new Ctx()
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
}

function playChime() {
  if (!audioCtx || audioCtx.state !== 'running') return
  const now = audioCtx.currentTime
  ;[880, 1174.66].forEach((freq, index) => {
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    const start = now + index * 0.09
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(start)
    osc.stop(start + 0.4)
  })
}

function takeFrames(buffer, onFrame) {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() || ''
  for (const part of parts) {
    if (!part.trim() || part.startsWith(':')) continue
    let event = 'message'
    const data = []
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length) onFrame(event, data.join('\n'))
  }
  return rest
}

function NotificationMenu({ label }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { open: openInvoice } = useInvoiceDrawer()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [toasts, setToasts] = useState([])
  const ref = useRef(null)
  const toastTimers = useRef(new Map())

  const dismissToast = useCallback((id) => {
    const timer = toastTimers.current.get(id)
    if (timer) clearTimeout(timer)
    toastTimers.current.delete(id)
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const pushToast = useCallback((item) => {
    setToasts((current) => [...current.filter((row) => row.id !== item.id), item].slice(-4))
    const timer = setTimeout(() => dismissToast(item.id), 8000)
    toastTimers.current.set(item.id, timer)
  }, [dismissToast])

  const holdToast = useCallback((id) => {
    const timer = toastTimers.current.get(id)
    if (timer) clearTimeout(timer)
    toastTimers.current.delete(id)
  }, [])

  const releaseToast = useCallback((id) => {
    if (toastTimers.current.has(id)) return
    const timer = setTimeout(() => dismissToast(id), 8000)
    toastTimers.current.set(id, timer)
  }, [dismissToast])

  const seenReads = useRef(new Set())
  const applyRead = useCallback((payload) => {
    const stamp = new Date().toISOString()
    if (payload.all) {
      setUnread(0)
      setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: stamp })))
      return
    }
    if (!payload.id || seenReads.current.has(payload.id)) return
    seenReads.current.add(payload.id)
    setItems((current) => current.map((item) => (item.id === payload.id && !item.readAt ? { ...item, readAt: stamp } : item)))
    setUnread((count) => Math.max(0, count - 1))
  }, [])

  useEffect(() => {
    let live = true
    const known = new Set()
    const queued = []
    let primed = false
    const controller = new AbortController()
    let retry = 1000

    function show(item) {
      if (known.has(item.id)) return
      known.add(item.id)
      setItems((current) => [item, ...current.filter((row) => row.id !== item.id)].slice(0, 20))
      setUnread((count) => count + 1)
      pushToast(item)
      playChime()
    }

    function onFrame(event, raw) {
      let payload
      try { payload = JSON.parse(raw) } catch { return }
      if (event === 'notification') {
        if (!primed) queued.push(payload)
        else show(payload)
      } else if (event === 'read') applyRead(payload)
    }

    async function listen() {
      while (live) {
        try {
          const res = await fetch('/api/notifications/stream', {
            headers: { Authorization: `Bearer ${getToken()}`, Accept: 'text/event-stream' },
            signal: controller.signal,
          })
          if (res.status === 401) {
            clearToken()
            location.assign('/login')
            return
          }
          if (res.status === 403) return
          if (!res.ok || !res.body) throw new Error('stream')
          retry = 1000
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (live) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            buffer = takeFrames(buffer, onFrame)
          }
        } catch (error) {
          if (error?.name === 'AbortError' || !live) return
        }
        if (!live) return
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, retry)
          controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
        })
        retry = Math.min(retry * 2, 15000)
      }
    }

    api('/api/notifications').then((body) => {
      if (!live) return
      const rows = body.data || []
      const pending = queued.splice(0)
      const seen = new Set(rows.map((item) => item.id))
      pending.forEach((item) => {
        known.add(item.id)
        if (!seen.has(item.id)) rows.unshift(item)
      })
      rows.forEach((item) => known.add(item.id))
      setItems(rows.slice(0, 20))
      const extra = pending.filter((item) => !seen.has(item.id)).length
      setUnread((body.unread || 0) + extra)
      pending.forEach((item) => { pushToast(item); playChime() })
      primed = true
    }).catch(() => {
      queued.splice(0).forEach((item) => show(item))
      primed = true
    })
    listen()
    window.addEventListener('pointerdown', unlockSound)
    return () => {
      live = false
      controller.abort()
      window.removeEventListener('pointerdown', unlockSound)
      toastTimers.current.forEach((timer) => clearTimeout(timer))
    }
  }, [applyRead, pushToast])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function mark(id) {
    await api('/api/notifications/read', { method: 'POST', body: id ? { id } : { all: true } })
    applyRead(id ? { id } : { all: true })
  }

  async function openItem(item) {
    setOpen(false)
    dismissToast(item.id)
    if (!item.readAt) await mark(item.id)
    const invoiceId = String(item.href || '').match(/^\/invoices\/([0-9a-f-]{36})$/i)?.[1]
    if (invoiceId) openInvoice(invoiceId)
    else if (item.href) navigate(item.href)
  }

  return (
    <div className="note" ref={ref}>
      <button
        type="button"
        className={`top-icon ${open ? 'on' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `${label}, ${unread}` : label}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={16} />
        {unread ? <span className="note-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="note-menu">
          <div className="note-head">
            <strong>{label}</strong>
            {unread ? <button type="button" onClick={() => mark()}>{t('markAllRead')}</button> : null}
          </div>
          {items.length ? items.map((item) => {
            const copy = noteCopy(item, t)
            return (
              <button type="button" key={item.id} className={`note-item ${item.readAt ? '' : 'unread'}`} onClick={() => openItem(item)}>
                <span>
                  <strong>{copy.title}</strong>
                  {copy.body ? <em>{copy.body}</em> : null}
                </span>
                <time>{when(item.createdAt)}</time>
              </button>
            )
          }) : <p className="note-empty">{t('noNotifications')}</p>}
        </div>
      ) : null}
      {toasts.length ? createPortal(
        <div className="note-toasts">
          {toasts.map((item) => {
            const copy = noteCopy(item, t)
            return (
              <div
                key={item.id}
                className="note-toast"
                role="status"
                tabIndex={0}
                onClick={() => openItem(item)}
                onKeyDown={(event) => { if (event.key === 'Enter') openItem(item) }}
                onMouseEnter={() => holdToast(item.id)}
                onMouseLeave={() => releaseToast(item.id)}
              >
                <span className="note-toast-mark"><Icon name="bell" size={14} /></span>
                <span className="note-toast-copy">
                  <strong>{copy.title}</strong>
                  {copy.body ? <em>{copy.body}</em> : null}
                </span>
                <button type="button" className="note-toast-x" aria-label={t('dismiss')} onClick={(event) => { event.stopPropagation(); dismissToast(item.id) }}>×</button>
              </div>
            )
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

function searchShortcut() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
}

export default function Shell({ children }) {
  const { t, locale, setLocale } = useI18n()
  const { me } = useAuth()
  const navigate = useNavigate()
  const { open: openInvoice } = useInvoiceDrawer()
  const location = useLocation()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light')
  const [twilioOn, setTwilioOn] = useState(false)

  useEffect(() => {
    const onKey = (event) => {
      const tag = document.activeElement?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      const command = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (command || (event.key === '/' && !typing)) {
        event.preventDefault()
        document.getElementById('global-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let live = true
    api('/api/integrations').then((body) => {
      if (!live) return
      const row = (body.data || []).find((item) => item.provider === 'twilio')
      setTwilioOn(row?.status === 'connected')
    }).catch(() => {})
    const onStatus = (event) => setTwilioOn(Boolean(event.detail?.connected))
    window.addEventListener('cargos-twilio', onStatus)
    return () => {
      live = false
      window.removeEventListener('cargos-twilio', onStatus)
    }
  }, [location.pathname])

  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return }
    const handle = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits(null))
    }, 180)
    return () => clearTimeout(handle)
  }, [q])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  const initial = (me?.name || '?').slice(0, 1).toUpperCase()
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <div><strong>Cargos</strong><small>.pro</small></div>
        </div>
        {NAV.map((group) => (
          <div className="nav-group" key={group.group}>
            <h3>{t(group.group)}</h3>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Icon name={item.icon} />
                {t(item.label)}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <div className="who">
            <div className="avatar">{initial}</div>
            <div>
              <strong>{me?.name}</strong>
              <span>{me?.tenant_name}</span>
            </div>
          </div>
          <button className="btn ghost" onClick={() => { clearToken(); navigate('/login') }}>{t('logout')}</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="search">
              <span className="search-mark" aria-hidden="true" />
              <input id="global-search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('search')} />
              <kbd className="search-kbd">{searchShortcut()}</kbd>
              {hits ? (
                <div className="search-pop">
                  {hits.orders?.map((row) => <a key={row.id} href={`/orders/${row.id}`} onClick={(event) => { event.preventDefault(); setQ(''); navigate(`/orders/${row.id}`) }}>{row.reference} <small>{row.origin} → {row.destination}</small></a>)}
                  {hits.companies?.map((row) => <a key={row.id} href={`/companies/${row.id}`} onClick={(event) => { event.preventDefault(); setQ(''); navigate(`/companies/${row.id}`) }}>{row.name} <small>{row.city}</small></a>)}
                  {hits.invoices?.map((row) => <a key={row.id} href="/invoices" onClick={(event) => { event.preventDefault(); setQ(''); openInvoice(row.id) }}>{row.number}{row.company_name ? <small>{row.company_name}</small> : null}</a>)}
                  {hits.contacts?.map((row) => <a key={row.id} href={`/contacts/${row.id}`} onClick={(event) => { event.preventDefault(); setQ(''); navigate(`/contacts/${row.id}`) }}>{row.name}</a>)}
                  {!hits.orders?.length && !hits.companies?.length && !hits.contacts?.length && !hits.invoices?.length ? <div>No matches</div> : null}
                </div>
              ) : null}
            </div>
            <div className="top-actions">
              <NotificationMenu label={t('notifications')} />
              {twilioOn ? (
                <Link to="/messages" className={`top-icon ${location.pathname.startsWith('/messages') ? 'on' : ''}`} aria-label={t('messages')}>
                  <Icon name="chat" size={16} />
                </Link>
              ) : null}
              <LanguageMenu locale={locale} setLocale={setLocale} label={t('language')} />
              <button type="button" className="top-icon" onClick={toggleTheme} aria-label={t('theme')} title={theme === 'dark' ? t('light') : t('dark')}>
                {theme === 'dark' ? <Icon name="sun" size={16} /> : <span className="top-moon" />}
              </button>
            </div>
          </div>
        </header>
        <div className="content">
          {me?.plan === 'trial' ? <div className="banner">Trial workspace{me.trial_ends_at ? ` until ${String(me.trial_ends_at).slice(0, 10)}` : ''}. Subscriptions are in Settings.</div> : null}
          {children}
        </div>
      </div>
    </div>
  )
}

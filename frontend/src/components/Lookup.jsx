import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { initialsFrom, markFromName } from './RecordList.jsx'

const LIMIT = 12

function titleOf(kind, row) {
  if (!row) return ''
  if (kind === 'order') return row.reference || ''
  return row.name || ''
}

function hintOf(kind, row, t) {
  if (!row) return ''
  if (kind === 'company') return [row.city, row.country, row.role ? t(`st_${row.role}`) : ''].filter(Boolean).join(' · ')
  if (kind === 'contact') return [row.title, row.company_name, row.email || row.phone || row.mobile].filter(Boolean).join(' · ')
  const lane = [row.origin, row.destination].filter(Boolean).join(' → ')
  return [row.company_name, lane, row.status ? t(`st_${row.status}`) : ''].filter(Boolean).join(' · ')
}

function searchUrl(kind, q, extras) {
  const params = new URLSearchParams({ limit: String(LIMIT) })
  if (q) params.set('q', q)
  if (kind === 'company' && extras.role) params.set('role', extras.role)
  if (kind === 'contact' && extras.companyId) params.set('companyId', extras.companyId)
  const base = kind === 'company' ? '/api/companies' : kind === 'contact' ? '/api/contacts' : '/api/orders'
  return `${base}?${params}`
}

function loadUrl(kind, id) {
  if (kind === 'company') return `/api/companies/${id}`
  if (kind === 'contact') return `/api/contacts/${id}`
  return `/api/orders/${id}`
}

function placeholderOf(kind, t, extras) {
  if (kind === 'contact' && !extras.companyId && extras.needsCompany) return t('pickCompanyFirst')
  if (kind === 'company') return t('searchCompany')
  if (kind === 'contact') return t('searchContact')
  return t('searchOrder')
}

export function Lookup({
  kind,
  value = '',
  label = '',
  onChange,
  role,
  companyId,
  needsCompany = false,
  allowClear = true,
  required = false,
  disabled = false,
  placeholder,
}) {
  const { t } = useI18n()
  const listId = useId()
  const root = useRef(null)
  const input = useRef(null)
  const req = useRef(0)
  const extras = { role, companyId, needsCompany }
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState(label ? { id: value, title: label, hint: '' } : null)
  const [menu, setMenu] = useState(null)
  const shown = open ? query : (picked?.title || label || '')
  const empty = disabled && needsCompany && !companyId ? t('pickCompanyFirst') : (placeholder || placeholderOf(kind, t, extras))

  useEffect(() => {
    if (!value) {
      setPicked(null)
      return
    }
    if (picked?.id === value && (picked.title || label)) return
    if (label && picked?.id !== value) {
      setPicked({ id: value, title: label, hint: '' })
      return
    }
    if (label && !picked) {
      setPicked({ id: value, title: label, hint: '' })
      return
    }
    let live = true
    api(loadUrl(kind, value)).then((row) => {
      if (!live || !row) return
      setPicked({ id: row.id, title: titleOf(kind, row), hint: hintOf(kind, row, t), raw: row })
    }).catch(() => {})
    return () => { live = false }
  }, [kind, value, label, t])

  useEffect(() => {
    if (!open) return undefined
    const id = ++req.current
    const selected = picked
    setLoading(true)
    const timer = setTimeout(() => {
      const q = query.trim()
      const search = q && selected?.title && q === selected.title ? '' : q
      api(searchUrl(kind, search, { role, companyId }))
        .then((body) => {
          if (req.current !== id) return
          const rows = (Array.isArray(body?.data) ? body.data : []).map((row) => ({
            id: row.id,
            title: titleOf(kind, row),
            hint: hintOf(kind, row, t),
            raw: row,
          }))
          if (selected?.id && !rows.some((row) => row.id === selected.id) && (!search || selected.title.toLowerCase().includes(search.toLowerCase()))) {
            rows.unshift(selected)
          }
          setItems(rows)
          const current = rows.findIndex((row) => row.id === value)
          setActive(current >= 0 ? current : 0)
        })
        .catch(() => {
          if (req.current !== id) return
          setItems(selected?.id ? [selected] : [])
        })
        .finally(() => {
          if (req.current === id) setLoading(false)
        })
    }, 160)
    return () => clearTimeout(timer)
  }, [open, query, kind, role, companyId, t])

  useLayoutEffect(() => {
    if (!open || !root.current) return undefined
    function place() {
      const box = root.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - box.bottom - 12
      const spaceAbove = box.top - 12
      const flip = spaceBelow < 180 && spaceAbove > spaceBelow
      setMenu({
        left: Math.round(box.left),
        width: Math.round(box.width),
        top: flip ? undefined : Math.round(box.bottom + 6),
        bottom: flip ? Math.round(window.innerHeight - box.top + 6) : undefined,
        maxHeight: Math.min(280, Math.max(140, flip ? spaceAbove : spaceBelow)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, items.length])

  useEffect(() => {
    if (!open) return undefined
    function onPointer(event) {
      if (!root.current?.contains(event.target) && !event.target.closest?.('.lookup-pop')) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  function choose(item) {
    setPicked(item)
    setQuery(item.title)
    setOpen(false)
    onChange(item.id, item)
  }

  function clear(event) {
    event.preventDefault()
    event.stopPropagation()
    setPicked(null)
    setQuery('')
    setItems([])
    onChange('', null)
    input.current?.focus()
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      setOpen(false)
      setQuery(picked?.title || label || '')
      input.current?.blur()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      else setActive((index) => Math.min(items.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter' && open && items[active]) {
      event.preventDefault()
      choose(items[active])
    }
  }

  return (
    <div className={`lookup ${open ? 'is-open' : ''} ${disabled ? 'is-off' : ''}`} ref={root}>
      <div className={`lookup-box ${open ? 'is-open' : ''} ${value ? 'has-value' : ''}`}>
        <input
          ref={input}
          value={shown}
          disabled={disabled}
          required={required && !value}
          autoComplete="off"
          spellCheck="false"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={empty}
          onFocus={() => {
            if (disabled) return
            setQuery(picked?.title || label || '')
            setOpen(true)
            requestAnimationFrame(() => input.current?.select())
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={onKey}
        />
        {allowClear && value && !disabled ? (
          <button type="button" className="lookup-clear" onClick={clear} aria-label={t('clearSelection')}>×</button>
        ) : null}
        <span className="lookup-chevron" aria-hidden="true" />
      </div>
      {open && menu && !disabled ? createPortal(
        <div
          className="lookup-pop"
          id={listId}
          role="listbox"
          style={{
            left: menu.left,
            width: menu.width,
            top: menu.top,
            bottom: menu.bottom,
            maxHeight: menu.maxHeight,
          }}
        >
          {loading && !items.length ? <div className="lookup-empty">{t('loading')}</div> : null}
          {!loading && !items.length ? <div className="lookup-empty">{t('noLookupMatches')}</div> : null}
          {items.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={item.id === value || index === active}
              className={`lookup-item ${index === active ? 'is-on' : ''} ${item.id === value ? 'is-picked' : ''}`}
              key={item.id}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              <span className="lookup-mark" style={{ background: markFromName(item.title) }}>{kind === 'order' ? String(item.title || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?' : initialsFrom(item.title)}</span>
              <span>
                <strong>{item.title}</strong>
                {item.hint ? <small>{item.hint}</small> : null}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

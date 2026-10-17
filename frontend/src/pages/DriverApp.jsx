import { useEffect, useRef, useState } from 'react'
import { api, clearToken, useFetch } from '../api.js'
import { useAuth } from '../App.jsx'
import { fill } from '../components/RecordList.jsx'
import { Pill } from '../components/ui.jsx'
import { leg, when } from '../format.js'
import { useI18n } from '../i18n.jsx'

const STEPS = ['arrived', 'loaded', 'in_transit', 'delivered']
const NEXT_LABEL = {
  assigned: 'markArrived',
  planned: 'markArrived',
  arrived: 'markLoaded',
  loaded: 'startTransit',
  in_transit: 'markDelivered',
}

function greet(t) {
  const hour = new Date().getHours()
  if (hour < 12) return t('goodMorning')
  if (hour < 18) return t('goodAfternoon')
  return t('goodEvening')
}

function cargoParts(cargo) {
  const text = String(cargo || '')
  const match = text.match(/temperature\s*([+-]?\d+)\s*°?\s*C?/i)
  const name = text.replace(/,?\s*temperature\s*[+-]?\d+\s*°?\s*C?/i, '').replace(/,\s*$/, '').trim()
  return { name: name || text, temp: match ? match[1] : null }
}

function nextStatus(status) {
  const index = STEPS.indexOf(status)
  if (index === -1) return 'arrived'
  return STEPS[index + 1] || null
}

export default function DriverApp() {
  const { t } = useI18n()
  const { me } = useAuth()
  const isDriver = me?.role === 'driver'
  const { data, loading, error } = useFetch(isDriver ? '/api/driver/assignments' : null)
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState('')
  const [menu, setMenu] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const menuRef = useRef(null)
  const first = me?.name?.split(' ')[0] || ''

  useEffect(() => {
    if (data?.data) setJobs(data.data)
  }, [data])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!menu) return undefined
    const onPointer = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenu(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const rows = jobs || []
  const open = rows.filter((job) => job.relation_status !== 'delivered')
  const done = rows.filter((job) => job.relation_status === 'delivered')

  async function setStatus(job, status, history) {
    setErr('')
    await api(`/api/driver/relations/${job.relation_id}/status`, { method: 'POST', body: { status } })
    setJobs((current) => (current || []).map((row) => (
      row.relation_id === job.relation_id ? { ...row, relation_status: status, history } : row
    )))
  }

  return (
    <div className="drive-stage">
      <div className="drive-phone">
        <div className="drive-status">
          <span>{clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
          <span className="drive-island" />
          <span className="drive-battery">100%</span>
        </div>
        <div className="drive-scroll">
          <div className="drive-hello">
            <div className="drive-hello-copy">
              <div className="drive-greet">{greet(t)}</div>
              <div className="drive-name">{first}</div>
            </div>
            <div className="drive-menu" ref={menuRef}>
              <button type="button" className="drive-avatar" aria-expanded={menu} aria-label={me?.name} onClick={() => setMenu((open) => !open)}>
                {(first || '?').slice(0, 1).toUpperCase()}
              </button>
              {menu ? (
                <div className="drive-pop">
                  <button type="button" className="drive-logout" onClick={() => { clearToken(); location.assign('/login') }}>{t('logout')}</button>
                </div>
              ) : null}
            </div>
          </div>

          {error || err ? <div className="drive-error">{error || err}</div> : null}
          {!isDriver ? <p className="drive-note">{t('driverOnly')}</p> : null}
          {isDriver && loading && !jobs ? <p className="drive-note">{t('loading')}</p> : null}

          {open.length ? <div className="drive-kicker">{t('currentTrip')}</div> : null}
          {open.map((job) => (
            <CurrentTrip
              key={job.relation_id}
              job={job}
              t={t}
              onStatus={async (status, history) => {
                try { await setStatus(job, status, history) }
                catch (error) { setErr(error.message); throw error }
              }}
              onSaved={(patch) => setJobs((current) => (current || []).map((row) => (
                row.relation_id === job.relation_id ? { ...row, ...patch } : row
              )))}
              onError={setErr}
            />
          ))}

          {isDriver && !loading && !open.length && !done.length ? <p className="drive-note">{t('noTrip')}</p> : null}

          {done.length ? <div className={`drive-kicker${open.length ? ' later' : ''}`}>{t('completedTrips')}</div> : null}
          {done.map((job) => <CompletedTrip key={job.relation_id} job={job} t={t} />)}
        </div>
      </div>
    </div>
  )
}

function CurrentTrip({ job, t, onStatus, onSaved, onError }) {
  const [history, setHistory] = useState(job.history || [])
  const [busy, setBusy] = useState(false)
  const step = STEPS.indexOf(job.relation_status)
  const upcoming = nextStatus(job.relation_status)
  const { name, temp } = cargoParts(job.cargo)
  const distance = leg(job.distance_km, job.duration_min)

  async function advance() {
    if (!upcoming || busy) return
    const nextHistory = STEPS.includes(job.relation_status) ? [...history, job.relation_status] : history
    setBusy(true)
    try {
      await onStatus(upcoming, nextHistory)
      setHistory(nextHistory)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    const previous = history[history.length - 1]
    if (!previous || busy) return
    const nextHistory = history.slice(0, -1)
    setBusy(true)
    try {
      await onStatus(previous, nextHistory)
      setHistory(nextHistory)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="drive-card">
        <div className="drive-refrow">
          <span className="drive-ref">{job.reference}</span>
          {job.plate ? <span className="drive-plate">{job.plate}</span> : null}
        </div>
        <div className="drive-lane">
          <div className="drive-rail">
            <span className="drive-dot" />
            <span className="drive-dash" />
            <span className="drive-dot end" />
          </div>
          <div className="drive-stops">
            <div>
              <div className="drive-place">{job.origin}</div>
              {job.pickup_at ? <div className="drive-sub">{fill(t('pickupLabel'), { when: when(job.pickup_at) })}</div> : null}
            </div>
            {distance ? <div className="drive-leg">{distance}</div> : null}
            <div className="drive-place">{job.destination}</div>
          </div>
        </div>
        {name || temp ? (
          <div className="drive-chips">
            {name ? <span className="drive-chip">{name}</span> : null}
            {temp ? <span className="drive-chip cold">{fill(t('keepAt'), { temp })}</span> : null}
          </div>
        ) : null}
        <div className="drive-progress">
          <div className="drive-steps">
            {STEPS.map((status, index) => (
              <div key={status} className={`drive-step${index <= step ? ' on' : ''}${index === step ? ' now' : ''}`}>
                <div className={`drive-bar${index <= step ? ' on' : ''}`} />
                <span>{t(`st_${status}`)}</span>
              </div>
            ))}
          </div>
          {upcoming ? (
            <button type="button" className="drive-go" disabled={busy} onClick={advance}>{t(NEXT_LABEL[job.relation_status] || 'markArrived')}</button>
          ) : null}
          {history.length ? (
            <button type="button" className="drive-undo" disabled={busy} onClick={undo}>{t('undoStep')}</button>
          ) : null}
        </div>
      </section>
      <Proof job={job} t={t} onSaved={onSaved} onError={onError} />
    </>
  )
}

function CompletedTrip({ job, t }) {
  const distance = leg(job.distance_km, job.duration_min)
  return (
    <section className="drive-card done">
      <div className="drive-refrow">
        <span className="drive-ref">{job.reference}</span>
        <Pill value="delivered" />
      </div>
      <div className="drive-route">{job.origin} <span className="drive-arrow">→</span> {job.destination}</div>
      <div className="drive-meta">
        {job.cargo ? <span>{job.cargo}</span> : null}
        {distance ? <span className="drive-leg">{distance}</span> : null}
      </div>
      <div className="drive-foot">
        <span>{job.pickup_at ? fill(t('pickupLabel'), { when: when(job.pickup_at) }) : ''}</span>
        <span>{job.plate || ''}</span>
      </div>
    </section>
  )
}

function Proof({ job, t, onSaved, onError }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [file, setFile] = useState(null)
  const [sigEmpty, setSigEmpty] = useState(!job.has_signature)
  const [sigTouched, setSigTouched] = useState(false)
  const [saved, setSaved] = useState(Boolean(job.pod_filename && job.has_signature))
  const [busy, setBusy] = useState(false)
  const fileReady = Boolean(file || job.pod_filename)
  const sigReady = !sigEmpty
  const dirty = Boolean(file) || sigTouched
  const stored = Boolean(job.pod_filename && job.has_signature) && !dirty
  const ready = fileReady && sigReady && !stored && !saved
  const showSaved = stored || saved
  const added = (fileReady ? 1 : 0) + (sigReady ? 1 : 0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const draw = () => setupCanvas(canvas)
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [job.relation_id])

  function pos(event) {
    const rect = canvasRef.current.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  function down(event) {
    drawing.current = true
    const ctx = canvasRef.current.getContext('2d')
    const [x, y] = pos(event)
    ctx.beginPath()
    ctx.moveTo(x, y)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function move(event) {
    if (!drawing.current) return
    const ctx = canvasRef.current.getContext('2d')
    const [x, y] = pos(event)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (sigEmpty) setSigEmpty(false)
    if (!sigTouched) setSigTouched(true)
    if (saved) setSaved(false)
  }

  function clear() {
    setupCanvas(canvasRef.current, true)
    setSigEmpty(true)
    setSigTouched(true)
    setSaved(false)
  }

  async function save() {
    if (!ready || busy) return
    setBusy(true)
    onError('')
    try {
      if (file) {
        const form = new FormData()
        form.set('file', file)
        await api(`/api/driver/relations/${job.relation_id}/pod`, { method: 'POST', form })
      }
      if (sigTouched) {
        const blob = await new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('Signature file is missing.')
        const form = new FormData()
        form.set('file', blob, 'signature.png')
        await api(`/api/driver/relations/${job.relation_id}/signature`, { method: 'POST', form })
      }
      setSaved(true)
      onSaved({
        pod_filename: file?.name || job.pod_filename,
        has_signature: true,
      })
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const status = showSaved
    ? t('podStatusSaved')
    : ready
      ? t('readyToSave')
      : fill(t('podProgress'), { n: added })

  return (
    <section className="drive-card">
      <div className="drive-podhead">
        <h2>{t('proofOfDelivery')}</h2>
        <span className={showSaved ? 'saved' : ''}>{status}</span>
      </div>
      <label className="drive-file">
        <span className="drive-plus">+</span>
        <span className="drive-file-copy">
          <strong>{file?.name || job.pod_filename || t('addPod')}</strong>
          <span>{file || job.pod_filename ? t('tapReplace') : t('cameraHint')}</span>
        </span>
        <input
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={(event) => {
            setFile(event.target.files?.[0] || null)
            setSaved(false)
          }}
        />
      </label>
      <div className="drive-sig">
        <div className="drive-sighead">
          <span>{t('receiverSignature')}</span>
          <button type="button" onClick={clear}>{t('clearSig')}</button>
        </div>
        <div className="drive-pad">
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => { drawing.current = false }}
            onPointerLeave={() => { drawing.current = false }}
          />
          {sigEmpty ? (
            <>
              <div className="drive-signline" />
              <div className="drive-signhint">{t('signHere')}</div>
            </>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className={`drive-go drive-save${showSaved ? ' saved' : ready ? ' ready' : ''}`}
        disabled={!ready || busy}
        onClick={save}
      >
        {showSaved ? t('podSaved') : t('savePod')}
      </button>
    </section>
  )
}

function setupCanvas(canvas, force) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  if (!force && canvas.dataset.w === String(width) && canvas.dataset.h === String(height) && canvas.width) return
  canvas.dataset.w = String(width)
  canvas.dataset.h = String(height)
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#1c1c1a'
}

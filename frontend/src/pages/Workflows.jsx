import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, useFetch } from '../api.js'
import { Icon } from '../components/Icons.jsx'
import { Button, ErrorNote, Field, Modal, PageHead, Pill } from '../components/ui.jsx'
import { when } from '../format.js'
import { useI18n } from '../i18n.jsx'

const OBJECTS = ['order', 'invoice', 'company', 'contact']
const EVENTS = ['created', 'updated', 'property_changed']
const PALETTE = [
  { group: 'actions', items: [
    { type: 'email', label: 'Email', icon: 'mail' },
    { type: 'sms', label: 'SMS', icon: 'chat' },
    { type: 'edit_record', label: 'Edit record', icon: 'pencil' },
    { type: 'notification', label: 'Notification', icon: 'bell' },
    { type: 'webhook', label: 'Webhook', icon: 'webhook' },
    { type: 'create_task', label: 'Create task', icon: 'check' },
    { type: 'create_invoice', label: 'Create invoice', icon: 'invoice' },
  ]},
  { group: 'timing', items: [{ type: 'delay', label: 'Time delay', icon: 'clock' }] },
  { group: 'logic', items: [{ type: 'split', label: 'Conditional split', icon: 'branch' }] },
]

const STEP_ICON = Object.fromEntries(PALETTE.flatMap((group) => group.items).map((item) => [item.type, item.icon]))

function stepLabel(t, type, fallback) {
  const key = `wf_${type}`
  const label = t(key)
  return label === key ? (fallback || type) : label
}

function stepKind(type) {
  if (type === 'split') return 'logic'
  if (type === 'delay') return 'timing'
  return 'actions'
}

const NATIVE = {
  order: ['status', 'origin', 'destination', 'cargo', 'notes', 'price_cents', 'load_type'],
  invoice: ['status'],
  company: ['name', 'email', 'phone', 'vat', 'vat_eu', 'city', 'country', 'payment_terms_days', 'warning', 'blacklisted'],
  contact: ['name', 'email', 'phone', 'mobile', 'fax', 'title'],
}

function nid() {
  return `n${Math.random().toString(36).slice(2, 8)}`
}

function actionsToGraph(actions = []) {
  const nodes = actions.map((action, index) => ({
    id: `n${index + 1}`,
    type: action.type === 'set_property' ? 'edit_record' : action.type,
    config: action.type === 'set_property'
      ? { fields: [{ key: action.field, source: 'native', value: action.value }] }
      : { ...action },
  }))
  const edges = []
  let prev = 'start'
  for (const node of nodes) {
    edges.push({ from: prev, to: node.id })
    prev = node.id
  }
  return { nodes, edges }
}

function outgoing(graph, from, when) {
  return (graph.edges || []).filter((edge) => edge.from === from && (when ? edge.when === when : !edge.when))
}

export default function Workflows() {
  const { id } = useParams()
  return id ? <Editor id={id} /> : <List />
}

function List() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const flows = useFetch('/api/workflows')
  const runs = useFetch('/api/workflow-runs')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', objectType: 'order', triggerEvent: 'property_changed', triggerProperty: 'status', triggerValue: 'delivered' })
  const [err, setErr] = useState('')

  async function create(event) {
    event.preventDefault()
    setErr('')
    try {
      const row = await api('/api/workflows', { method: 'POST', body: { ...form, graph: { nodes: [], edges: [] } } })
      navigate(`/workflows/${row.id}`)
    } catch (error) { setErr(error.message) }
  }

  return (
    <div>
      <PageHead title={t('workflows')} lede={t('workflowsLede')}>
        <Button onClick={() => setOpen(true)}>{t('new')}</Button>
      </PageHead>
      <div className="split">
        <div className="stack">
          {flows.data?.data?.map((flow) => (
            <div className="card" key={flow.id}>
              <div className="check">
                <strong className="grow">{flow.name}</strong>
                <Pill value={flow.enabled ? 'active' : 'paused'} />
                <Button kind="ghost" className="small" onClick={() => api(`/api/workflows/${flow.id}`, { method: 'PATCH', body: { enabled: !flow.enabled } }).then(flows.reload)}>{flow.enabled ? t('pause') : t('enable')}</Button>
                <Button className="small" onClick={() => navigate(`/workflows/${flow.id}`)}>{t('open')}</Button>
              </div>
              <p className="quiet" style={{ marginTop: 8 }}>{flow.object_type} · {flow.trigger_event}{flow.trigger_property ? ` · ${flow.trigger_property} = ${flow.trigger_value}` : ''}</p>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>{t('recentRuns')}</h2>
          {(runs.data?.data || []).map((run) => (
            <div className="event" key={run.id}>
              <strong>{run.name || t('workflows')}</strong>
              <p><Pill value={run.status} /> {run.detail}<br />{when(run.created_at)}</p>
            </div>
          ))}
          {!runs.data?.data?.length ? <div className="empty">{t('noRuns')}</div> : null}
        </div>
      </div>
      {open ? (
        <Modal title={t('newWorkflow')} onClose={() => setOpen(false)}>
          <form onSubmit={create}>
            <ErrorNote>{err}</ErrorNote>
            <TriggerFields form={form} setForm={setForm} />
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

function TriggerFields({ form, setForm }) {
  const { t } = useI18n()
  return (
    <div className="form-grid">
      {form.name !== undefined ? <Field label={t('name')} wide><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field> : null}
      <Field label={t('record')}>
        <select value={form.objectType} onChange={(event) => setForm({ ...form, objectType: event.target.value })}>
          {OBJECTS.map((value) => <option key={value} value={value}>{t(`type_${value}`)}</option>)}
        </select>
      </Field>
      <Field label={t('trigger')}>
        <select value={form.triggerEvent} onChange={(event) => setForm({ ...form, triggerEvent: event.target.value })}>
          {EVENTS.map((value) => <option key={value} value={value}>{t(`trig_${value}`)}</option>)}
        </select>
      </Field>
      {form.triggerEvent === 'property_changed' ? (
        <>
          <Field label={t('property')}><input value={form.triggerProperty || ''} onChange={(event) => setForm({ ...form, triggerProperty: event.target.value })} /></Field>
          <Field label={t('becomes')}><input value={form.triggerValue || ''} onChange={(event) => setForm({ ...form, triggerValue: event.target.value })} /></Field>
        </>
      ) : null}
    </div>
  )
}

function Editor({ id }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, error, reload } = useFetch(`/api/workflows/${id}`)
  const properties = useFetch('/api/order-properties')
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState({ objectType: 'order', triggerEvent: 'property_changed', triggerProperty: 'status', triggerValue: '' })
  const [zoom, setZoom] = useState(1)
  const [setup, setSetup] = useState(null)
  const [startOpen, setStartOpen] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setName(data.name)
    setTrigger({
      objectType: data.object_type,
      triggerEvent: data.trigger_event,
      triggerProperty: data.trigger_property || '',
      triggerValue: data.trigger_value || '',
    })
    setGraph(data.graph?.nodes ? data.graph : actionsToGraph(data.actions || []))
  }, [data])

  function insert(type, after, when) {
    const node = { id: nid(), type, config: defaultConfig(type) }
    setGraph((current) => {
      const keep = (current.edges || []).filter((edge) => !(edge.from === after && (when ? edge.when === when : !edge.when)))
      const moved = (current.edges || []).filter((edge) => edge.from === after && (when ? edge.when === when : !edge.when))
      return {
        nodes: [...(current.nodes || []), node],
        edges: [
          ...keep,
          { from: after, to: node.id, ...(when ? { when } : {}) },
          ...moved.map((edge) => ({ ...edge, from: node.id })),
        ],
      }
    })
    setSetup(node.id)
  }

  function remove(nodeId) {
    setGraph((current) => {
      const incoming = (current.edges || []).filter((edge) => edge.to === nodeId)
      const outgoingEdges = (current.edges || []).filter((edge) => edge.from === nodeId && !edge.when)
      const next = outgoingEdges[0]
      return {
        nodes: current.nodes.filter((node) => node.id !== nodeId),
        edges: current.edges
          .filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
          .concat(next ? incoming.map((edge) => ({ ...edge, to: next.to })) : []),
      }
    })
    if (setup === nodeId) setSetup(null)
  }

  async function save() {
    setSaving(true)
    setErr('')
    try {
      await api(`/api/workflows/${id}`, { method: 'PATCH', body: { name, ...trigger, graph } })
      reload()
    } catch (error) { setErr(error.message) }
    finally { setSaving(false) }
  }

  const selected = graph.nodes.find((node) => node.id === setup)

  if (error) return <div className="flow-full"><div className="error">{error}</div></div>
  if (!data) return <div className="flow-full"><p className="quiet">{t('loading')}</p></div>

  return (
    <div className="flow-full">
      <header className="flow-bar">
        <button type="button" className="dash-btn" onClick={() => navigate('/workflows')}>{t('back')}</button>
        <input className="flow-name" value={name} onChange={(event) => setName(event.target.value)} />
        <Button onClick={save} disabled={saving}>{t('save')}</Button>
      </header>
      <ErrorNote>{err}</ErrorNote>
      <div className="flow-body">
        <aside className="flow-palette">
          {PALETTE.map((group) => (
            <div key={group.group}>
              <div className="flow-group">{t(group.group)}</div>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.type}
                  className="flow-pal-item"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', item.type)}
                >
                  <span className="flow-pal-ico"><Icon name={item.icon} size={15} /></span>
                  <span>{stepLabel(t, item.type, item.label)}</span>
                  <span className="flow-grip"><Icon name="grip" size={14} /></span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="flow-canvas" style={{ transform: `scale(${zoom})` }}>
          <StartCard onSetup={() => setStartOpen(true)} trigger={trigger} t={t} />
          <FlowLane from="start" graph={graph} t={t} insert={insert} remove={remove} setSetup={setSetup} />
        </div>
        <div className="flow-zoom">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))}>+</button>
        </div>
      </div>
      {startOpen ? (
        <Modal title={t('trigger')} onClose={() => setStartOpen(false)}>
          <TriggerFields form={trigger} setForm={setTrigger} />
          <div className="modal-actions"><Button onClick={() => setStartOpen(false)}>{t('save')}</Button></div>
        </Modal>
      ) : null}
      {selected ? (
        <Modal title={t(`wf_${selected.type}`) === `wf_${selected.type}` ? selected.type : t(`wf_${selected.type}`)} onClose={() => setSetup(null)}>
          <StepSetup
            node={selected}
            objectType={trigger.objectType}
            defs={properties.data?.data || []}
            onChange={(config) => setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => (node.id === selected.id ? { ...node, config } : node)) }))}
          />
          <div className="modal-actions"><Button onClick={() => setSetup(null)}>{t('save')}</Button></div>
        </Modal>
      ) : null}
    </div>
  )
}

function FlowLane({ from, when, graph, t, insert, remove, setSetup }) {
  const edges = outgoing(graph, from, when)
  return (
    <div className={`flow-lane ${when || ''}`}>
      {when ? <div className={`flow-when ${when}`}><i>{when === 'yes' ? '✓' : '–'}</i>{when === 'yes' ? t('yes') : t('no')}</div> : null}
      <Plus onAdd={(type) => insert(type, from, when)} />
      {edges.map((edge) => {
        const node = graph.nodes.find((row) => row.id === edge.to)
        if (!node) return null
        return (
          <div key={node.id} className="flow-step">
            <StepCard node={node} t={t} onSetup={() => setSetup(node.id)} onDelete={() => remove(node.id)} />
            {node.type === 'split' ? (
              <div className="flow-split">
                <FlowLane from={node.id} when="yes" graph={graph} t={t} insert={insert} remove={remove} setSetup={setSetup} />
                <FlowLane from={node.id} when="no" graph={graph} t={t} insert={insert} remove={remove} setSetup={setSetup} />
              </div>
            ) : (
              <FlowLane from={node.id} graph={graph} t={t} insert={insert} remove={remove} setSetup={setSetup} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function defaultConfig(type) {
  if (type === 'email') return { subject: '', body: '' }
  if (type === 'sms') return { body: '' }
  if (type === 'edit_record') return { fields: [{ key: 'status', source: 'native', value: '' }] }
  if (type === 'notification') return { title: '', body: '' }
  if (type === 'webhook') return { url: '' }
  if (type === 'create_task') return { title: '', assignRole: 'dispatcher' }
  if (type === 'delay') return { amount: 1, unit: 'days' }
  if (type === 'split') return { property: 'status', operator: 'equals', value: '' }
  return {}
}

function StartCard({ onSetup, trigger, t }) {
  return (
    <div className="flow-card">
      <div className="flow-card-top">
        <span className="flow-card-ico"><Icon name="play" size={15} /></span>
        <div className="flow-card-copy">
          <div className="flow-kicker">{t('trigger')}</div>
          <strong>{t('start')}</strong>
          <div className="flow-card-hint">{t(`type_${trigger.objectType}`)} · {t(`trig_${trigger.triggerEvent}`)}</div>
        </div>
      </div>
      <button type="button" className="flow-setup" onClick={onSetup}>{t('setUp')} {t('trigger')}</button>
    </div>
  )
}

function StepCard({ node, t, onSetup, onDelete }) {
  const label = stepLabel(t, node.type)
  return (
    <div className="flow-card">
      <div className="flow-card-top">
        <span className="flow-card-ico"><Icon name={STEP_ICON[node.type] || 'zap'} size={15} /></span>
        <div className="flow-card-copy">
          <div className="flow-kicker">{t(stepKind(node.type))}</div>
          <strong>{label}</strong>
        </div>
        <button type="button" className="flow-card-more" aria-label={t('remove')} onClick={onDelete}>×</button>
      </div>
      <button type="button" className="flow-setup" onClick={onSetup}>{t('setUp')} {label}</button>
    </div>
  )
}

function Plus({ onAdd }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  return (
    <div
      className="flow-plus"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); onAdd(event.dataTransfer.getData('text/plain')) }}
    >
      <span className="flow-wire" />
      <button type="button" onClick={() => setOpen((value) => !value)}>+</button>
      <span className="flow-wire" />
      {open ? (
        <div className="flow-plus-menu">
          {PALETTE.flatMap((group) => group.items).map((item) => (
            <button type="button" key={item.type} onClick={() => { onAdd(item.type); setOpen(false) }}>
              <Icon name={item.icon} size={14} />
              {stepLabel(t, item.type, item.label)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StepSetup({ node, objectType, defs, onChange }) {
  const { t } = useI18n()
  const config = node.config || {}
  function set(patch) { onChange({ ...config, ...patch }) }

  if (node.type === 'email') {
    return (
      <div className="form-grid">
        <Field label={t('title')} wide><input value={config.subject || ''} onChange={(event) => set({ subject: event.target.value })} /></Field>
        <Field label={t('writeMessage')} wide><textarea rows="4" value={config.body || ''} onChange={(event) => set({ body: event.target.value })} /></Field>
      </div>
    )
  }
  if (node.type === 'sms' || node.type === 'notification') {
    return (
      <div className="form-grid">
        {node.type === 'notification' ? <Field label={t('title')} wide><input value={config.title || ''} onChange={(event) => set({ title: event.target.value })} /></Field> : null}
        <Field label={t('writeMessage')} wide><textarea rows="4" value={config.body || ''} onChange={(event) => set({ body: event.target.value })} /></Field>
      </div>
    )
  }
  if (node.type === 'webhook') return <Field label="URL" wide><input value={config.url || ''} onChange={(event) => set({ url: event.target.value })} placeholder="https://" /></Field>
  if (node.type === 'create_task') {
    return (
      <div className="form-grid">
        <Field label={t('title')} wide><input value={config.title || ''} onChange={(event) => set({ title: event.target.value })} /></Field>
        <Field label={t('role')}><select value={config.assignRole || 'dispatcher'} onChange={(event) => set({ assignRole: event.target.value })}>{['owner', 'dispatcher', 'sales', 'finance'].map((role) => <option key={role} value={role}>{t(`role_${role}`)}</option>)}</select></Field>
      </div>
    )
  }
  if (node.type === 'delay') {
    return (
      <div className="form-grid">
        <Field label={t('amount')}><input type="number" min="1" value={config.amount || 1} onChange={(event) => set({ amount: Number(event.target.value) })} /></Field>
        <Field label={t('unit')}><select value={config.unit || 'days'} onChange={(event) => set({ unit: event.target.value })}><option value="hours">{t('hours')}</option><option value="days">{t('days')}</option></select></Field>
      </div>
    )
  }
  if (node.type === 'split') {
    return (
      <div className="form-grid">
        <Field label={t('property')}><input value={config.property || ''} onChange={(event) => set({ property: event.target.value })} /></Field>
        <Field label={t('operator')}>
          <select value={config.operator || 'equals'} onChange={(event) => set({ operator: event.target.value })}>
            <option value="equals">{t('equals')}</option>
            <option value="not_equals">{t('notEquals')}</option>
            <option value="contains">{t('contains')}</option>
            <option value="is_empty">{t('isEmpty')}</option>
            <option value="is_not_empty">{t('isNotEmpty')}</option>
          </select>
        </Field>
        <Field label={t('amount')} wide><input value={config.value || ''} onChange={(event) => set({ value: event.target.value })} /></Field>
      </div>
    )
  }
  if (node.type === 'edit_record') {
    const fields = config.fields || []
    const native = NATIVE[objectType] || []
    const custom = objectType === 'order' ? defs : []
    return (
      <div className="stack">
        {fields.map((field, index) => (
          <div className="form-grid" key={index}>
            <Field label={t('property')}>
              <select value={`${field.source}:${field.key}`} onChange={(event) => {
                const [source, key] = event.target.value.split(':')
                const next = fields.slice()
                next[index] = { ...field, source, key }
                set({ fields: next })
              }}>
                <optgroup label={t('native')}>
                  {native.map((key) => <option key={key} value={`native:${key}`}>{key}</option>)}
                </optgroup>
                {custom.length ? (
                  <optgroup label={t('custom')}>
                    {custom.map((def) => <option key={def.key} value={`custom:${def.key}`}>{def.name}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </Field>
            <Field label={t('becomes')}><input value={field.value || ''} onChange={(event) => { const next = fields.slice(); next[index] = { ...field, value: event.target.value }; set({ fields: next }) }} /></Field>
            <button type="button" className="detail-link" onClick={() => set({ fields: fields.filter((_, i) => i !== index) })}>{t('remove')}</button>
          </div>
        ))}
        <button type="button" className="dash-btn" onClick={() => set({ fields: [...fields, { key: native[0] || 'status', source: 'native', value: '' }] })}>{t('addPlus')}</button>
      </div>
    )
  }
  return <p className="quiet">{t('noneYet')}</p>
}

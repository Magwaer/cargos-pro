import { useState } from 'react'
import { api, useFetch } from '../api.js'
import { Button, ErrorNote, Field, Modal, PageHead, Pill } from '../components/ui.jsx'
import { day } from '../format.js'
import { useI18n } from '../i18n.jsx'

const VEHICLE_STATUSES = ['available', 'on_trip', 'maintenance']

function dateInput(value) {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text.slice(0, 10)) && !text.includes('T')) return text.slice(0, 10)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${dayOfMonth}`
}

function vehicleForm(row) {
  if (!row) return { kind: 'tractor', status: 'available' }
  return {
    plate: row.plate || '',
    kind: row.kind || 'tractor',
    status: row.status || 'available',
    capacityKg: row.capacity_kg ?? '',
    costPerKm: row.cost_per_km_cents ? Number(row.cost_per_km_cents) / 100 : '',
    location: row.location || '',
    insuranceExpires: dateInput(row.insurance_expires),
    inspectionExpires: dateInput(row.inspection_expires),
  }
}

function driverForm(row) {
  if (!row) return {}
  return {
    name: row.name || '',
    phone: row.phone || '',
    licenseNo: row.license_no || '',
    vehicleId: row.vehicle_id || '',
    userId: row.user_id || '',
    licenseExpires: dateInput(row.license_expires),
    adr: Boolean(row.adr),
  }
}

export default function Fleet() {
  const { t } = useI18n()
  const vehicles = useFetch('/api/vehicles')
  const drivers = useFetch('/api/drivers')
  const users = useFetch('/api/users')
  const [open, setOpen] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')

  function close() {
    setOpen(null)
    setEditingId(null)
  }

  function startVehicle(row) {
    setErr('')
    setForm(vehicleForm(row))
    setEditingId(row?.id || null)
    setOpen('vehicle')
  }

  function startDriver(row) {
    setErr('')
    setForm(driverForm(row))
    setEditingId(row?.id || null)
    setOpen('driver')
  }

  async function save(event) {
    event.preventDefault()
    setErr('')
    try {
      if (open === 'vehicle') {
        const body = {
          ...form,
          capacityKg: form.capacityKg === '' || form.capacityKg == null ? null : Number(form.capacityKg),
          costPerKmCents: Math.round(Number(form.costPerKm || 0) * 100),
          insuranceExpires: form.insuranceExpires || null,
          inspectionExpires: form.inspectionExpires || null,
        }
        await api(editingId ? `/api/vehicles/${editingId}` : '/api/vehicles', { method: editingId ? 'PATCH' : 'POST', body })
      } else {
        const body = {
          ...form,
          vehicleId: form.vehicleId || null,
          userId: form.userId || null,
          adr: Boolean(form.adr),
          licenseExpires: form.licenseExpires || null,
        }
        await api(editingId ? `/api/drivers/${editingId}` : '/api/drivers', { method: editingId ? 'PATCH' : 'POST', body })
      }
      vehicles.reload()
      drivers.reload()
      close()
    } catch (error) { setErr(error.message) }
  }

  const title = open === 'vehicle'
    ? (editingId ? t('editVehicle') : t('newVehicle'))
    : (editingId ? t('editDriver') : t('newDriver'))

  return (
    <div>
      <PageHead title={t('fleet')} lede="Plates, documents, and the drivers who sit in them.">
        <Button kind="ghost" onClick={() => startVehicle(null)}>{t('newVehicle')}</Button>
        <Button onClick={() => startDriver(null)}>{t('newDriver')}</Button>
      </PageHead>
      <ErrorNote>{vehicles.error || drivers.error}</ErrorNote>
      <div className="split">
        <div className="card">
          <h2>{t('vehicles')}</h2>
          <table>
            <thead><tr><th>{t('plate')}</th><th>{t('status')}</th><th>{t('role_driver')}</th><th>{t('insurance')}</th><th>{t('inspection')}</th><th></th></tr></thead>
            <tbody>
              {vehicles.data?.data?.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.plate}</strong><br /><span className="quiet">{row.kind} · {row.capacity_kg || '—'} kg</span></td>
                  <td><Pill value={row.status} /></td>
                  <td>{row.driver_name || '—'}</td>
                  <td>{day(row.insurance_expires)}</td>
                  <td>{day(row.inspection_expires)}</td>
                  <td className="right"><Button kind="ghost" className="small" type="button" onClick={() => startVehicle(row)}>{t('edit')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>{t('drivers')}</h2>
          <table>
            <thead><tr><th>{t('name')}</th><th>{t('truck')}</th><th>{t('license')}</th><th>ADR</th><th></th></tr></thead>
            <tbody>
              {drivers.data?.data?.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><br /><span className="quiet">{row.phone}</span></td>
                  <td>{row.plate || '—'}</td>
                  <td>{row.license_no}<br /><span className="quiet">{day(row.license_expires)}</span></td>
                  <td>{row.adr ? 'Yes' : 'No'}</td>
                  <td className="right"><Button kind="ghost" className="small" type="button" onClick={() => startDriver(row)}>{t('edit')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {open ? (
        <Modal title={title} onClose={close}>
          <form onSubmit={save}>
            <ErrorNote>{err}</ErrorNote>
            {open === 'vehicle' ? (
              <div className="form-grid">
                <Field label={t('plate')}><input value={form.plate || ''} onChange={(e) => setForm({ ...form, plate: e.target.value })} required /></Field>
                <Field label="Type"><input value={form.kind || ''} onChange={(e) => setForm({ ...form, kind: e.target.value })} /></Field>
                <Field label={t('status')}>
                  <select value={form.status || 'available'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{t(`st_${status}`)}</option>)}
                  </select>
                </Field>
                <Field label="Capacity kg"><input value={form.capacityKg ?? ''} onChange={(e) => setForm({ ...form, capacityKg: e.target.value })} /></Field>
                <Field label="Cost per km"><input value={form.costPerKm ?? ''} onChange={(e) => setForm({ ...form, costPerKm: e.target.value })} placeholder="0.95" /></Field>
                <Field label="Location"><input value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
                <Field label="Insurance expires"><input type="date" value={form.insuranceExpires || ''} onChange={(e) => setForm({ ...form, insuranceExpires: e.target.value })} /></Field>
                <Field label="Inspection expires"><input type="date" value={form.inspectionExpires || ''} onChange={(e) => setForm({ ...form, inspectionExpires: e.target.value })} /></Field>
              </div>
            ) : (
              <div className="form-grid">
                <Field label={t('name')} wide><input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
                <Field label="Phone"><input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label={t('license')}><input value={form.licenseNo || ''} onChange={(e) => setForm({ ...form, licenseNo: e.target.value })} /></Field>
                <Field label={t('truck')}><select value={form.vehicleId || ''} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}><option value="">—</option>{vehicles.data?.data?.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</select></Field>
                <Field label="Login"><select value={form.userId || ''} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">No app login</option>{users.data?.data?.filter((u) => u.role === 'driver').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                <Field label="License expires"><input type="date" value={form.licenseExpires || ''} onChange={(e) => setForm({ ...form, licenseExpires: e.target.value })} /></Field>
                <label className="check"><input type="checkbox" checked={Boolean(form.adr)} onChange={(e) => setForm({ ...form, adr: e.target.checked })} /> ADR</label>
              </div>
            )}
            <div className="modal-actions"><Button kind="ghost" type="button" onClick={close}>{t('cancel')}</Button><Button>{t('save')}</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

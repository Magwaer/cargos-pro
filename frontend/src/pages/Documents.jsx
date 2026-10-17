import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { downloadFile, useFetch } from '../api.js'
import { useInvoiceDrawer } from '../components/InvoiceDrawer.jsx'
import { ListCard, Sheet, fill, markColor } from '../components/RecordList.jsx'
import { when } from '../format.js'
import { useI18n } from '../i18n.jsx'

const KIND_DOT = {
  cmr: 'oklch(0.6 0.14 255)',
  pod: 'oklch(0.62 0.12 155)',
  customs: 'oklch(0.75 0.13 75)',
  insurance: 'oklch(0.6 0.14 295)',
  other: '#a9a8a1',
}
const KINDS = ['cmr', 'pod', 'customs', 'other']

function fileInitials(filename) {
  const letters = String(filename || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
  return letters || '?'
}

function recordPath(row) {
  if (row.object_type === 'order') return `/orders/${row.object_id}`
  if (row.object_type === 'company') return `/companies/${row.object_id}`
  return null
}

function typeLabel(t, type) {
  const key = `type_${type}`
  const label = t(key)
  return label === key ? type : label
}

export default function Documents() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { open } = useInvoiceDrawer()
  const { data, loading, error } = useFetch('/api/documents')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const documents = (data?.data || []).map((row, index) => ({ ...row, _i: index }))
  const q = query.trim().toLowerCase()
  const kinds = documents.some((row) => row.kind === 'insurance') ? [...KINDS.slice(0, 3), 'insurance', 'other'] : KINDS
  const rows = documents.filter((row) => (tab === 'all' || row.kind === tab) && (!q || `${row.filename} ${row.kind}`.toLowerCase().includes(q)))
  const tabs = [{ id: 'all', label: t('all') }, ...kinds.map((kind) => ({ id: kind, label: t(`kind_${kind}`) }))]
    .map((item) => ({ ...item, count: documents.filter((row) => item.id === 'all' || row.kind === item.id).length }))

  return (
    <Sheet title={t('documents')} lede={t('documentsLede')}>
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterFile')}
        columns="minmax(0,1.8fr) 130px 140px 180px 110px"
        minWidth={760}
        heads={[
          { key: 'file', label: t('file') },
          { key: 'kind', label: t('kind') },
          { key: 'record', label: t('record') },
          { key: 'added', label: t('added') },
          { key: 'download', label: '', align: 'right' },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        onRow={(row) => {
          if (row.object_type === 'invoice') { open(row.object_id); return }
          const path = recordPath(row)
          if (path) navigate(path)
        }}
        loading={loading}
        error={error}
        empty={q ? fill(t('noDocuments'), { query: query.trim() }) : t('emptyView')}
        renderRow={(row) => (
          <>
            <div className="sheet-id">
              <span className="sheet-avatar" style={{ background: markColor(row._i) }}>{fileInitials(row.filename)}</span>
              <span className="sheet-name">{row.filename}</span>
            </div>
            <div className="sheet-dotline"><span className="sheet-dot" style={{ background: KIND_DOT[row.kind] || '#a9a8a1' }} />{t(`kind_${row.kind}`) === `kind_${row.kind}` ? row.kind : t(`kind_${row.kind}`)}</div>
            <div>{typeLabel(t, row.object_type)}</div>
            <div className="sheet-mono">{when(row.created_at)}</div>
            <div className="sheet-right">
              <button type="button" className="sheet-mini" onClick={(event) => { event.stopPropagation(); downloadFile(`/api/documents/${row.id}/file`, row.filename) }}>{t('download')}</button>
            </div>
          </>
        )}
      />
    </Sheet>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFetch } from '../api.js'
import { ListCard, Sheet, fill } from '../components/RecordList.jsx'
import { Pill } from '../components/ui.jsx'
import { when } from '../format.js'
import { useI18n } from '../i18n.jsx'

function hrefFor(task) {
  if (task.object_type === 'order') return `/orders/${task.object_id}`
  if (task.object_type === 'company') return `/companies/${task.object_id}`
  if (task.object_type === 'contact') return `/contacts/${task.object_id}`
  if (task.object_type === 'invoice') return '/invoices'
  if (task.object_type === 'vehicle') return '/fleet'
  return '/tasks'
}

function statusOf(task) {
  if (task.done) return 'done'
  if (task.due_at && new Date(task.due_at).getTime() <= Date.now()) return 'overdue'
  return 'open'
}

export default function Tasks() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, loading, error } = useFetch('/api/activities?tasks=1')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const tasks = data?.data || []
  const q = query.trim().toLowerCase()
  const matched = tasks.filter((task) => {
    const status = statusOf(task)
    if (tab !== 'all' && status !== tab) return false
    if (!q) return true
    return `${task.title} ${task.object_label || ''} ${task.owner_name || ''}`.toLowerCase().includes(q)
  })
  const tabs = [
    { id: 'all', label: t('all') },
    { id: 'open', label: t('st_open') },
    { id: 'overdue', label: t('st_overdue') },
    { id: 'done', label: t('st_done') },
  ].map((item) => ({
    ...item,
    count: item.id === 'all' ? tasks.length : tasks.filter((task) => statusOf(task) === item.id).length,
  }))

  return (
    <Sheet title={t('tasks')} lede={t('tasksLede')}>
      <ListCard
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        filterPlaceholder={t('filterTask')}
        columns="minmax(0,2fr) 120px minmax(0,1fr) 140px 160px"
        heads={[
          { key: 'title', label: t('titleCol') },
          { key: 'status', label: t('status') },
          { key: 'record', label: t('record') },
          { key: 'owner', label: t('name') },
          { key: 'due', label: t('due') },
        ]}
        rows={matched}
        rowKey={(row) => row.id}
        onRow={(row) => navigate(hrefFor(row))}
        loading={loading}
        error={error}
        empty={q ? fill(t('noTasks'), { query: query.trim() }) : t('emptyView')}
        renderRow={(row) => {
          const status = statusOf(row)
          return (
            <>
              <div className="sheet-name">{row.title}</div>
              <Pill value={status} />
              <div className="sheet-ellipsis">{row.object_label || t(`type_${row.object_type}`)}</div>
              <div className="sheet-ellipsis">{row.owner_name || t('unassigned')}</div>
              <div className="sheet-mono">{row.due_at ? when(row.due_at) : '—'}</div>
            </>
          )
        }}
      />
    </Sheet>
  )
}

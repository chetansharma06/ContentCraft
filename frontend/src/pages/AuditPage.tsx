import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, FileClock, Search } from 'lucide-react'
import { listAudit } from '../api/client'
import type { AuditLog } from '../api/client'
import { Button, EmptyState, ErrorState, Input, Skeleton } from '../components/ui'
import { downloadTextFile, toCsv } from '../utils/download'

const actions = [
  'content.edited',
  'content.approved',
  'content.approval_undone',
  'content.rejected',
  'content.published',
  'publish.blocked',
  'publish.unavailable',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function displayAction(value: string) {
  return value.replaceAll('.', ' ').replaceAll('_', ' ')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function detailValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function AuditDiff({ details }: { details: Record<string, unknown> }) {
  const before = details.before
  const after = details.after
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    const changed = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    return <div className="audit-diff"><div className="audit-diff-heading"><span>FIELD</span><span>BEFORE</span><span>AFTER</span></div>{changed.map((key) => <div className="audit-diff-row" key={key}><strong>{key.replaceAll('_', ' ')}</strong><pre>{detailValue(before[key])}</pre><pre>{detailValue(after[key])}</pre></div>)}</div>
  }
  const entries = Object.entries(details)
  if (!entries.length) return <span className="audit-no-details">No additional details.</span>
  return <div className="audit-detail-list">{entries.map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><pre>{detailValue(value)}</pre></div>)}</div>
}

export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const action = searchParams.get('action') ?? ''
  const entityId = searchParams.get('entity_id') ?? ''
  const auditQuery = useQuery({
    queryKey: ['audit-events', action, entityId],
    queryFn: () => listAudit({ action: action || undefined, entity_id: entityId || undefined, limit: 200 }),
  })
  const events = auditQuery.data ?? []

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  function exportAudit() {
    const csv = toCsv(
      ['id', 'action', 'entity_type', 'entity_id', 'created_at', 'details'],
      events.map((event) => [event.id, event.action, event.entity_type, event.entity_id, event.created_at, JSON.stringify(event.details)]),
    )
    downloadTextFile('contentcraft-audit.csv', csv)
  }

  return (
    <section className="operations-page audit-page">
      <div className="operations-heading">
        <div><span className="eyebrow">WORKSPACE HISTORY</span><h1>Audit</h1><p>Trace approvals, edits, and publishing activity.</p></div>
        <Button variant="secondary" onClick={exportAudit} disabled={!events.length}><Download size={15} /> Export CSV</Button>
      </div>

      <div className="audit-toolbar">
        <label className="audit-filter"><span>Action</span><select aria-label="Filter audit by action" value={action} onChange={(event) => updateFilter('action', event.currentTarget.value)}><option value="">All actions</option>{actions.map((item) => <option key={item} value={item}>{displayAction(item)}</option>)}</select></label>
        <div className="audit-entity-filter"><Search size={15} /><Input label="Entity ID" aria-label="Filter by entity ID" placeholder="Filter entity ID" value={entityId} onChange={(event) => updateFilter('entity_id', event.currentTarget.value)} /></div>
        <span className="audit-result-count">{events.length} events</span>
      </div>

      {auditQuery.isError && <div className="operations-error"><ErrorState title="Audit history unavailable" description={auditQuery.error.message} onRetry={() => { void auditQuery.refetch() }} /></div>}
      {auditQuery.isLoading && <div className="operations-loading">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} variant="rect" />)}</div>}
      {auditQuery.isSuccess && events.length === 0 && <div className="operations-empty"><EmptyState icon={<FileClock size={18} />} title="No matching events" description="Change the action or entity filter to broaden the timeline." /></div>}
      {events.length > 0 && <div className="audit-timeline">{events.map((event: AuditLog) => <article className="audit-event" key={event.id}>
        <div className="audit-event-rail"><span className="audit-event-dot" /></div>
        <div className="audit-event-card">
          <div className="audit-event-header"><div><span className="audit-action-label">{displayAction(event.action)}</span><span className="audit-entity-label">{event.entity_type}{event.entity_id ? ` · ${event.entity_id}` : ''}</span></div><time>{formatDate(event.created_at)}</time></div>
          <AuditDiff details={event.details} />
        </div>
      </article>)}</div>}
    </section>
  )
}
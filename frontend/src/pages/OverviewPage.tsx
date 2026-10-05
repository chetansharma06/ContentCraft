import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, ArrowRight, CheckCheck, CircleAlert, Clock3, FileOutput, Sparkles } from 'lucide-react'
import { getOverview, type ContentStatus } from '../api/client'
import { Button, EmptyState, ErrorState, Skeleton } from '../components/ui'

const statusCards: Array<{ status: ContentStatus; label: string; tone: string }> = [
  { status: 'GENERATED', label: 'Generated', tone: 'neutral' },
  { status: 'QC_PASSED', label: 'QC passed', tone: 'passed' },
  { status: 'QC_FLAGGED', label: 'Flagged', tone: 'flagged' },
  { status: 'APPROVED', label: 'Approved', tone: 'approved' },
  { status: 'REJECTED', label: 'Rejected', tone: 'rejected' },
  { status: 'PUBLISHED', label: 'Published', tone: 'published' },
]

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function displayAction(value: string) {
  return value.replaceAll('.', ' ').replaceAll('_', ' ')
}

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: getOverview, refetchInterval: 20_000 })
  const data = overview.data
  const qcTotal = (data?.qc_passed ?? 0) + (data?.qc_flagged ?? 0)
  const passedPercent = qcTotal ? Math.round(((data?.qc_passed ?? 0) / qcTotal) * 100) : 0

  return (
    <section className="operations-page overview-page">
      <div className="operations-heading">
        <div><span className="eyebrow">WORKSPACE</span><h1>Overview</h1><p>Your content pipeline at a glance.</p></div>
        <span className="overview-updated"><span /> LIVE COUNTS</span>
      </div>

      {overview.isError && <div className="operations-error"><ErrorState title="Overview unavailable" description={overview.error.message} onRetry={() => { void overview.refetch() }} /></div>}
      {overview.isLoading && <div className="overview-loading">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="rect" />)}</div>}
      {data && <>
        <div className="overview-section-heading"><h2>Content by status</h2><Link to="/review">Open review queue <ArrowRight size={14} /></Link></div>
        <div className="status-count-grid">
          {statusCards.map(({ status, label, tone }) => <Link className={`status-count-card count-${tone}`} key={status} to={`/review?status=${status}`}>
            <span>{label}</span><strong>{data.status_counts[status] ?? 0}</strong><span className="count-link-label">View queue <ArrowRight size={12} /></span>
          </Link>)}
        </div>

        <div className="overview-lower-grid">
          <section className="overview-panel qc-ratio-panel">
            <div className="overview-panel-heading"><div><span className="panel-kicker">LATEST QC RESULTS</span><h2>Passed vs flagged</h2></div><Activity size={16} /></div>
            <div className="qc-ratio-numbers"><div><strong>{data.qc_passed}</strong><span>Passed</span></div><div><strong>{data.qc_flagged}</strong><span>Flagged</span></div><span className="qc-pass-rate">{passedPercent}% passed</span></div>
            <div className="qc-ratio-track" role="img" aria-label={`${data.qc_passed} QC passed and ${data.qc_flagged} QC flagged`}>
              <span className="qc-ratio-passed" style={{ width: `${passedPercent}%` }} />
              <span className="qc-ratio-flagged" style={{ width: `${100 - passedPercent}%` }} />
            </div>
            <div className="qc-ratio-links"><Link to="/review?status=QC_PASSED">Passed queue</Link><Link to="/review?status=QC_FLAGGED&flagged=true">Flagged queue</Link></div>
          </section>

          <section className="overview-panel jobs-panel">
            <div className="overview-panel-heading"><div><span className="panel-kicker">GENERATION</span><h2>Recent jobs</h2></div><Link to="/generate" aria-label="Open generation"><Sparkles size={15} /></Link></div>
            {data.recent_jobs.length ? <div className="overview-list">{data.recent_jobs.map((job) => <article className="overview-job" key={job.id}>
              <span className={`overview-job-icon ${job.status === 'completed' ? 'is-done' : job.status === 'failed' ? 'is-failed' : 'is-active'}`}>{job.status === 'completed' ? <CheckCheck size={15} /> : job.status === 'failed' ? <CircleAlert size={15} /> : <Clock3 size={15} />}</span>
              <div className="overview-job-copy"><strong>{job.product_name}</strong><span>Job #{job.id} · {job.status.replaceAll('_', ' ')}</span></div>
              <span className="overview-job-progress">{job.progress}%</span>
            </article>)}</div> : <EmptyState title="No generation jobs yet" description="Start a batch from your catalog to see progress here." action={<Button size="sm" onClick={() => { window.location.href = '/generate' }}>Start generation</Button>} />}
          </section>

          <section className="overview-panel events-panel">
            <div className="overview-panel-heading"><div><span className="panel-kicker">WORKSPACE HISTORY</span><h2>Recent events</h2></div><Link to="/audit" aria-label="Open audit log"><FileOutput size={15} /></Link></div>
            {data.recent_events.length ? <div className="overview-list">{data.recent_events.map((event) => <Link className="overview-event" to={`/audit?action=${encodeURIComponent(event.action)}`} key={event.id}>
              <span className="event-marker" />
              <div className="overview-event-copy"><strong>{displayAction(event.action)}</strong><span>{event.entity_type}{event.entity_id ? ` · ${event.entity_id}` : ''}</span></div>
              <time>{dateLabel(event.created_at)}</time>
            </Link>)}</div> : <EmptyState title="No events recorded" description="Approvals, edits, and exports will appear here." />}
          </section>
        </div>
      </>}
    </section>
  )
}
import type { ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from './button'

export type Status =
  | 'GENERATED'
  | 'QC_PASSED'
  | 'QC_FLAGGED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PUBLISHED'
  | 'SUPERSEDED'

const statusClass: Record<Status, string> = {
  GENERATED: 'status-generated',
  QC_PASSED: 'status-qc-passed',
  QC_FLAGGED: 'status-qc-flagged',
  IN_REVIEW: 'status-in-review',
  APPROVED: 'status-approved',
  REJECTED: 'status-rejected',
  PUBLISHED: 'status-published',
  SUPERSEDED: 'status-superseded',
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`ui-status-pill ${statusClass[status]}`} role="status">{status.replaceAll('_', ' ')}</span>
}

export function Skeleton({ variant = 'text', className = '' }: { variant?: 'text' | 'circle' | 'rect'; className?: string }) {
  return <span aria-hidden="true" className={`ui-skeleton ui-skeleton-${variant}${className ? ` ${className}` : ''}`} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="ui-state" role="status">
      {icon && <div className="ui-state-icon" aria-hidden="true">{icon}</div>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="ui-state-action">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string
  description: string
  onRetry?: () => void
}) {
  return (
    <div className="ui-state ui-error-state" role="alert">
      <div className="ui-state-icon"><AlertCircle size={20} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry && <div className="ui-state-action"><Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw size={14} /> Try again</Button></div>}
    </div>
  )
}
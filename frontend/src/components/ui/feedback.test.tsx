import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill, type Status } from './feedback'

const statuses: Status[] = [
  'GENERATED',
  'QC_PASSED',
  'QC_FLAGGED',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'SUPERSEDED',
]

describe('StatusPill', () => {
  it('renders all workflow states with their semantic classes', () => {
    render(<>{statuses.map((status) => <StatusPill key={status} status={status} />)}</>)

    expect(screen.getAllByRole('status')).toHaveLength(statuses.length)
    expect(screen.getByText('QC PASSED')).toHaveClass('status-qc-passed')
    expect(screen.getByText('IN REVIEW')).toHaveClass('status-in-review')
    expect(screen.getByText('SUPERSEDED')).toHaveClass('status-superseded')
  })
})
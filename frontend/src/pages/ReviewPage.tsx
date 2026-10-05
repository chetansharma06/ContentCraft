import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, CheckCheck, ChevronDown, Keyboard, X } from 'lucide-react'
import { approveContent, listContent, rejectContent, unapproveContent, type ContentListItem, type ContentStatus, type ListContentParams } from '../api/client'
import { Button, Dialog, EmptyState, ErrorState, Skeleton, StatusPill, Toast } from '../components/ui'

type SortColumn = 'created_at' | 'title' | 'status'
type ToastState = { title: string; description: string; tone: 'success' | 'error'; action?: { label: string; altText: string; onAction: () => void } }

const statuses: ContentStatus[] = ['GENERATED', 'QC_PASSED', 'QC_FLAGGED', 'APPROVED', 'REJECTED', 'PUBLISHED']
const languages = ['English', 'French', 'Spanish', 'German', 'Japanese']

function parseFilters(params: URLSearchParams): ListContentParams {
  const rawStatus = params.get('status')
  const rawFlagged = params.get('flagged')
  const rawSort = params.get('sort_by')
  const rawOrder = params.get('sort_order')
  return {
    status: statuses.includes(rawStatus as ContentStatus) ? rawStatus as ContentStatus : undefined,
    language: params.get('language') || undefined,
    content_type: params.get('type') || undefined,
    flagged: rawFlagged === 'true' ? true : rawFlagged === 'false' ? false : undefined,
    sort_by: rawSort === 'title' || rawSort === 'status' ? rawSort : 'created_at',
    sort_order: rawOrder === 'asc' ? 'asc' : 'desc',
    limit: 100,
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const urlState = searchParams.toString()
  const paramsRef = useRef(new URLSearchParams(searchParams))
  const filters = parseFilters(searchParams)
  const listQueryKey = ['review-content', urlState]
  const contentQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: () => listContent(filters),
    refetchInterval: 15_000,
  })
  const items = contentQuery.data ?? []
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectIds, setRejectIds] = useState<number[]>([])
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
  const [toast, setToast] = useState<ToastState>({ title: '', description: '', tone: 'success' })
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([])
  function showToast(nextToast: ToastState) {
    setToast(nextToast)
    setToastOpen(true)
  }

  function setCachedStatuses(ids: number[], status: ContentStatus, queryKey: readonly unknown[] = listQueryKey) {
    const idSet = new Set(ids)
    queryClient.setQueryData<ContentListItem[]>(queryKey, (rows) => rows?.map((item) => idSet.has(item.id) ? { ...item, approval_status: status } : item))
  }

  const undoMutation = useMutation({
    mutationFn: async (ids: number[]) => Promise.allSettled(ids.map((id) => unapproveContent(id))),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: listQueryKey })
      const previous = queryClient.getQueryData<ContentListItem[]>(listQueryKey)
      setCachedStatuses(ids, 'QC_PASSED')
      return { previous, queryKey: listQueryKey }
    },
    onSuccess: (results, ids, context) => {
      const revertedIds: number[] = []
      const failures: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') revertedIds.push(ids[index])
        else failures.push(errorMessage(result.reason))
      })
      const failedIds = new Set(ids.filter((id) => !revertedIds.includes(id)))
      if (failedIds.size) {
        queryClient.setQueryData<ContentListItem[]>(context?.queryKey ?? listQueryKey, (rows) => rows?.map((item) => failedIds.has(item.id) ? { ...item, approval_status: 'APPROVED' } : item))
      }
      showToast({
        title: revertedIds.length ? 'Approval undone' : 'Undo failed',
        description: revertedIds.length ? `${revertedIds.length} item${revertedIds.length === 1 ? '' : 's'} returned to review.` : failures.join(' '),
        tone: revertedIds.length ? 'success' : 'error',
      })
      void queryClient.invalidateQueries({ queryKey: ['review-content'] })
    },
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous)
      showToast({ title: 'Undo failed', description: errorMessage(error), tone: 'error' })
    },
  })

  const approveMutation = useMutation({
    mutationFn: async (ids: number[]) => Promise.allSettled(ids.map((id) => approveContent(id))),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: listQueryKey })
      const previous = queryClient.getQueryData<ContentListItem[]>(listQueryKey)
      setCachedStatuses(ids, 'APPROVED')
      return { previous, queryKey: listQueryKey }
    },
    onSuccess: (results, ids, context) => {
      const approvedIds: number[] = []
      const failures: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') approvedIds.push(ids[index])
        else failures.push(errorMessage(result.reason))
      })
      const failedIds = new Set(ids.filter((id) => !approvedIds.includes(id)))
      if (failedIds.size) {
        const previousById = new Map((context?.previous ?? []).map((item) => [item.id, item] as const))
        queryClient.setQueryData<ContentListItem[]>(context?.queryKey ?? listQueryKey, (rows) => rows?.map((item) => failedIds.has(item.id) ? previousById.get(item.id) ?? item : item))
      }
      setSelectedIds((current) => new Set([...current].filter((id) => !approvedIds.includes(id))))
      showToast({
        title: approvedIds.length ? 'Content approved' : 'Approval failed',
        description: approvedIds.length ? `${approvedIds.length} item${approvedIds.length === 1 ? '' : 's'} approved.` : failures.join(' '),
        tone: approvedIds.length ? 'success' : 'error',
        action: approvedIds.length ? { label: 'Undo', altText: 'Undo content approval', onAction: () => undoMutation.mutate(approvedIds) } : undefined,
      })
      void queryClient.invalidateQueries({ queryKey: ['review-content'] })
    },
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous)
      showToast({ title: 'Approval failed', description: errorMessage(error), tone: 'error' })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: number[]; reason: string }) => Promise.allSettled(ids.map((id) => rejectContent(id, { reason }))),
    onSuccess: (results, variables) => {
      const rejectedIds: number[] = []
      const failures: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') rejectedIds.push(variables.ids[index])
        else failures.push(errorMessage(result.reason))
      })
      setCachedStatuses(rejectedIds, 'REJECTED')
      setSelectedIds((current) => new Set([...current].filter((id) => !rejectedIds.includes(id))))
      setRejectOpen(false)
      setRejectReason('')
      setRejectError('')
      showToast({
        title: rejectedIds.length ? 'Content rejected' : 'Rejection failed',
        description: rejectedIds.length ? `${rejectedIds.length} item${rejectedIds.length === 1 ? '' : 's'} rejected.${failures.length ? ` ${failures.length} could not be rejected.` : ''}` : failures.join(' '),
        tone: rejectedIds.length ? 'success' : 'error',
      })
      void queryClient.invalidateQueries({ queryKey: ['review-content'] })
    },
  })

  useLayoutEffect(() => {
    paramsRef.current = new URLSearchParams(searchParams)
  }, [urlState])

  useEffect(() => {
    setSelectedIds(new Set())
    setActiveIndex(0)
  }, [urlState])

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(paramsRef.current)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('offset')
    paramsRef.current = next
    setSearchParams(next)
  }

  function changeSort(column: SortColumn) {
    const next = new URLSearchParams(paramsRef.current)
    const direction = next.get('sort_by') === column && next.get('sort_order') === 'asc' ? 'desc' : 'asc'
    next.set('sort_by', column)
    next.set('sort_order', direction)
    paramsRef.current = next
    setSearchParams(next)
  }

  function selectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(items.map((item) => item.id)) : new Set())
  }

  function openRejectDialog(ids: number[]) {
    const eligibleIds = ids.filter((id) => {
      const item = items.find((entry) => entry.id === id)
      return item && item.approval_status !== 'PUBLISHED' && item.approval_status !== 'REJECTED'
    })
    if (!eligibleIds.length) return
    setRejectIds(eligibleIds)
    setRejectReason('')
    setRejectError('')
    setRejectOpen(true)
  }

  function approveTargets() {
    const targets = selectedIds.size ? items.filter((item) => selectedIds.has(item.id)) : items[activeIndex] ? [items[activeIndex]] : []
    const eligible = targets.filter((item) => item.approval_status === 'QC_PASSED').map((item) => item.id)
    if (eligible.length) approveMutation.mutate(eligible)
  }

  function rejectTargets() {
    const targets = selectedIds.size ? [...selectedIds] : items[activeIndex] ? [items[activeIndex].id] : []
    openRejectDialog(targets)
  }

  function moveActive(delta: number) {
    if (!items.length) return
    const nextIndex = Math.max(0, Math.min(items.length - 1, activeIndex + delta))
    setActiveIndex(nextIndex)
    rowRefs.current[nextIndex]?.focus()
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest('input, select, textarea, button, [role="dialog"], [contenteditable="true"]')) return
      if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        moveActive(1)
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        moveActive(-1)
      } else if (event.key === 'Enter') {
        const activeItem = items[activeIndex]
        if (activeItem) {
          event.preventDefault()
          navigate(`/review/${activeItem.id}${urlState ? `?${urlState}` : ''}`)
        }
      } else if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        approveTargets()
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        rejectTargets()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, items, selectedIds, navigate, urlState])

  const selectedRows = items.filter((item) => selectedIds.has(item.id))
  const approvableCount = selectedRows.filter((item) => item.approval_status === 'QC_PASSED').length
  const rejectableCount = selectedRows.filter((item) => item.approval_status !== 'PUBLISHED' && item.approval_status !== 'REJECTED').length
  const allSelected = items.length > 0 && selectedIds.size === items.length && items.every((item) => selectedIds.has(item.id))
  const sortBy = filters.sort_by ?? 'created_at'
  const sortOrder = filters.sort_order ?? 'desc'

  function sortState(column: SortColumn) {
    return sortBy === column ? sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'
  }

  function sortHeader(label: string, column: SortColumn) {
    const direction = sortState(column)
    return <th scope="col" aria-sort={direction}><button type="button" onClick={() => changeSort(column)}>{label}<ChevronDown size={13} className={direction === 'ascending' ? 'sort-asc' : ''} /></button></th>
  }

  function submitReject() {
    const reason = rejectReason.trim()
    if (!reason) {
      setRejectError('Add a rejection reason before continuing.')
      return
    }
    rejectMutation.mutate({ ids: rejectIds, reason })
  }

  return (
    <section className="workflow-page review-page">
      <div className="workflow-heading review-heading">
        <div><span className="eyebrow">QUALITY CONTROL</span><h1>Review</h1><p>Inspect generated content and move ready items forward.</p></div>
        <Button variant="secondary" size="sm" onClick={() => setShortcutsOpen(true)}><Keyboard size={14} /> Shortcuts <span className="shortcut-key">?</span></Button>
      </div>

      <div className="review-filter-bar" aria-label="Review filters">
        <label className="review-filter"><span>Status</span><select aria-label="Filter by status" value={filters.status ?? ''} onChange={(event) => updateFilter('status', event.currentTarget.value)}><option value="">All statuses</option>{statuses.map((status) => <option value={status} key={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
        <label className="review-filter"><span>Language</span><select aria-label="Filter by language" value={filters.language ?? ''} onChange={(event) => updateFilter('language', event.currentTarget.value)}><option value="">All languages</option>{languages.map((language) => <option value={language} key={language}>{language}</option>)}</select></label>
        <label className="review-filter"><span>Type</span><select aria-label="Filter by content type" value={filters.content_type ?? ''} onChange={(event) => updateFilter('type', event.currentTarget.value)}><option value="">All types</option><option value="product_description">Product description</option></select></label>
        <label className="review-filter"><span>Flagged</span><select aria-label="Filter by flagged state" value={filters.flagged === undefined ? '' : String(filters.flagged)} onChange={(event) => updateFilter('flagged', event.currentTarget.value)}><option value="">Any</option><option value="true">Flagged only</option><option value="false">Not flagged</option></select></label>
        <div className="review-filter-spacer" />
        {selectedIds.size > 0 && <div className="review-bulk-actions"><span>{selectedIds.size} selected</span><Button size="sm" onClick={approveTargets} disabled={!approvableCount || approveMutation.isPending}><Check size={14} /> Approve {approvableCount || ''}</Button><Button size="sm" variant="danger" onClick={() => openRejectDialog([...selectedIds])} disabled={!rejectableCount || rejectMutation.isPending}><X size={14} /> Reject {rejectableCount || ''}</Button></div>}
        <span className="review-total">{contentQuery.data?.length ?? 0} items</span>
      </div>

      {contentQuery.isError && <div className="review-state"><ErrorState title="Review queue unavailable" description={errorMessage(contentQuery.error)} onRetry={() => { void contentQuery.refetch() }} /></div>}
      {contentQuery.isLoading && <div className="review-loading" aria-label="Loading review queue">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} variant="text" />)}</div>}
      {contentQuery.isSuccess && items.length === 0 && <div className="review-state"><EmptyState icon={<CheckCheck size={19} />} title="No content matches these filters" description="Change or clear a filter to see more generated content." /></div>}
      {contentQuery.isSuccess && items.length > 0 && <div className="review-table-wrap">
        <table className="review-table">
          <caption className="ui-sr-only">Content review queue. Use J and K to move between rows.</caption>
          <thead><tr>
            <th scope="col" className="review-select-cell"><input type="checkbox" aria-label="Select all review items" checked={allSelected} onChange={(event) => selectAll(event.currentTarget.checked)} /></th>
            {sortHeader('Content', 'title')}
            <th scope="col">Type</th><th scope="col">Language</th>
            {sortHeader('Status', 'status')}
            {sortHeader('Created', 'created_at')}
          </tr></thead>
          <tbody>{items.map((item, index) => <tr
            key={item.id}
            ref={(element) => { rowRefs.current[index] = element }}
            tabIndex={index === activeIndex ? 0 : -1}
            aria-current={index === activeIndex ? 'true' : undefined}
            className={index === activeIndex ? 'is-active' : ''}
            onFocus={() => setActiveIndex(index)}
            onClick={() => setActiveIndex(index)}
          >
            <td className="review-select-cell"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selectedIds.has(item.id)} onChange={(event) => { const checked = event.currentTarget.checked; setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next }) }} /></td>
            <td className="review-content-cell"><button type="button" onClick={() => navigate(`/review/${item.id}${urlState ? `?${urlState}` : ''}`)}>{item.title}</button><span>{item.body}</span></td>
            <td><span className="review-type">{item.content_type.replaceAll('_', ' ')}</span></td>
            <td>{item.language ?? <span className="review-muted">Unknown</span>}</td>
            <td><StatusPill status={item.approval_status} /></td>
            <td className="review-date">{formatDate(item.created_at)}</td>
          </tr>)}</tbody>
        </table>
      </div>}

      <div className="review-footer"><span>J / K MOVE&nbsp;&nbsp; ENTER OPEN&nbsp;&nbsp; A APPROVE&nbsp;&nbsp; R REJECT</span><span>FILTERS SYNCED TO URL</span></div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard shortcuts" description="Keep the review queue moving without leaving the keyboard.">
        <div className="shortcut-list"><div><kbd>J</kbd><span>Move to the next item</span></div><div><kbd>K</kbd><span>Move to the previous item</span></div><div><kbd>Enter</kbd><span>Open the focused item</span></div><div><kbd>A</kbd><span>Approve focused or selected QC-passed items</span></div><div><kbd>R</kbd><span>Reject focused or selected items</span></div><div><kbd>?</kbd><span>Show this shortcut guide</span></div></div>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen} title={`Reject ${rejectIds.length} item${rejectIds.length === 1 ? '' : 's'}`} description="Add a reason to include in the review audit trail.">
        <label className="review-reason-label" htmlFor="reject-reason">Reason</label>
        <textarea id="reject-reason" className="review-reason" value={rejectReason} maxLength={2000} rows={4} aria-invalid={Boolean(rejectError)} aria-describedby={rejectError ? 'reject-reason-error' : undefined} onChange={(event) => { setRejectReason(event.currentTarget.value); setRejectError('') }} />
        {rejectError && <span id="reject-reason-error" className="review-reason-error">{rejectError}</span>}
        <div className="review-reject-footer"><Button variant="secondary" onClick={() => setRejectOpen(false)}>Cancel</Button><Button variant="danger" onClick={submitReject} loading={rejectMutation.isPending}>Confirm rejection</Button></div>
      </Dialog>

      <Toast open={toastOpen} onOpenChange={setToastOpen} title={toast.title} description={toast.description} tone={toast.tone} action={toast.action} />
    </section>
  )
}
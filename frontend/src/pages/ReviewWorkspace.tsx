import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, History, Save, ShieldCheck, X } from 'lucide-react'
import { approveContent, editContent, getContent, getProduct, listContent, rejectContent, type ContentDetail, type ContentListItem, type Product } from '../api/client'
import { Button, Dialog, Drawer, EmptyState, ErrorState, Skeleton, StatusPill, Toast } from '../components/ui'

type Severity = 'critical' | 'review' | 'advisory'
type IssueGroup = { severity: Severity; label: string; issues: string[] }

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightRanges(text: string, bannedTerms: string[], prohibitedClaims: string[]) {
  const sources = [
    ...bannedTerms.map((term) => `(?<!\\w)${escapeRegExp(term)}(?!\\w)`),
    ...prohibitedClaims.map((claim) => claim.replace(/^\(\?i\)/, '')),
  ].filter(Boolean)
  const ranges: Array<[number, number]> = []
  for (const source of sources) {
    try {
      const expression = new RegExp(source, 'gi')
      for (const match of text.matchAll(expression)) {
        if (match.index !== undefined) ranges.push([match.index, match.index + match[0].length])
      }
    } catch {
      continue
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges) {
    const previous = merged.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }
  const parts: Array<{ text: string; marked: boolean }> = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), marked: false })
    parts.push({ text: text.slice(start, end), marked: true })
    cursor = end
  }
  if (cursor < text.length || parts.length === 0) parts.push({ text: text.slice(cursor), marked: false })
  return parts
}

function severityFor(issue: string): Severity {
  const normalized = issue.toLowerCase()
  if (/banned brand|prohibited claim|not supported by product facts|does not match product facts/.test(normalized)) return 'critical'
  if (/seo|keyword stuffing|keyword coverage/.test(normalized)) return 'advisory'
  return 'review'
}

function issueGroups(issues: string[]): IssueGroup[] {
  return [
    { severity: 'critical', label: 'Critical', issues: issues.filter((issue) => severityFor(issue) === 'critical') },
    { severity: 'review', label: 'Needs review', issues: issues.filter((issue) => severityFor(issue) === 'review') },
    { severity: 'advisory', label: 'Advisory', issues: issues.filter((issue) => severityFor(issue) === 'advisory') },
  ]
}

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function ReviewWorkspace() {
  const params = useParams()
  const contentId = Number(params.id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState({ title: '', body: '' })
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [variantAId, setVariantAId] = useState<number | null>(null)
  const [variantBId, setVariantBId] = useState<number | null>(null)
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState({ title: '', description: '', tone: 'success' as 'success' | 'error' })
  const titleHighlightRef = useRef<HTMLDivElement>(null)
  const bodyHighlightRef = useRef<HTMLDivElement>(null)
  const detailQuery = useQuery<ContentDetail>({
    queryKey: ['content-detail', contentId],
    queryFn: () => getContent(contentId),
    enabled: Number.isInteger(contentId) && contentId > 0,
  })
  const detail = detailQuery.data
  const productQuery = useQuery<Product>({
    queryKey: ['source-product', detail?.product_id],
    queryFn: () => getProduct(detail!.product_id),
    enabled: Boolean(detail?.product_id),
  })
  const variantsQuery = useQuery<ContentListItem[]>({
    queryKey: ['content-variants', detail?.product_id],
    queryFn: () => listContent({ product_id: detail!.product_id, limit: 100 }),
    enabled: Boolean(detail?.product_id),
  })
  const siblings = variantsQuery.data ?? []

  useEffect(() => {
    if (!detail) return
    setDraft({ title: detail.title, body: detail.body })
  }, [detail?.id, detail?.version])

  useEffect(() => {
    if (!siblings.length) return
    setVariantAId((current) => current && siblings.some((item) => item.id === current) ? current : contentId)
    setVariantBId((current) => current && siblings.some((item) => item.id === current) ? current : siblings.find((item) => item.id !== contentId)?.id ?? null)
  }, [siblings, contentId])

  const dirty = Boolean(detail && (draft.title !== detail.title || draft.body !== detail.body))
  const titleOverLimit = draft.title.length > 100
  const bodyOverLimit = draft.body.length > 2000
  const invalidDraft = !draft.title.trim() || !draft.body.trim() || titleOverLimit || bodyOverLimit
  const returnToQueue = `/review${searchParams.size ? `?${searchParams.toString()}` : ''}`

  function confirmLeave() {
    if (!dirty) return true
    const discard = window.confirm('You have unsaved changes. Leave this review item and discard them?')
    if (discard && detail) setDraft({ title: detail.title, body: detail.body })
    return discard
  }

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const beforeLinkNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const link = event.target.closest('a[href]')
      if (!link || link.getAttribute('target') === '_blank') return
      const destination = new URL((link as HTMLAnchorElement).href, window.location.href)
      if (destination.origin !== window.location.origin) return
      if (!window.confirm('You have unsaved changes. Leave this review item and discard them?')) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLinkNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLinkNavigation, true)
    }
  }, [dirty])

  function showToast(title: string, description: string, tone: 'success' | 'error' = 'success') {
    setToastMessage({ title, description, tone })
    setToastOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => editContent(contentId, { title: draft.title, body: draft.body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['content-detail', contentId], updated)
      queryClient.setQueriesData<ContentListItem[]>({ queryKey: ['review-content'] }, (items) => items?.map((item) => item.id === contentId ? { ...item, title: updated.title, body: updated.body, version: updated.version, approval_status: updated.approval_status } : item))
      setDraft({ title: updated.title, body: updated.body })
      showToast('Changes saved', `Version ${updated.version} is ready for review.`)
      void queryClient.invalidateQueries({ queryKey: ['review-content'] })
      void queryClient.invalidateQueries({ queryKey: ['content-variants', updated.product_id] })
    },
    onError: (error) => showToast('Save failed', messageFor(error), 'error'),
  })

  const approveMutation = useMutation({
    mutationFn: () => approveContent(contentId),
    onSuccess: (result) => {
      queryClient.setQueryData<ContentDetail>(['content-detail', contentId], (current) => current ? { ...current, approval_status: result.status } : current)
      queryClient.setQueriesData<ContentListItem[]>({ queryKey: ['review-content'] }, (items) => items?.map((item) => item.id === contentId ? { ...item, approval_status: result.status } : item))
      showToast('Content approved', 'This version is approved for publishing.')
    },
    onError: (error) => showToast('Approval failed', messageFor(error), 'error'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectContent(contentId, { reason: rejectNote.trim() }),
    onSuccess: (result) => {
      queryClient.setQueryData<ContentDetail>(['content-detail', contentId], (current) => current ? { ...current, approval_status: result.status } : current)
      queryClient.setQueriesData<ContentListItem[]>({ queryKey: ['review-content'] }, (items) => items?.map((item) => item.id === contentId ? { ...item, approval_status: result.status } : item))
      setRejectOpen(false)
      setRejectNote('')
      setRejectError('')
      showToast('Content rejected', 'The reason was added to the audit trail.')
    },
    onError: (error) => showToast('Rejection failed', messageFor(error), 'error'),
  })

  function approve() {
    if (!confirmLeave() || !detail || detail.approval_status !== 'QC_PASSED') return
    approveMutation.mutate()
  }

  function submitReject() {
    if (!rejectNote.trim()) {
      setRejectError('Add a rejection note before continuing.')
      return
    }
    rejectMutation.mutate()
  }

  const bannedTerms = detail?.qc_rules.banned_brand_terms ?? []
  const prohibitedClaims = detail?.qc_rules.prohibited_claims ?? []
  const titleParts = highlightRanges(draft.title, bannedTerms, prohibitedClaims)
  const bodyParts = highlightRanges(draft.body, bannedTerms, prohibitedClaims)
  const matchedTermCount = titleParts.filter((part) => part.marked).length + bodyParts.filter((part) => part.marked).length
  const qcIssues = detail?.latest_qc?.issues ?? []
  const groups = issueGroups(qcIssues)
  const variantA = siblings.find((item) => item.id === variantAId)
  const variantB = siblings.find((item) => item.id === variantBId)

  if (detailQuery.isLoading) return <section className="review-workspace-loading"><Skeleton variant="text" /><Skeleton variant="rect" /><Skeleton variant="text" /></section>
  if (detailQuery.isError || !detail) return <section className="review-workspace-error"><ErrorState title="Review item unavailable" description={detailQuery.error ? messageFor(detailQuery.error) : 'This content item could not be found.'} onRetry={() => { void detailQuery.refetch() }} /><Button variant="secondary" onClick={() => navigate(returnToQueue)}>Back to review queue</Button></section>

  return (
    <section className="review-workspace">
      <header className="review-workspace-header">
        <div className="review-workspace-title-row">
          <Button variant="ghost" size="icon" aria-label="Back to review queue" onClick={() => { if (confirmLeave()) navigate(returnToQueue) }}><ArrowLeft size={17} /></Button>
          <div className="review-workspace-title"><span className="eyebrow">CONTENT REVIEW / #{detail.id}</span><h1>{detail.title}</h1></div>
          <StatusPill status={detail.approval_status} />
        </div>
        <div className="review-workspace-actions">
          {dirty && <span className="unsaved-label">Unsaved changes</span>}
          <Button variant="secondary" onClick={() => setVersionsOpen(true)}><History size={15} /> Versions <span className="version-count">{detail.versions.length}</span></Button>
          <Button variant="danger" onClick={() => { if (confirmLeave()) setRejectOpen(true) }} disabled={detail.approval_status === 'REJECTED' || detail.approval_status === 'PUBLISHED'}><X size={15} /> Reject</Button>
          <Button onClick={approve} loading={approveMutation.isPending} disabled={dirty || detail.approval_status !== 'QC_PASSED'}><Check size={15} /> Approve</Button>
        </div>
      </header>

      <div className="review-workspace-grid">
        <aside className="workspace-panel source-panel">
          <div className="workspace-panel-heading"><div><span className="panel-kicker">SOURCE / {productQuery.data ? `#${productQuery.data.id}` : 'PRODUCT'}</span><h2>Product facts</h2></div><ShieldCheck size={16} /></div>
          {productQuery.isLoading && <div className="workspace-panel-loading"><Skeleton variant="text" /><Skeleton variant="text" /><Skeleton variant="rect" /></div>}
          {productQuery.isError && <ErrorState title="Source unavailable" description={messageFor(productQuery.error)} onRetry={() => { void productQuery.refetch() }} />}
          {productQuery.data && <ProductSource product={productQuery.data} />}
          <div className="source-generation-meta"><span>Language</span><strong>{detail.language ?? 'Unknown'}</strong><span>Variant</span><strong>{detail.generation_context.variant ?? 'Default'}</strong><span>Tone</span><strong>{detail.generation_context.tone ?? 'Default'}</strong></div>
        </aside>

        <main className="workspace-panel editor-panel">
          <div className="workspace-panel-heading"><div><span className="panel-kicker">PRODUCT DESCRIPTION / V{detail.version}</span><h2>Edit content</h2></div><span className="editor-save-state">{dirty ? 'Draft not saved' : `Saved ${formatVersionDate(detail.versions[0]?.created_at ?? detail.created_at)}`}</span></div>
          {matchedTermCount > 0 && <div className="inline-warning" role="alert"><X size={14} /><span>{matchedTermCount} prohibited term match{matchedTermCount === 1 ? '' : 'es'} highlighted below.</span></div>}
          <label className="editor-label" htmlFor="review-title">Title <span className={titleOverLimit ? 'counter-over' : ''}>{draft.title.length} / 100</span></label>
          <div className={`highlight-editor title-editor${titleOverLimit ? ' editor-over-limit' : ''}`}>
            <div ref={titleHighlightRef} className="highlight-layer" aria-hidden="true">{titleParts.map((part, index) => part.marked ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</div>
            <textarea id="review-title" aria-label="Content title" rows={2} value={draft.title} onScroll={(event) => { if (titleHighlightRef.current) titleHighlightRef.current.scrollTop = event.currentTarget.scrollTop }} onChange={(event) => { const title = event.currentTarget.value; setDraft((current) => ({ ...current, title })) }} />
          </div>
          {titleOverLimit && <p className="field-limit-error" role="alert">Title exceeds the 100-character limit by {draft.title.length - 100} characters.</p>}
          {!draft.title.trim() && <p className="field-limit-error" role="alert">Title is required.</p>}

          <label className="editor-label body-label" htmlFor="review-body">Description <span className={bodyOverLimit ? 'counter-over' : ''}>{draft.body.length} / 2,000</span></label>
          <div className={`highlight-editor body-editor${bodyOverLimit ? ' editor-over-limit' : ''}`}>
            <div ref={bodyHighlightRef} className="highlight-layer" aria-hidden="true">{bodyParts.map((part, index) => part.marked ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</div>
            <textarea id="review-body" aria-label="Content description" value={draft.body} onScroll={(event) => { if (bodyHighlightRef.current) bodyHighlightRef.current.scrollTop = event.currentTarget.scrollTop }} onChange={(event) => { const body = event.currentTarget.value; setDraft((current) => ({ ...current, body })) }} />
          </div>
          {bodyOverLimit && <p className="field-limit-error" role="alert">Description exceeds the 2,000-character limit by {draft.body.length - 2000} characters.</p>}
          {!draft.body.trim() && <p className="field-limit-error" role="alert">Description is required.</p>}

          <div className="editor-footer"><span>CHANGES CREATE A NEW CONTENT VERSION AND RUN QC AGAIN</span><Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!dirty || invalidDraft}><Save size={15} /> Save changes</Button></div>
          {saveMutation.isError && <p className="save-error" role="alert">{messageFor(saveMutation.error)}</p>}
        </main>

        <aside className="workspace-panel qc-panel">
          <div className="workspace-panel-heading"><div><span className="panel-kicker">QUALITY CONTROL</span><h2>QC checklist</h2></div>{detail.latest_qc?.score !== null && detail.latest_qc?.score !== undefined && <span className="qc-score">{Math.round(detail.latest_qc.score)}%</span>}</div>
          <div className="qc-summary"><StatusPill status={detail.approval_status} /><span>{detail.latest_qc ? `Checked ${formatVersionDate(detail.latest_qc.checked_at)}` : 'No saved QC run'}</span></div>
          {groups.map((group) => <section key={group.severity} className={`qc-severity-group severity-${group.severity}`}>
            <div className="qc-group-heading"><h3>{group.label}</h3><span>{group.issues.length || 'OK'}</span></div>
            {group.issues.length ? <ul>{group.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul> : <p>{group.severity === 'critical' ? 'No blocked terms or unsupported claims.' : group.severity === 'review' ? 'No structural or factual issues recorded.' : 'No advisory issues recorded.'}</p>}
          </section>)}
          {matchedTermCount > 0 && <p className="qc-live-warning">Current draft contains {matchedTermCount} highlighted term match{matchedTermCount === 1 ? '' : 'es'}.</p>}
        </aside>
      </div>

      <section className="workspace-panel variant-comparison">
        <div className="workspace-panel-heading"><div><span className="panel-kicker">SAME PRODUCT / VARIANT COMPARISON</span><h2>A/B variants</h2></div><span className="variant-total-label">{siblings.length} versions found</span></div>
        {variantsQuery.isLoading && <div className="variant-loading"><Skeleton variant="rect" /><Skeleton variant="rect" /></div>}
        {variantsQuery.isError && <ErrorState title="Variants unavailable" description={messageFor(variantsQuery.error)} onRetry={() => { void variantsQuery.refetch() }} />}
        {siblings.length < 2 && variantsQuery.isSuccess && <EmptyState title="Only one variant exists" description="Generate another tone or angle for this product to compare copy side by side." />}
        {siblings.length > 1 && <div className="variant-compare-grid">
          <VariantCard label="Variant A" selectedId={variantAId} variants={siblings} onChange={setVariantAId} item={variantA} />
          <VariantCard label="Variant B" selectedId={variantBId} variants={siblings} onChange={setVariantBId} item={variantB} />
        </div>}
      </section>

      <Drawer open={versionsOpen} onOpenChange={setVersionsOpen} title="Version history" description={`${detail.versions.length} saved version${detail.versions.length === 1 ? '' : 's'} for this content.`}>
        <div className="version-history-list">{[...detail.versions].sort((a, b) => b.version - a.version).map((version) => (
          <article className={`version-history-item${version.version === detail.version ? ' is-current' : ''}`} key={version.version}>
            <div className="version-history-top"><span className="version-number">VERSION {version.version}</span>{version.version === detail.version && <span className="current-version-label">CURRENT</span>}</div>
            <time>{formatVersionDate(version.created_at)}</time>
            <h3>{String(version.snapshot.title ?? 'Untitled')}</h3>
            <p>{String(version.snapshot.body ?? '')}</p>
          </article>
        ))}</div>
      </Drawer>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen} title="Reject content" description="Add a short note so the author knows what to revise.">
        <label className="workspace-reject-label" htmlFor="workspace-reject-note">Rejection note</label>
        <textarea id="workspace-reject-note" className="workspace-reject-note" rows={4} maxLength={2000} value={rejectNote} aria-invalid={Boolean(rejectError)} onChange={(event) => { setRejectNote(event.currentTarget.value); setRejectError('') }} />
        {rejectError && <p className="field-limit-error" role="alert">{rejectError}</p>}
        <div className="workspace-reject-actions"><Button variant="secondary" onClick={() => setRejectOpen(false)}>Cancel</Button><Button variant="danger" onClick={submitReject} loading={rejectMutation.isPending}>Confirm rejection</Button></div>
      </Dialog>

      <Toast open={toastOpen} onOpenChange={setToastOpen} title={toastMessage.title} description={toastMessage.description} tone={toastMessage.tone} />
    </section>
  )
}

function ProductSource({ product }: { product: Product }) {
  return (
    <div className="source-product">
      <h3>{product.name}</h3>
      <strong className="source-price">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.price)}</strong>
      <p>{product.description || 'No source description provided.'}</p>
      <div className="source-specifications"><h4>Specifications</h4>{Object.entries(product.specifications).length ? Object.entries(product.specifications).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong></div>) : <span className="source-empty">No specifications supplied.</span>}</div>
      <div className="source-keywords"><h4>Source keywords</h4><div>{product.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div></div>
    </div>
  )
}

function VariantCard({
  label,
  selectedId,
  variants,
  onChange,
  item,
}: {
  label: string
  selectedId: number | null
  variants: ContentListItem[]
  onChange: (id: number) => void
  item?: ContentListItem
}) {
  return (
    <article className="variant-card">
      <div className="variant-card-heading"><label><span>{label}</span><select aria-label={`Choose ${label}`} value={selectedId ?? ''} onChange={(event) => onChange(Number(event.currentTarget.value))}>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.generation_context.variant ?? `Version ${variant.version}`} · ${variant.approval_status.replaceAll('_', ' ')}</option>)}</select></label>{item && <StatusPill status={item.approval_status} />}</div>
      {item ? <><h3>{item.title}</h3><p>{item.body}</p><div className="variant-context"><span>{item.generation_context.tone ?? 'Default tone'}</span><span>{item.generation_context.content_angle ?? 'Default angle'}</span></div></> : <EmptyState title="Choose a variant" description="Select a saved version to compare." />}
    </article>
  )
}
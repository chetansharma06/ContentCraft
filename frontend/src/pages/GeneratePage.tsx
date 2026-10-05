import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, LoaderCircle, Search, Sparkles } from 'lucide-react'
import { ApiError, createJobs, getJob, type Job, type Product } from '../api/client'
import { Button, DataTable, EmptyState, ErrorState, Input, Select, type DataTableColumn } from '../components/ui'

const productQueryKey = ['catalog-products']
const selectionQueryKey = ['catalog-selection']
const tones = [
  { value: 'warm and approachable', label: 'Warm & approachable', detail: 'Friendly, human, and welcoming.' },
  { value: 'confident and concise', label: 'Confident & concise', detail: 'Direct language with a crisp finish.' },
  { value: 'bright and energetic', label: 'Bright & energetic', detail: 'Upbeat copy with a lively rhythm.' },
] as const
const angles = [
  { value: 'feature-led', label: 'Feature-led', detail: 'Lead with supplied features and specifications.' },
  { value: 'emotional', label: 'Emotional', detail: 'Connect documented use to a relevant feeling.' },
  { value: 'price-value', label: 'Price & value', detail: 'Frame supplied price alongside documented benefits.' },
] as const
const stepNames = ['Products', 'Content types & languages', 'Tones & variants', 'Review']

const productColumns: DataTableColumn<Product>[] = [
  { id: 'name', header: 'Product', cell: (product) => <div className="catalog-product-cell"><strong>{product.name}</strong><span>{product.description || 'No description provided'}</span></div>, sortValue: (product) => product.name.toLocaleLowerCase() },
  { id: 'price', header: 'Price', cell: (product) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.price), sortValue: (product) => product.price },
]

function isTerminal(status: string) {
  return ['completed', 'completed_with_errors', 'failed'].includes(status.toLowerCase())
}

function readableStatus(status: string) {
  const labels: Record<string, string> = {
    pending: 'Queued',
    running: 'Generating',
    completed: 'Complete',
    completed_with_errors: 'Complete with errors',
    failed: 'Failed',
  }
  return labels[status.toLowerCase()] ?? status
}

function errorLines(message: string | null) {
  return message?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? []
}

export function GeneratePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const productsQuery = useQuery<Product[]>({
    queryKey: productQueryKey,
    queryFn: async () => queryClient.getQueryData<Product[]>(productQueryKey) ?? [],
    initialData: () => queryClient.getQueryData<Product[]>(productQueryKey) ?? [],
    staleTime: Infinity,
  })
  const products = productsQuery.data ?? []
  const [step, setStep] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(() => new Set(queryClient.getQueryData<number[]>(selectionQueryKey) ?? []))
  const [category, setCategory] = useState<'beauty' | 'fashion' | 'home_kitchen'>('home_kitchen')
  const [language, setLanguage] = useState('English')
  const [selectedTones, setSelectedTones] = useState<string[]>(tones.map((tone) => tone.value))
  const [selectedAngles, setSelectedAngles] = useState<string[]>(angles.map((angle) => angle.value))
  const [jobs, setJobs] = useState<Job[]>([])
  const jobMutation = useMutation({
    mutationFn: createJobs,
    onSuccess: ({ jobs: createdJobs }) => setJobs(createdJobs),
  })
  const jobQueries = useQueries({
    queries: jobs.map((job) => ({
      queryKey: ['jobs', job.id],
      queryFn: () => getJob(job.id),
      initialData: job,
      staleTime: 0,
      refetchInterval: (query: { state: { data?: Job } }) => {
        const status = query.state.data?.status
        return status && isTerminal(status) ? false : 2000
      },
    })),
  })
  const filteredProducts = products.filter((product) => `${product.name} ${product.description} ${product.keywords.join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const selectedCount = selectedIds.size
  const latestJobs = jobQueries.map((query, index) => query.data ?? jobs[index])
  const completeCount = latestJobs.filter((job) => ['completed', 'completed_with_errors'].includes(job.status.toLowerCase())).length
  const failedCount = latestJobs.filter((job) => job.status.toLowerCase() === 'failed').length
  const terminalCount = completeCount + failedCount
  const aggregateProgress = latestJobs.length ? Math.round(latestJobs.reduce((sum, job) => sum + job.progress, 0) / latestJobs.length) : 0
  const allFinished = latestJobs.length > 0 && latestJobs.every((job) => isTerminal(job.status))

  function updateSelection(keys: Set<string | number>) {
    setSelectedIds(keys)
    queryClient.setQueryData<number[]>(selectionQueryKey, [...keys].map(Number))
  }

  function toggleChoice(current: string[], value: string, checked: boolean, setValues: (values: string[]) => void) {
    setValues(checked ? [...new Set([...current, value])] : current.filter((item) => item !== value))
  }

  function startGeneration() {
    jobMutation.mutate({
      product_ids: [...selectedIds].map(Number),
      category,
      language,
      tones: selectedTones as ('warm and approachable' | 'confident and concise' | 'bright and energetic')[],
      content_angles: selectedAngles as ('feature-led' | 'emotional' | 'price-value')[],
    })
  }

  const canContinue = step === 0 ? selectedCount > 0 : step === 2 ? selectedTones.length > 0 && selectedAngles.length > 0 : true
  const mutationError = jobMutation.error instanceof ApiError ? jobMutation.error.message : jobMutation.error?.message

  return (
    <section className="workflow-page generate-page">
      <div className="workflow-heading">
        <div><span className="eyebrow">CONTENT STUDIO</span><h1>Generate</h1><p>Build a focused batch of product content.</p></div>
        {jobs.length === 0 && <span className="generate-runtime"><span /> LIVE JOB MONITOR</span>}
      </div>

      {jobs.length === 0 ? (
        <>
          <nav className="wizard-steps" aria-label="Generation setup steps">
            {stepNames.map((name, index) => (
              <button key={name} type="button" className={`wizard-step${step === index ? ' is-current' : ''}${step > index ? ' is-complete' : ''}`} aria-current={step === index ? 'step' : undefined} disabled={index > step} onClick={() => setStep(index)}>
                <span className="wizard-step-number">{step > index ? <Check size={13} /> : index + 1}</span><span className="wizard-step-name">{name}</span>
              </button>
            ))}
          </nav>

          <div className="wizard-panel">
            <div className="wizard-panel-heading"><div><span className="wizard-step-kicker">STEP {String(step + 1).padStart(2, '0')} / 04</span><h2>{stepNames[step]}</h2></div><span className="wizard-selection-count">{selectedCount} products selected</span></div>

            {step === 0 && <div className="wizard-products">
              {products.length > 0 ? <>
                <div className="wizard-table-toolbar"><p>Select one or more catalog products for this batch.</p><div className="catalog-search"><Search size={15} aria-hidden="true" /><Input label="Search products" aria-label="Search products" placeholder="Find a product" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></div></div>
                <DataTable caption="Choose products for generation" columns={productColumns} rows={filteredProducts} getRowKey={(product) => product.id} getRowLabel={(product) => product.name} selection={{ selectedKeys: selectedIds, onChange: updateSelection }} emptyTitle="No matching products" emptyDescription="Try another search." />
              </> : <EmptyState icon={<Circle size={18} />} title="Add products to get started" description="Your catalog is empty. Import a product file before building a generation batch." action={<Button variant="secondary" onClick={() => navigate('/catalog')}>Open catalog <ArrowRight size={14} /></Button>} />}
            </div>}

            {step === 1 && <div className="generation-options-grid">
              <div className="generation-format-choice">
                <span className="ui-label">Content type</span>
                <div className="generation-format-card" aria-label="Selected content type: product description">
                  <span className="generation-radio selected" aria-hidden="true"><Check size={12} /></span>
                  <span><strong>Product description</strong><small>Structured title, product copy, and search details.</small></span>
                  <span className="format-tag">SUPPORTED</span>
                </div>
              </div>
              <Select label="Product category" value={category} onChange={(event) => setCategory(event.currentTarget.value as typeof category)} options={[
                { label: 'Beauty', value: 'beauty' },
                { label: 'Fashion', value: 'fashion' },
                { label: 'Home & kitchen', value: 'home_kitchen' },
              ]} hint="Selects the product-specific prompt." />
              <Select label="Output language" value={language} onChange={(event) => setLanguage(event.currentTarget.value)} options={[
                { label: 'English', value: 'English' },
                { label: 'Spanish', value: 'Spanish' },
                { label: 'French', value: 'French' },
                { label: 'German', value: 'German' },
                { label: 'Japanese', value: 'Japanese' },
              ]} />
            </div>}

            {step === 2 && <div className="generation-options-grid generation-variant-grid">
              <fieldset className="choice-group">
                <legend>Tone</legend><p>Choose the writing voices to generate.</p>
                <div className="choice-list">{tones.map((tone) => <label className="choice-card" key={tone.value}>
                  <input type="checkbox" checked={selectedTones.includes(tone.value)} onChange={(event) => toggleChoice(selectedTones, tone.value, event.currentTarget.checked, setSelectedTones)} />
                  <span className="choice-check"><Check size={12} /></span><span className="choice-copy"><strong>{tone.label}</strong><small>{tone.detail}</small></span>
                </label>)}</div>
              </fieldset>
              <fieldset className="choice-group">
                <legend>Variant angles</legend><p>Each selected angle creates a distinct content version.</p>
                <div className="choice-list">{angles.map((angle) => <label className="choice-card" key={angle.value}>
                  <input type="checkbox" checked={selectedAngles.includes(angle.value)} onChange={(event) => toggleChoice(selectedAngles, angle.value, event.currentTarget.checked, setSelectedAngles)} />
                  <span className="choice-check"><Check size={12} /></span><span className="choice-copy"><strong>{angle.label}</strong><small>{angle.detail}</small></span>
                </label>)}</div>
              </fieldset>
              <div className="variant-total"><Sparkles size={16} /><span><strong>{selectedTones.length * selectedAngles.length} variants per product</strong><small>{selectedTones.length} tones × {selectedAngles.length} angles</small></span></div>
            </div>}

            {step === 3 && <div className="generation-review">
              <div className="review-summary-row"><span>Products</span><strong>{selectedCount} selected</strong></div>
              <div className="review-summary-row"><span>Content type</span><strong>Product description</strong></div>
              <div className="review-summary-row"><span>Category &amp; language</span><strong>{category.replace('_', ' ')} · {language}</strong></div>
              <div className="review-summary-row"><span>Tones</span><strong>{selectedTones.map((tone) => tones.find((entry) => entry.value === tone)?.label).join(', ')}</strong></div>
              <div className="review-summary-row"><span>Variant angles</span><strong>{selectedAngles.map((angle) => angles.find((entry) => entry.value === angle)?.label).join(', ')}</strong></div>
              <div className="review-output-count"><Sparkles size={17} /><span><strong>{selectedCount * selectedTones.length * selectedAngles.length} content items</strong><small>Estimated from selected products, tones, and angles.</small></span></div>
            </div>}

            {mutationError && <div className="generation-error"><ErrorState title="Could not start generation" description={mutationError} onRetry={startGeneration} /></div>}

            <div className="wizard-footer">
              {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={15} /> Back</Button> : <span className="wizard-hint">Choose at least one product to continue.</span>}
              {step < 3 ? <Button onClick={() => setStep(step + 1)} disabled={!canContinue}>Continue <ArrowRight size={15} /></Button> : <Button onClick={startGeneration} loading={jobMutation.isPending} disabled={!canContinue || selectedCount === 0}>Start generation <Sparkles size={15} /></Button>}
            </div>
          </div>
        </>
      ) : (
        <div className="generation-progress-panel">
          <div className="generation-progress-heading"><div><span className="eyebrow">BATCH PROGRESS</span><h2>{allFinished ? 'Generation finished' : 'Generating content'}</h2><p>{allFinished ? `${completeCount} complete · ${failedCount} failed` : `${terminalCount} of ${latestJobs.length} jobs finished`}</p></div>
            <Button variant="secondary" onClick={() => { setJobs([]); setStep(0); jobMutation.reset() }}>New batch</Button>
          </div>
          <div className="overall-progress"><div className="overall-progress-label"><span>{aggregateProgress}% overall progress</span><span>{terminalCount}/{latestJobs.length} products</span></div><div className="progress-track" role="progressbar" aria-label="Overall generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={aggregateProgress}><span style={{ width: `${aggregateProgress}%` }} /></div></div>
          {mutationError && <ErrorState title="Generation request failed" description={mutationError} />}
          <div className="job-list">{latestJobs.map((job, index) => {
            const query = jobQueries[index]
            const failed = job.status.toLowerCase() === 'failed'
            const finished = isTerminal(job.status)
            const errors = errorLines(job.error)
            const pollError = query?.isError && !query.data ? query.error.message : ''
            const productName = products.find((product) => product.id === job.product_id)?.name ?? `Product #${job.product_id}`
            return <article className={`job-card${failed ? ' has-failed' : ''}`} key={job.id}>
              <div className="job-card-main"><span className={`job-state-icon${failed ? ' is-failed' : finished ? ' is-done' : ' is-running'}`}>{failed ? <AlertTriangle size={16} /> : finished ? <CheckCircle2 size={16} /> : <LoaderCircle size={16} />}</span>
                <div className="job-card-copy"><strong>{productName}</strong><span>Job #{job.id} · {readableStatus(job.status)}</span></div>
                <strong className="job-percent">{job.progress}%</strong>
              </div>
              <div className="job-progress-track" role="progressbar" aria-label={`${productName} generation progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress}><span className={failed ? 'progress-failed' : ''} style={{ width: `${job.progress}%` }} /></div>
              {(errors.length > 0 || pollError) && <ul className="job-error-list">{[...errors, ...(pollError ? [pollError] : [])].map((error, errorIndex) => <li key={`${errorIndex}-${error}`}>{error}</li>)}</ul>}
            </article>
          })}</div>
        </div>
      )}
    </section>
  )
}
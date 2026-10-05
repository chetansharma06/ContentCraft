import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileOutput, UploadCloud } from 'lucide-react'
import { listContent, publishContent, type ContentListItem } from '../api/client'
import { Button, DataTable, Dialog, EmptyState, ErrorState, type DataTableColumn } from '../components/ui'
import { downloadTextFile } from '../utils/download'

type CompletedExport = { content: string; count: number; completedAt: string; filename: string }

const columns: DataTableColumn<ContentListItem>[] = [
  { id: 'title', header: 'Content', cell: (item) => <div className="catalog-product-cell"><strong>{item.title}</strong><span>{item.body}</span></div>, sortValue: (item) => item.title.toLocaleLowerCase() },
  { id: 'language', header: 'Language', cell: (item) => item.language ?? 'Unknown', sortValue: (item) => item.language ?? '' },
  { id: 'created_at', header: 'Approved', cell: (item) => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(item.created_at)), sortValue: (item) => item.created_at },
]

export function PublishPage() {
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [completedExport, setCompletedExport] = useState<CompletedExport | null>(null)
  const approvedQuery = useQuery({
    queryKey: ['publish-approved'],
    queryFn: () => listContent({ status: 'APPROVED', sort_by: 'created_at', sort_order: 'desc', limit: 200 }),
  })
  const approvedItems = approvedQuery.data ?? []
  const selectedItems = approvedItems.filter((item) => selectedIds.has(item.id))
  const publishMutation = useMutation({
    mutationFn: () => publishContent({ content_ids: selectedItems.map((item) => item.id), destination: 'csv' }),
    onSuccess: (content) => {
      const filename = 'contentcraft-export.csv'
      setCompletedExport({ content, count: selectedItems.length, completedAt: new Date().toISOString(), filename })
      setSelectedIds(new Set())
      setConfirmOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['publish-approved'] })
      void queryClient.invalidateQueries({ queryKey: ['review-content'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  function publishSelected() {
    if (!selectedItems.length) return
    publishMutation.mutate()
  }

  return (
    <section className="operations-page publish-page">
      <div className="operations-heading">
        <div><span className="eyebrow">DISTRIBUTION</span><h1>Publish</h1><p>Export approved content as a ready-to-import CSV.</p></div>
        <div className="publish-ready-count"><strong>{approvedItems.length}</strong><span>approved items ready</span></div>
      </div>

      {completedExport && <article className="download-card" role="status">
        <div className="download-card-icon"><Check size={18} /></div>
        <div className="download-card-copy"><span className="panel-kicker">EXPORT READY · {completedExport.count} ITEMS</span><strong>{completedExport.filename}</strong><span>Created {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(completedExport.completedAt))}</span></div>
        <Button onClick={() => downloadTextFile(completedExport.filename, completedExport.content)}><Download size={15} /> Download CSV</Button>
      </article>}

      <div className="publish-list-heading"><div><h2>Approved content</h2><span>Only approved items can be published.</span></div>{selectedIds.size > 0 && <Button onClick={() => setConfirmOpen(true)}><FileOutput size={15} /> Publish {selectedIds.size} CSV</Button>}</div>

      {approvedQuery.isError && <div className="operations-error"><ErrorState title="Approved content unavailable" description={approvedQuery.error.message} onRetry={() => { void approvedQuery.refetch() }} /></div>}
      {approvedQuery.isLoading && <div className="operations-loading"><div /><div /><div /></div>}
      {approvedQuery.isSuccess && approvedItems.length === 0 && <div className="operations-empty"><EmptyState icon={<UploadCloud size={18} />} title="Nothing approved for publishing" description="QC-passed content appears here after it has been approved in Review." /></div>}
      {approvedItems.length > 0 && <DataTable
        caption="Approved content for publishing"
        columns={columns}
        rows={approvedItems}
        getRowKey={(item) => item.id}
        getRowLabel={(item) => item.title}
        selection={{ selectedKeys: selectedIds, onChange: setSelectedIds }}
        emptyTitle="No approved items"
        emptyDescription="Approve content in the review queue first."
      />}

      {publishMutation.isError && <div className="publish-error"><ErrorState title="CSV export failed" description={publishMutation.error.message} onRetry={() => publishMutation.reset()} /></div>}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Publish ${selectedItems.length} approved item${selectedItems.length === 1 ? '' : 's'}?`} description={`Exactly ${selectedItems.length} approved content item${selectedItems.length === 1 ? '' : 's'} will be published and marked PUBLISHED.`}>
        <div className="publish-confirm-list">{selectedItems.map((item) => <div key={item.id}><span>{item.title}</span><span>#{item.id}</span></div>)}</div>
        <div className="publish-confirm-actions"><Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button onClick={publishSelected} loading={publishMutation.isPending}><FileOutput size={15} /> Publish exactly {selectedItems.length}</Button></div>
      </Dialog>
    </section>
  )
}
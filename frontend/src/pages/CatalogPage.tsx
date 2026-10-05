import { useState, type ChangeEvent, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Check, FileSpreadsheet, Search, UploadCloud } from 'lucide-react'
import { ApiError, uploadProducts, type Product, type ProductUploadResponse } from '../api/client'
import { Button, DataTable, ErrorState, Input, type DataTableColumn } from '../components/ui'

type RejectedProductRow = ProductUploadResponse['rejected_rows'][number]
const productQueryKey = ['catalog-products']
const selectionQueryKey = ['catalog-selection']

const columns: DataTableColumn<Product>[] = [
  {
    id: 'name',
    header: 'Product',
    cell: (product) => <div className="catalog-product-cell"><strong>{product.name}</strong><span>{product.description || 'No description provided'}</span></div>,
    sortValue: (product) => product.name.toLocaleLowerCase(),
  },
  {
    id: 'price',
    header: 'Price',
    cell: (product) => <span className="catalog-price">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.price)}</span>,
    sortValue: (product) => product.price,
  },
  {
    id: 'keywords',
    header: 'Keywords',
    cell: (product) => <div className="catalog-keywords">{product.keywords.length ? product.keywords.map((keyword) => <span key={keyword}>{keyword}</span>) : <span className="catalog-muted">None</span>}</div>,
    sortValue: (product) => product.keywords.join(', '),
  },
]

export function CatalogPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const productsQuery = useQuery<Product[]>({
    queryKey: productQueryKey,
    queryFn: async () => queryClient.getQueryData<Product[]>(productQueryKey) ?? [],
    initialData: () => queryClient.getQueryData<Product[]>(productQueryKey) ?? [],
    staleTime: Infinity,
  })
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(() => new Set(queryClient.getQueryData<number[]>(selectionQueryKey) ?? []))
  const [rejectedRows, setRejectedRows] = useState<RejectedProductRow[]>([])
  const [uploadReport, setUploadReport] = useState<ProductUploadResponse | null>(null)
  const [search, setSearch] = useState('')
  const [fileError, setFileError] = useState('')
  const [lastFile, setLastFile] = useState<File | null>(null)
  const uploadMutation = useMutation({
    mutationFn: uploadProducts,
    onSuccess: (result) => {
      const existing = queryClient.getQueryData<Product[]>(productQueryKey) ?? []
      queryClient.setQueryData<Product[]>(productQueryKey, [...existing, ...result.products])
      setRejectedRows(result.rejected_rows)
      setUploadReport(result)
      setFileError('')
      setLastFile(null)
    },
  })

  const products = productsQuery.data ?? []
  const filteredProducts = products.filter((product) => {
    const searchable = [product.name, product.description, product.price, ...product.keywords, ...Object.entries(product.specifications).flat()].join(' ').toLocaleLowerCase()
    return searchable.includes(search.trim().toLocaleLowerCase())
  })

  function chooseFile(file?: File) {
    if (!file) return
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      uploadMutation.reset()
      setFileError('Choose a CSV or Excel (.xlsx) file.')
      return
    }
    setFileError('')
    setLastFile(file)
    uploadMutation.mutate(file)
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.currentTarget.files?.[0])
    event.currentTarget.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    chooseFile(event.dataTransfer.files[0])
  }

  function updateSelection(keys: Set<string | number>) {
    setSelectedIds(keys)
    queryClient.setQueryData<number[]>(selectionQueryKey, [...keys].map(Number))
  }

  const uploadError = uploadMutation.error instanceof ApiError ? uploadMutation.error.message : uploadMutation.error?.message

  return (
    <section className="workflow-page">
      <div className="workflow-heading">
        <div><span className="eyebrow">PRODUCT DATA</span><h1>Catalog</h1><p>Bring product facts into one searchable workspace.</p></div>
        <div className="catalog-summary"><strong>{products.length}</strong><span>products</span></div>
      </div>

      <div className="catalog-upload-row">
        <div
          className={`catalog-dropzone${uploadMutation.isPending ? ' is-uploading' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          aria-busy={uploadMutation.isPending}
        >
          <input id="catalog-file" className="ui-sr-only" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} disabled={uploadMutation.isPending} />
          <div className="catalog-upload-icon"><UploadCloud size={19} /></div>
          <div className="catalog-drop-copy">
            <strong>{uploadMutation.isPending ? 'Importing product rows…' : 'Drop a product file here'}</strong>
            <span>CSV or Excel (.xlsx), with row-level validation</span>
          </div>
          <label htmlFor="catalog-file" className="catalog-file-label" aria-disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? 'Uploading' : 'Browse files'}
          </label>
        </div>
        {uploadReport && (
          <div className={`catalog-upload-result${rejectedRows.length ? ' has-rejections' : ''}`} role="status">
            {rejectedRows.length ? <FileSpreadsheet size={17} /> : <Check size={17} />}
            <span><strong>{uploadReport.inserted_count} accepted</strong>{rejectedRows.length ? ` / ${rejectedRows.length} rejected` : ' / all rows passed'}</span>
          </div>
        )}
      </div>

      {fileError && <p className="catalog-inline-error" role="alert">{fileError}</p>}
      {uploadError && <div className="catalog-upload-error"><ErrorState title="Import failed" description={uploadError} onRetry={() => lastFile && uploadMutation.mutate(lastFile)} /></div>}

      {uploadReport && rejectedRows.length > 0 && (
        <section className="rejected-report" aria-labelledby="rejected-heading">
          <div className="rejected-heading"><div><span className="eyebrow">IMPORT REPORT</span><h2 id="rejected-heading">Rows to fix</h2></div><span className="rejected-count">{rejectedRows.length} rejected</span></div>
          <div className="rejected-list">
            {rejectedRows.map((row) => (
              <article className="rejected-row" key={`${row.row_number}-${String(row.data.name ?? '')}`}>
                <div className="rejected-row-number">ROW {row.row_number}</div>
                <div className="rejected-row-main"><strong>{String(row.data.name ?? 'Unnamed product')}</strong><span>{Object.entries(row.data).map(([key, value]) => `${key}: ${String(value ?? '')}`).join(' · ')}</span></div>
                <ul>{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {uploadReport && rejectedRows.length === 0 && (
        <div className="catalog-clean-report" role="status"><Check size={15} /><span>All imported rows passed validation.</span></div>
      )}

      <div className="catalog-table-heading">
        <div><h2>Products</h2><span>{filteredProducts.length} shown</span></div>
        <div className="catalog-table-actions">
          <div className="catalog-search"><Search size={15} aria-hidden="true" /><Input label="Search products" aria-label="Search products" placeholder="Search name, keyword, or detail" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></div>
          {selectedIds.size > 0 && <Button onClick={() => navigate('/generate')}><span>{selectedIds.size} selected</span><ArrowUpRight size={15} /> Generate</Button>}
        </div>
      </div>

      <DataTable
        caption="Product catalog"
        columns={columns}
        rows={filteredProducts}
        loading={uploadMutation.isPending}
        getRowKey={(product) => product.id}
        getRowLabel={(product) => product.name}
        selection={{ selectedKeys: selectedIds, onChange: updateSelection }}
        emptyTitle={search ? 'No matching products' : 'Your catalog is empty'}
        emptyDescription={search ? 'Try another product name, keyword, or detail.' : 'Upload a CSV or Excel file to add products.'}
      />
      <div className="catalog-table-footer"><span>PRODUCTS ARE VALIDATED BEFORE THEY ENTER YOUR CATALOG</span><span>{selectedIds.size} selected</span></div>
    </section>
  )
}
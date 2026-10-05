import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { EmptyState, Skeleton } from './feedback'

export type DataTableColumn<Row> = {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  sortValue?: (row: Row) => string | number
}

type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowKey: (row: Row) => string | number
  getRowLabel?: (row: Row) => string
  selection?: {
    selectedKeys: Set<string | number>
    onChange: (selectedKeys: Set<string | number>) => void
  }
  caption: string
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
}

export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  getRowLabel = (row) => String(getRowKey(row)),
  selection,
  caption,
  loading = false,
  emptyTitle = 'No rows to display',
  emptyDescription = 'There is no data available for this view.',
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ column: string; direction: 'ascending' | 'descending' } | null>(null)
  const activeColumn = columns.find((column) => column.id === sort?.column)
  const visibleRows = activeColumn?.sortValue && sort
    ? [...rows].sort((left, right) => {
      const a = activeColumn.sortValue!(left)
      const b = activeColumn.sortValue!(right)
      const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
      return sort.direction === 'ascending' ? order : -order
    })
    : rows
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selection?.selectedKeys.has(getRowKey(row)))

  function toggleRow(row: Row, checked: boolean) {
    if (!selection) return
    const selectedKeys = new Set(selection.selectedKeys)
    const key = getRowKey(row)
    if (checked) selectedKeys.add(key)
    else selectedKeys.delete(key)
    selection.onChange(selectedKeys)
  }

  function toggleVisibleRows(checked: boolean) {
    if (!selection) return
    const selectedKeys = new Set(selection.selectedKeys)
    for (const row of rows) {
      const key = getRowKey(row)
      if (checked) selectedKeys.add(key)
      else selectedKeys.delete(key)
    }
    selection.onChange(selectedKeys)
  }

  function toggleSort(column: DataTableColumn<Row>) {
    if (!column.sortValue) return
    setSort((current) => ({
      column: column.id,
      direction: current?.column === column.id && current.direction === 'ascending' ? 'descending' : 'ascending',
    }))
  }

  return (
    <div className="ui-table-scroll" aria-busy={loading}>
      <table className="ui-table">
        <caption className="ui-sr-only">{caption}</caption>
        <thead>
          <tr>
            {selection && <th scope="col" className="ui-selection-cell">
              <input
                type="checkbox"
                aria-label="Select all visible rows"
                checked={allVisibleSelected}
                onChange={(event) => toggleVisibleRows(event.currentTarget.checked)}
              />
            </th>}
            {columns.map((column) => {
              const direction = sort?.column === column.id ? sort.direction : 'none'
              return (
                <th key={column.id} scope="col" aria-sort={column.sortValue ? direction : undefined}>
                  {column.sortValue ? (
                    <button className="ui-sort-button" type="button" onClick={() => toggleSort(column)}>
                      {column.header}
                      {direction === 'ascending' ? <ArrowUp size={13} /> : direction === 'descending' ? <ArrowDown size={13} /> : <ArrowUpDown size={13} />}
                    </button>
                  ) : column.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? Array.from({ length: 3 }, (_, rowIndex) => (
            <tr key={`loading-${rowIndex}`}>
              {selection && <td className="ui-selection-cell"><Skeleton variant="circle" className="ui-checkbox-skeleton" /></td>}
              {columns.map((column) => <td key={column.id}><Skeleton variant="text" /></td>)}
            </tr>
          )) : visibleRows.length > 0 ? visibleRows.map((row) => (
            <tr key={getRowKey(row)}>
              {selection && <td className="ui-selection-cell">
                <input
                  type="checkbox"
                  aria-label={`Select ${getRowLabel(row)}`}
                  checked={selection.selectedKeys.has(getRowKey(row))}
                  onChange={(event) => toggleRow(row, event.currentTarget.checked)}
                />
              </td>}
              {columns.map((column) => <td key={column.id}>{column.cell(row)}</td>)}
            </tr>
          )) : (
            <tr><td colSpan={columns.length + (selection ? 1 : 0)}><EmptyState title={emptyTitle} description={emptyDescription} /></td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
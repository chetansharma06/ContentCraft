import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewPage } from './ReviewPage'

function SearchParamsOutput() {
  const [params] = useSearchParams()
  return <output data-testid="search-params">{params.toString()}</output>
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

function renderReview(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/review" element={<><ReviewPage /><SearchParamsOutput /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('review filters', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('hydrates controls from URL params and merges changes back into the URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])))
    const user = userEvent.setup()

    renderReview('/review?status=QC_PASSED&language=French&type=product_description&flagged=true&sort_by=title&sort_order=asc')

    expect(await screen.findByText('No content matches these filters')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by status')).toHaveValue('QC_PASSED')
    expect(screen.getByLabelText('Filter by language')).toHaveValue('French')
    expect(screen.getByLabelText('Filter by content type')).toHaveValue('product_description')
    expect(screen.getByLabelText('Filter by flagged state')).toHaveValue('true')

    await user.selectOptions(screen.getByLabelText('Filter by flagged state'), 'false')

    await waitFor(() => expect(screen.getByTestId('search-params')).toHaveTextContent('flagged=false'))
    expect(screen.getByTestId('search-params')).toHaveTextContent('status=QC_PASSED')
    expect(screen.getByTestId('search-params')).toHaveTextContent('language=French')
    expect(screen.getByTestId('search-params')).toHaveTextContent('type=product_description')
  })
})
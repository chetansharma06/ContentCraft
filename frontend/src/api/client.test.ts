import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkHealth, listContent } from './client'

const contentItem = {
  id: 7,
  product_id: 3,
  title: 'Field Notes',
  body: 'A short product description.',
  keywords: ['field'],
  version: 1,
  approval_status: 'QC_PASSED',
  created_at: '2026-10-05T12:00:00Z',
  language: 'English',
  content_type: 'product_description',
  generation_context: { variant: 'feature-warm', tone: 'warm and approachable' },
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

describe('API client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

  afterEach(() => vi.unstubAllGlobals())

  it('parses the health response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'ok' }))

    await expect(checkHealth()).resolves.toEqual({ status: 'ok' })
  })

  it('maps content_type to the API type query and validates response rows', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([contentItem]))

    const result = await listContent({ status: 'QC_PASSED', content_type: 'product_description', flagged: false })

    expect(result).toEqual([contentItem])
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
      '/api/content?status=QC_PASSED&type=product_description&flagged=false',
    )
  })

  it('rejects malformed API data', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ id: 'not-a-number' }]))

    await expect(listContent()).rejects.toThrow()
  })
})
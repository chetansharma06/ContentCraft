import { z } from 'zod'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'

const contentStatusSchema = z.enum([
  'GENERATED',
  'QC_PASSED',
  'QC_FLAGGED',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
])

const productSchema = z.object({
  id: z.number(),
  name: z.string(),
  price: z.number(),
  description: z.string(),
  specifications: z.record(z.unknown()),
  keywords: z.array(z.string()),
})

const rejectedRowSchema = z.object({
  row_number: z.number(),
  data: z.record(z.unknown()),
  reasons: z.array(z.string()),
})

const productUploadResponseSchema = z.object({
  inserted_count: z.number(),
  products: z.array(productSchema),
  rejected_rows: z.array(rejectedRowSchema),
})

const jobSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  status: z.string(),
  progress: z.number(),
  error: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
})

const jobBatchResponseSchema = z.object({ jobs: z.array(jobSchema) })

const contentListItemSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  title: z.string(),
  body: z.string(),
  keywords: z.array(z.string()),
  version: z.number(),
  approval_status: contentStatusSchema,
  created_at: z.string(),
  language: z.string().nullable(),
  content_type: z.literal('product_description'),
  generation_context: z.record(z.string()),
})

const contentVersionSchema = z.object({
  version: z.number(),
  snapshot: z.record(z.unknown()),
  created_at: z.string(),
})

const qcSchema = z.object({
  status: z.string(),
  score: z.number().nullable(),
  issues: z.array(z.string()),
  checked_at: z.string(),
})

const qcRulesSchema = z.object({
  banned_brand_terms: z.array(z.string()),
  prohibited_claims: z.array(z.string()),
})

const contentDetailSchema = contentListItemSchema.extend({
  generation_job_id: z.number().nullable(),
  image_urls: z.array(z.string()),
  versions: z.array(contentVersionSchema),
  latest_qc: qcSchema.nullable(),
  qc_rules: qcRulesSchema,
})

const contentStatusResponseSchema = z.object({
  content_id: z.number(),
  status: contentStatusSchema,
})

const auditSchema = z.object({
  id: z.number(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  details: z.record(z.unknown()),
  created_at: z.string(),
})

const overviewSchema = z.object({
  status_counts: z.record(z.number()),
  qc_passed: z.number(),
  qc_flagged: z.number(),
  recent_jobs: z.array(jobSchema.extend({ product_name: z.string() })),
  recent_events: z.array(auditSchema),
})

const healthSchema = z.record(z.string())

export type Product = z.infer<typeof productSchema>
export type ProductUploadResponse = z.infer<typeof productUploadResponseSchema>
export type Job = z.infer<typeof jobSchema>
export type ContentStatus = z.infer<typeof contentStatusSchema>
export type ContentListItem = z.infer<typeof contentListItemSchema>
export type ContentDetail = z.infer<typeof contentDetailSchema>
export type AuditLog = z.infer<typeof auditSchema>
export type OverviewData = z.infer<typeof overviewSchema>

export type JobCreateRequest = {
  product_ids: number[]
  category?: 'beauty' | 'fashion' | 'home_kitchen'
  language?: string
  tones?: ('warm and approachable' | 'confident and concise' | 'bright and energetic')[]
  content_angles?: ('feature-led' | 'emotional' | 'price-value')[]
}

export type ContentEditRequest = {
  title?: string
  body?: string
  keywords?: string[]
}

export type RejectionRequest = {
  reason: string
  reviewed_by?: string
}

export type PublishRequest = {
  content_ids: number[]
  destination?: 'csv' | 'shopify' | 'woocommerce'
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  responseType: 'json' | 'text' = 'json',
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail = z.object({ detail: z.unknown() }).safeParse(payload)
    throw new ApiError(
      detail.success ? String(detail.data.detail) : `Request failed (${response.status})`,
      response.status,
    )
  }

  const payload: unknown = responseType === 'text' ? await response.text() : await response.json()
  return schema.parse(payload)
}

export function checkHealth() {
  return request('/health', healthSchema)
}

export function getOverview() {
  return request('/overview', overviewSchema)
}

export function uploadProducts(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request('/products/upload', productUploadResponseSchema, {
    method: 'POST',
    body: form,
  })
}

export function createJobs(input: JobCreateRequest) {
  return request('/jobs', jobBatchResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getJob(jobId: number) {
  return request(`/jobs/${jobId}`, jobSchema)
}

export type ListContentParams = {
  status?: ContentStatus
  product_id?: number
  language?: string
  content_type?: string
  flagged?: boolean
  sort_by?: 'created_at' | 'title' | 'status'
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export function listContent(params: ListContentParams = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key === 'content_type' ? 'type' : key, String(value))
  }
  const suffix = query.size ? `?${query.toString()}` : ''
  return request(`/content${suffix}`, z.array(contentListItemSchema))
}

export function getContent(contentId: number) {
  return request(`/content/${contentId}`, contentDetailSchema)
}

export function editContent(contentId: number, input: ContentEditRequest) {
  return request(`/content/${contentId}`, contentDetailSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function approveContent(contentId: number, reviewedBy = 'system') {
  const query = new URLSearchParams({ reviewed_by: reviewedBy })
  return request(`/content/${contentId}/approve?${query}`, contentStatusResponseSchema, {
    method: 'POST',
  })
}

export function unapproveContent(contentId: number, reviewedBy = 'system') {
  const query = new URLSearchParams({ reviewed_by: reviewedBy })
  return request(`/content/${contentId}/unapprove?${query}`, contentStatusResponseSchema, {
    method: 'POST',
  })
}

export function rejectContent(contentId: number, input: RejectionRequest) {
  return request(`/content/${contentId}/reject`, contentStatusResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export type ListAuditParams = {
  action?: string
  entity_id?: string
  limit?: number
  offset?: number
}

export function listAudit(params: ListAuditParams = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const suffix = query.size ? `?${query.toString()}` : ''
  return request(`/audit${suffix}`, z.array(auditSchema))
}

export function publishContent(input: PublishRequest) {
  return request('/publish', z.string(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, 'text')
}

export function getProduct(productId: number) {
  return request(`/products/${productId}`, productSchema)
}
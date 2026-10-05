import { expect, test } from '@playwright/test'

test('upload, generate, review, approve, publish, download, and audit', async ({ page }) => {
  const productName = 'Smoke Test Tray'
  const csv = [
    'name,price,description,specifications,keywords',
    `${productName},19.00,A small ceramic tray for daily storage,{},ceramic;storage`,
  ].join('\n')

  await page.goto('/')
  await expect(page.getByText('Chetan Sharma')).toBeVisible()
  await page.getByRole('link', { name: 'Catalog' }).click()
  await page.locator('#catalog-file').setInputFiles({
    name: 'smoke-products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(page.getByText('1 accepted / all rows passed')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select all visible rows' }).check()
  await page.getByRole('button', { name: /1 selected.*Generate/ }).click()

  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  const toneOptions = page.locator('.choice-group').nth(0).locator('input[type="checkbox"]')
  await toneOptions.nth(1).uncheck()
  await toneOptions.nth(2).uncheck()
  const angleOptions = page.locator('.choice-group').nth(1).locator('input[type="checkbox"]')
  await angleOptions.nth(1).uncheck()
  await angleOptions.nth(2).uncheck()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Start generation' }).click()
  await expect(page.getByRole('heading', { name: 'Generation finished' })).toBeVisible({ timeout: 45_000 })

  await page.getByRole('link', { name: 'Review' }).click()
  await page.getByLabel('Filter by status').selectOption('QC_PASSED')
  const reviewItem = page.locator('.review-content-cell button').first()
  await expect(reviewItem).toBeVisible()
  await reviewItem.click()
  const contentId = Number(new URL(page.url()).pathname.split('/').at(-1))
  const description = page.getByLabel('Content description')
  await description.fill(`${await description.inputValue()} Refined for the smoke test.`)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('PRODUCT DESCRIPTION / V2')).toBeVisible()
  await expect(page.locator('.review-workspace-header .ui-status-pill')).toHaveText('QC PASSED')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.locator('.review-workspace-header .ui-status-pill')).toHaveText('APPROVED')

  await page.getByRole('link', { name: 'Publish' }).click()
  await page.getByRole('checkbox', { name: 'Select all visible rows' }).check()
  await page.getByRole('button', { name: 'Publish 1 CSV' }).click()
  await expect(page.getByRole('dialog')).toContainText('Exactly 1 approved content item will be published')
  await page.getByRole('button', { name: 'Publish exactly 1' }).click()
  await expect(page.locator('.download-card')).toContainText('contentcraft-export.csv')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('contentcraft-export.csv')

  await page.getByRole('link', { name: 'Audit' }).click()
  await page.getByLabel('Filter audit by action').selectOption('content.published')
  await page.getByLabel('Filter by entity ID').fill(String(contentId))
  await expect(page.locator('.audit-action-label').first()).toHaveText('content published')
  await expect(page.locator('.audit-detail-list')).toContainText('csv')

  await page.getByRole('link', { name: 'Overview' }).click()
  await expect(page.locator('a[href="/review?status=PUBLISHED"] strong')).toHaveText('1')
})
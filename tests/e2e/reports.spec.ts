import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/reports'); });

test('reports show their sample sizes and fit phone and desktop widths', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.getByText('Fictional preview.', { exact: false })).toBeVisible();
  await expect(page.locator('.report-funnel-row').first()).toContainText('30/30');
  await expect(page.locator('.report-speed')).toContainText('n=');
  await expect(page.getByText('revenue, not profit', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Group ads by', { exact: true }).selectOption('ad');
  await expect(page.getByRole('region', { name: 'Advertising outcomes table' })).toContainText('Your work deserves a better website');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the acquisition calculator applies the entered range without adding hosting revenue', async ({ page }) => {
  await page.getByLabel('Project revenue', { exact: true }).fill('2200');
  await page.getByLabel('Delivery costs', { exact: true }).fill('500');
  await page.getByLabel('Desired retained contribution', { exact: true }).fill('800');
  await page.getByLabel('Your hourly rate', { exact: true }).fill('100');
  await page.getByLabel('Presales minutes per qualified lead', { exact: true }).fill('60');
  await page.getByLabel('Qualified lead close rate · low', { exact: true }).fill('20');
  await page.getByLabel('Qualified lead close rate · high', { exact: true }).fill('40');
  const result = page.locator('.report-calculator-result');
  await expect(result).toContainText('$400 – $650');
  await expect(result).toContainText('$80 – $260');
  await page.getByLabel('Desired retained contribution', { exact: true }).fill('2000');
  await expect(result).toContainText('no advertising allowance');
});

test('an empty enquiry cohort shows useful empty states and no invalid rates', async ({ page }) => {
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel('Enquiries from', { exact: true }).fill('2099-01-01');
  await page.getByLabel('To, inclusive', { exact: true }).fill('2099-01-31');
  await expect(page.locator('.report-funnel-row').first()).toContainText('none yet');
  await expect(page.locator('.report-target')).toContainText('0/0 attempted enquiries');
  await expect(page.locator('.report-speed')).toContainText('none yet');
  await expect(page.locator('.reports-workspace')).not.toContainText(/NaN|Infinity|∞/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.report-funnel-row').first()).toContainText('30/30');
});

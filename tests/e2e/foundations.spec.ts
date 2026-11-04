import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/today'); });

test('Today is usable at phone and desktop sizes', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /New leads/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Calls today/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('nav[aria-label="Mobile navigation"]')).toBeVisible({ visible: test.info().project.name === 'phone' });
});

test('quick add saves a fictional lead and search finds it', async ({ page }) => {
  if (test.info().project.name === 'phone') await page.getByRole('button', { name: 'Quick add', exact: true }).click();
  else await page.getByRole('button', { name: 'Add lead', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name', { exact: true }).fill('Casey');
  await dialog.getByLabel('Last name', { exact: true }).fill('Example');
  await dialog.getByLabel('Business', { exact: true }).fill('Fictional Fixture Co');
  await dialog.getByLabel('Email', { exact: true }).fill('casey.test@example.com');
  await dialog.getByRole('button', { name: 'Add lead', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/leads');
  await page.getByLabel('Search leads').fill('casey.test@example.com');
  await expect(page.getByRole('link', { name: 'Casey Example', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Search leads').fill('casey.test@example.com');
  await expect(page.getByRole('link', { name: 'Casey Example', exact: true })).toBeVisible();
});

test('completing a task can be undone', async ({ page }) => {
  const task = page.getByRole('button', { name: /^Complete / }).first();
  const label = await task.getAttribute('aria-label');
  await task.click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: label!, exact: true })).toBeVisible();
});

test('private pages send noindex and framing restrictions', async ({ request }) => {
  const response = await request.get('/today');
  expect(response.headers()['x-robots-tag']).toContain('noindex');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['cache-control']).toContain('no-store');
});

import {test,expect} from '@playwright/test';

test('quote builder preserves the one-off and monthly prices through reload',async({page})=>{
  await page.goto('/quotes');
  await page.getByRole('button',{name:'Create quote',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Document lead').selectOption('demo-01');
  await dialog.getByLabel('Unit price',{exact:true}).first().fill('3300');
  await expect(dialog.getByLabel('Unit price',{exact:true}).nth(1)).toHaveValue('49');
  await dialog.getByRole('button',{name:'Save draft',exact:true}).click();
  dialog=page.getByRole('dialog');
  await expect(dialog.locator('.document-totals')).toContainText('$3,300');
  await expect(dialog.locator('.document-totals')).toContainText('$49');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();
  const row=page.locator('.commerce-list-row').filter({hasText:'Ellis & Co Electrical'});
  await expect(row).toContainText('$3,300');
  await expect(row).toContainText('$49');
});

test('a partial payment changes only the balance and persists',async({page})=>{
  await page.goto('/invoices');
  await page.locator('.commerce-list-row').filter({hasText:'LUM-0002'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Record payment',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Amount received',{exact:true}).fill('400');
  await dialog.getByLabel('Reference',{exact:true}).fill('Fictional bank transfer');
  await dialog.getByRole('button',{name:'Record payment',exact:true}).click();
  await expect(page.locator('.commerce-list-row').filter({hasText:'LUM-0002'})).toContainText('$700');
  await page.reload();
  await expect(page.locator('.commerce-list-row').filter({hasText:'LUM-0002'})).toContainText('$700');
  await page.locator('.commerce-list-row').filter({hasText:'LUM-0002'}).click();
  await expect(page.getByRole('dialog').locator('.invoice-totals')).toContainText('$2,200');
  await expect(page.getByRole('dialog').getByText('Fictional bank transfer',{exact:false})).toBeVisible();
});

test('project checklist changes persist without launching the project',async({page})=>{
  await page.goto('/projects');
  await page.locator('.project-card').filter({hasText:'Lane Concreting website'}).getByRole('button',{name:'Open project',exact:false}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('checkbox',{name:'Mobile check',exact:true}).check();
  await expect(dialog.getByRole('checkbox',{name:'Mobile check',exact:true})).toBeChecked();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();
  await page.locator('.project-card').filter({hasText:'Lane Concreting website'}).getByRole('button',{name:'Open project',exact:false}).click();
  await expect(page.getByRole('dialog').getByRole('checkbox',{name:'Mobile check',exact:true})).toBeChecked();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Launch project',exact:true})).toBeVisible();
});

test('commerce screens fit the available viewport',async({page})=>{
  for(const section of ['demos','quotes','projects','clients','invoices']){
    await page.goto(`/${section}`);
    await expect(page.getByRole('heading',{name:section.charAt(0).toUpperCase()+section.slice(1),exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${section} should not overflow`).toBe(true);
  }
});

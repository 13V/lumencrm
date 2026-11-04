import {test,expect} from '@playwright/test';

test('shortcuts avoid text fields and global search accepts normalised phone numbers',async({page})=>{
  await page.goto('/today');await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await page.keyboard.press('n');
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'Add lead',exact:true})).toBeVisible();
  await dialog.getByLabel('First name',{exact:true}).fill('Nora');
  await expect(dialog.getByLabel('First name',{exact:true})).toHaveValue('Nora');
  await page.keyboard.press('Escape');
  await page.locator('body').click({position:{x:5,y:100}});
  await page.keyboard.press('g');await page.keyboard.press('l');
  await expect(page).toHaveURL(/\/leads/);
  await expect(page.getByRole('heading',{name:'Leads',exact:true})).toBeVisible();
  await page.keyboard.press('/');
  await page.getByLabel('Search workspace').fill('+61 491 570 156');
  await expect(page.getByRole('dialog').getByRole('link',{name:/James Ellis/})).toBeVisible();
});

test('quick add confirms an existing contact without duplicating the open lead',async({page})=>{
  await page.goto('/today');await expect(page.locator('main')).toHaveAttribute('aria-busy','false');await page.keyboard.press('n');
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('First name',{exact:true}).fill('James');
  await dialog.getByLabel('Phone',{exact:true}).fill('0491 570 156');
  await dialog.getByRole('button',{name:'Add lead',exact:true}).click();
  await expect(dialog.getByText('This contact is already in Lumen.',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Save enquiry using existing contact',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/leads');await page.getByLabel('Search leads').fill('0491570156');
  await expect(page.locator('.list-row')).toHaveCount(1);
  await expect(page.getByRole('link',{name:'James Ellis',exact:true})).toBeVisible();
});

test('a saved view restores detailed filters after a reload',async({page})=>{
  await page.goto('/leads');await expect(page.locator('main')).toHaveAttribute('aria-busy','false');await page.getByText('More filters',{exact:true}).click();
  await page.getByLabel('Suburb',{exact:true}).selectOption('Norwood');
  await page.getByLabel('View name',{exact:true}).fill('Norwood follow-ups');
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await page.reload();await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await page.getByLabel('Saved view',{exact:true}).selectOption({label:'Norwood follow-ups'});
  await page.getByText('More filters',{exact:true}).click();
  await expect(page.getByLabel('Suburb',{exact:true})).toHaveValue('Norwood');
  await expect(page.locator('.list-row')).toHaveCount(1);
  await expect(page.getByRole('link',{name:'James Ellis',exact:true})).toBeVisible();
});

test('explicit messaging permission changes respect the contact choice',async({page})=>{
  await page.goto('/leads/demo-01');await page.getByRole('button',{name:'Edit',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Their choice',{exact:true}).selectOption('opt_out');
  await dialog.getByLabel('Evidence of their choice').fill('Asked not to receive texts during a fictional test call.');
  await dialog.getByRole('checkbox',{name:/accurately records/}).check();
  await dialog.getByRole('button',{name:'Record permission',exact:true}).click();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Text',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Edit',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('Their choice',{exact:true}).selectOption('opt_in');
  await dialog.getByLabel('Evidence of their choice').fill('Explicitly requested the quote by text during a fictional follow-up call.');
  await dialog.getByRole('checkbox',{name:/accurately records/}).check();
  await dialog.getByRole('button',{name:'Record permission',exact:true}).click();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Text',exact:true})).toBeEnabled();
});

test('time tracker measures elapsed time and persists whole minutes',async({page})=>{
  await page.clock.install();await page.goto('/leads/demo-01');
  const tracker=page.locator('.time-tracker').filter({hasText:'Pre-sales'});
  await tracker.getByRole('button',{name:'Start',exact:true}).click();
  await page.clock.fastForward(61000);
  await expect(tracker.locator('.timer-running')).toContainText('1:01');
  await tracker.getByRole('button',{name:'Stop & save',exact:true}).click();
  await expect(tracker.locator('.time-total')).toContainText('2 min');
  await page.reload();
  await expect(page.locator('.time-tracker').filter({hasText:'Pre-sales'}).locator('.time-total')).toContainText('2 min');
});

test('CSV mapping previews row errors before any import',async({page})=>{
  await page.goto('/settings');
  await expect(page.getByLabel('CSV file',{exact:true})).toBeEnabled();
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'fictional-contacts.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Phone,Business,Notes\nCasey Example,0491570156,Example Plumbing,Requested a call\nBroken Example,123,Example Gardens,Missing valid phone\n')});
  await page.getByRole('button',{name:'Preview import',exact:true}).click();
  await expect(page.locator('.import-preview')).toContainText('1 ready');
  await expect(page.locator('.import-preview')).toContainText('1 with errors');
  await expect(page.locator('.import-preview')).toContainText('Enter a valid phone number');
  await expect(page.getByRole('button',{name:'Import 1 valid rows',exact:true})).toBeDisabled();
  await expect(page.locator('.import-preview')).toContainText('No records have been changed');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('phone tasks remain readable and actions meet the touch target size',async({page})=>{
  test.skip(test.info().project.name!=='phone','Checks the phone typography and touch layout.');
  await page.goto('/today');await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  const task=page.locator('.task-copy h3').first();
  expect(await task.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(15);
  const call=page.locator('.lead-card').first().getByRole('link',{name:'Call',exact:true});
  expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('selected leads can be snoozed together and undone',async({page})=>{
  await page.goto('/leads');
  await page.getByRole('button',{name:'Select leads',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select James Ellis',exact:true}).check();
  await page.getByRole('checkbox',{name:'Select Sarah Mitchell',exact:true}).check();
  await page.getByRole('button',{name:'Snooze selected',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Snooze 2 leads',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Snooze selected',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('2 leads snoozed');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.goto('/leads/demo-01');
  await expect(page.getByText('Give this conversation a clear next step.',{exact:true})).toBeVisible();
});

test('unsent note drafts survive a reload and clear after saving',async({page})=>{
  await page.goto('/leads/demo-01');
  await page.getByLabel('Add a note',{exact:true}).fill('Fictional note kept for the next conversation.');
  await page.reload();
  await expect(page.getByLabel('Add a note',{exact:true})).toHaveValue('Fictional note kept for the next conversation.');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await expect(page.getByLabel('Add a note',{exact:true})).toHaveValue('');
  await expect(page.locator('.activity').filter({hasText:'Fictional note kept for the next conversation.'})).toHaveCount(1);
});

test('touch swipe opens snooze and a long press selects a lead',async({page})=>{
  test.skip(test.info().project.name!=='phone','Touch gestures apply to the phone layout.');
  await page.goto('/today');
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  const card=page.locator('.lead-card').first();
  await card.evaluate(el=>{const rect=el.getBoundingClientRect();const make=(x:number)=>new Touch({identifier:1,target:el,clientX:x,clientY:rect.y+30});el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[make(rect.x+220)]}));el.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,touches:[make(rect.x+110)]}));el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[make(rect.x+110)]}));});
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Snooze this lead',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await card.evaluate(el=>{const rect=el.getBoundingClientRect();const touch=new Touch({identifier:2,target:el,clientX:rect.x+100,clientY:rect.y+30});el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch]}));});
  await expect(page.locator('.selection-toolbar')).toContainText('1 selected');
  await card.evaluate(el=>{const rect=el.getBoundingClientRect();const touch=new Touch({identifier:2,target:el,clientX:rect.x+100,clientY:rect.y+30});el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[touch]}));});
  await expect(page.getByRole('checkbox',{name:'Select James Ellis',exact:true})).toBeChecked();
});

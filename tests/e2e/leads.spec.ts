import {test,expect} from '@playwright/test';

test('lead filters and detail edits persist without losing the conversation',async({page})=>{
  await page.goto('/leads');
  await page.getByLabel('Search leads').fill('Ellis');
  await expect(page.getByRole('link',{name:'James Ellis',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'James Ellis',exact:true}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Best time', {exact:true}).fill('Weekdays after 4 pm');
  await dialog.getByRole('button',{name:'Save contact',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved.');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByText('Weekdays after 4 pm',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Weekdays after 4 pm',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'The conversation',exact:true})).toBeVisible();
});

test('pipeline stage menu offers a persistent keyboard alternative to dragging',async({page})=>{
  await page.goto('/pipeline');
  const stage=page.getByLabel('Stage for James Ellis',{exact:true});
  await stage.selectOption('contacted');
  await expect(page.getByRole('region',{name:'Contacted stage'}).getByRole('link',{name:'James Ellis',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Stage for James Ellis',{exact:true})).toHaveValue('contacted');
});

test('pipeline handle drags a card to another stage',async({page})=>{
  test.skip(test.info().project.name==='phone','Pointer dragging is covered on desktop; phone uses the stage menu.');
  await page.goto('/pipeline');
  const handle=page.getByRole('button',{name:'Drag James Ellis to another stage'});
  const target=page.getByRole('region',{name:'Contacted stage'});
  await expect(handle).toBeEnabled();
  const from=await handle.boundingBox(),to=await target.boundingBox();
  expect(from).toBeTruthy();expect(to).toBeTruthy();
  await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);
  await page.mouse.down();
  await page.mouse.move(from!.x+from!.width/2+10,from!.y+from!.height/2,{steps:3});
  await page.mouse.move(to!.x+to!.width/2,to!.y+80,{steps:15});
  await page.mouse.up();
  await expect(page.getByLabel('Stage for James Ellis',{exact:true})).toHaveValue('contacted');
});

test('an unanswered call records a next step without claiming contact was made',async({page})=>{
  await page.goto('/today');
  await page.locator('.lead-card').filter({has:page.getByRole('link',{name:'James Ellis',exact:true})}).getByRole('button',{name:'Done',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Call outcome').selectOption('no_answer');
  await dialog.getByLabel('Next step',{exact:true}).fill('Try again after 4 pm');
  await dialog.getByRole('button',{name:'Tomorrow',exact:true}).click();
  await dialog.getByRole('button',{name:'Save call',exact:true}).click();
  await page.goto('/leads/demo-01');
  await expect(page.getByLabel('Stage',{exact:true})).toHaveValue('new');
  await expect(page.getByText('Try again after 4 pm',{exact:true})).toBeVisible();
});

test('text preview includes identification and opt-out and never sends in demo',async({page})=>{
  await page.goto('/leads/demo-01');
  await page.getByRole('button',{name:'Text',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Message template').selectOption('first-reply');
  await expect(dialog.locator('.message-preview')).toContainText('Hi James');
  await expect(dialog.locator('.message-preview')).toContainText('Lumen adl');
  await expect(dialog.locator('.message-preview')).toContainText('Reply STOP to opt out.');
  await expect(dialog.getByRole('button',{name:'Send text',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Do not contact this person').check();
  await page.getByRole('dialog').getByRole('button',{name:'Save contact',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Text',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Email',exact:true})).toBeDisabled();
});

test('calendar switches between day and week and explains private feed in demo',async({page})=>{
  await page.goto('/calendar');
  await expect(page.locator('.calendar-day')).toHaveCount(7);
  await page.getByRole('button',{name:'Day',exact:true}).click();
  await expect(page.locator('.calendar-day')).toHaveCount(1);
  await page.getByRole('button',{name:'Next day',exact:true}).click();
  await expect(page.locator('.calendar-day.is-today')).toHaveCount(0);
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect(page.locator('.calendar-day.is-today')).toHaveCount(1);
  await page.getByRole('button',{name:'Subscribe',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('available in your live workspace');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

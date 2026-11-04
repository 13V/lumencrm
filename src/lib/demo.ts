import type { CrmData, StageKey } from './types';
import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';

// Deliberately fictional businesses, example.com email addresses and ACMA-reserved numbers.
const PEOPLE = [
  ['James','Ellis','Ellis & Co Electrical','Electrician','Norwood'],
  ['Sarah','Mitchell','Form & Field Landscaping','Landscaper','Unley'],
  ['Daniel','Cooper','Cooper Plumbing Co.','Plumber','Glenelg'],
  ['Alex','Bennett','Bennett Built','Builder','Mitcham'],
  ['Olivia','Reed','Reed Painting Studio','Painter','Prospect'],
  ['Noah','Carter','Carter Climate','Air conditioning','Marion'],
  ['Amelia','Brooks','Brooks Roofing','Roofer','Burnside'],
  ['Henry','Parker','Parker Property Care','Handyman','Henley Beach'],
  ['Isla','Morgan','Morgan Joinery','Carpenter','Goodwood'],
  ['Jack','Bailey','Bailey Tiling','Tiler','St Peters'],
  ['Grace','Foster','Foster Earthworks','Earthmoving','Aldgate'],
  ['Leo','Hayes','Hayes Glassworks','Glazier','West Lakes'],
  ['Ruby','Clarke','Clarke Pool Care','Pool maintenance','Magill'],
  ['Oliver','Mason','Mason Security','Security installer','Walkerville'],
  ['Chloe','Ward','Ward Garden Co.','Gardener','Fullarton'],
  ['Thomas','Lane','Lane Concreting','Concreter','Blackwood'],
  ['Sophie','Turner','Turner Flooring','Flooring','Seaton'],
  ['William','Hart','Hart Solar','Solar installer','Mawson Lakes'],
  ['Ella','Reid','Reid Fencing','Fencing','Hawthorn'],
  ['Lucas','Gray','Gray Stonework','Stonemason','Crafers'],
  ['Mia','Wright','Wright Tree Care','Arborist','Belair'],
  ['Charlie','Wood','Wood & Wire','Electrician','Plympton'],
  ['Evie','Hill','Hill Cleaning Co.','Cleaner','Kensington'],
  ['Oscar','Green','Green Plumbing','Plumber','Parkside'],
  ['Zoe','Adams','Adams Renovations','Renovator','Grange'],
  ['Archie','Bell','Bell Brickwork','Bricklayer','Glynde'],
  ['Lily','Scott','Scott Render Co.','Renderer','Campbelltown'],
  ['George','Fox','Fox Garage Doors','Garage doors','Morphett Vale'],
  ['Lucy','King','King Pest Services','Pest control','Semaphore'],
  ['Hugo','West','West Waterproofing','Waterproofer','Croydon'],
];
const PHONES = ['0491570156','0491570157','0491570158','0491570006','0491570159','0491570110','0491570313','0491570737','0491571266','0491571491','0491571804','0491572549','0491572665','0491572983','0491573770','0491573087','0491574118','0491574632','0491575254','0491575789','0491576398','0491576801','0491577426','0491577644','0491578957','0491578148','0491578888','0491579212','0491579760','0491579455'];
const DEMO_STAGES: StageKey[] = ['new','new','new','call_booked','call_booked','brief','demo','quote','contacted','suitable','quote','brief','contacted','suitable','demo','won','contacted','won','brief','quote','suitable','contacted','won','brief','demo','contacted','won','suitable','quote','contacted'];

export function createDemoData(now = new Date()): CrmData {
  const today=formatInTimeZone(now,'Australia/Adelaide','yyyy-MM-dd');
  const todayAt=(time:string)=>fromZonedTime(`${today}T${time}:00`,'Australia/Adelaide').toISOString();
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
  const hoursAhead = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();
  const data: CrmData = { contacts: [], businesses: [], deals: [], tasks: [], appointments: [], activities: [], profiles: [{ id: 'demo-owner', full_name: 'Troy Watson', role: 'owner' }], attribution: [], user: { id: 'demo-owner', name: 'Troy Watson', email: 'troy@example.com' } };
  PEOPLE.forEach(([first_name,last_name,name,trade,suburb], i) => {
    const id = `demo-${String(i + 1).padStart(2,'0')}`;
    const business_id = `business-${id}`;
    const contact_id = `contact-${id}`;
    const phone = PHONES[i];
    const created_at = minutesAgo(i < 3 ? [3,12,38][i] : (i - 2) * 360);
    data.businesses.push({ id: business_id, name, trade, suburb, website_url: i % 3 === 0 ? `https://example.com/${first_name.toLowerCase()}` : null, service_areas: [suburb, 'Adelaide metro'] });
    data.contacts.push({ id: contact_id, business_id, first_name, last_name, phone_e164: `+61${phone.slice(1)}`, phone_display: `${phone.slice(0,4)} ${phone.slice(4,7)} ${phone.slice(7)}`, email: `${first_name.toLowerCase()}.${last_name.toLowerCase()}@example.com`, preferred_channel: i % 2 ? 'sms' : 'phone', best_time: i % 3 === 0 ? 'After 3 pm' : null, sms_opt_out_at: null, email_opt_out_at: null, do_not_contact: false });
    data.deals.push({ id, contact_id, business_id, title: `${name} website`, owner_id: 'demo-owner', channel: ['referral','meta_form','website','phone','business_card','chloe','manual','other'][i % 8], stage_key: DEMO_STAGES[i], outcome: DEMO_STAGES[i] === 'won' ? 'won' : i === 28 ? 'lost' : i === 27 ? 'unsuitable' : i === 29 ? 'noreply' : 'open', value_once: i > 5 ? i % 4 === 0 ? 4500 : 2200 : null, value_monthly: i > 5 ? 49 : null, promised_text: i === 1 ? 'A quick look at what a new website could do' : i === 6 ? 'Send the first homepage concept' : i === 10 ? 'Follow up on the website proposal' : null, promised_due_at: [1,6,10].includes(i) ? hoursAhead(i === 10 ? 22 : 3) : null, next_step: i === 0 || i === 11 || i === 14 ? null : i < 3 ? 'Make an introduction call' : i === 3 || i === 4 ? 'Discovery call' : i === 6 ? 'Share the homepage concept' : 'Check in and agree the next step', next_step_at: i === 0 || i === 11 || i === 14 ? null : hoursAhead(i < 3 ? 1 : (i % 5) * 12), first_touch_at: i < 3 ? null : minutesAgo((i - 2) * 360 - 3), two_way_at: i < 3 || i % 5 === 0 ? null : minutesAgo((i - 2) * 360 - 20), presales_minutes: i < 3 ? 0 : i * 8, demo_build_minutes: DEMO_STAGES[i] === 'demo' ? 45 : 0, created_at });
    data.attribution.push({ deal_id: id, source: data.deals[i].channel, utm_campaign: data.deals[i].channel === 'meta_form' ? 'Adelaide trades · Spring' : null, utm_content: data.deals[i].channel === 'meta_form' ? 'Your work deserves a better website' : null, utm_term: trade.toLowerCase() });
    data.activities.push({ id: `activity-${id}`, deal_id: id, contact_id, type: 'lead_created', body: `Enquiry received via ${data.deals[i].channel}.`, occurred_at: created_at, meta: {} });
    if (i > 2) data.activities.push({ id: `note-${id}`, deal_id: id, contact_id, type: 'note', body: i === 3 ? 'Looking for a simple website that shows recent projects. Most enquiries come through word of mouth. Discuss service areas and photography on the call.' : 'A local Adelaide business looking for a clear, useful website. Confirm priorities and timing at the next conversation.', occurred_at: minutesAgo((i - 2) * 180), meta: {} });
  });
  data.tasks = [
    { id: 'task-1', deal_id: 'demo-07', title: 'Send the homepage concept to Amelia', due_at: hoursAhead(-3), done_at: null, priority: 'high' },
    { id: 'task-2', deal_id: 'demo-06', title: 'Check the brief and service area list', due_at: hoursAhead(1), done_at: null, priority: 'normal' },
    { id: 'task-3', deal_id: 'demo-11', title: 'Follow up on Grace’s proposal', due_at: hoursAhead(2), done_at: null, priority: 'normal' },
    { id: 'task-4', deal_id: null, title: 'Set aside time for this week’s follow-ups', due_at: hoursAhead(4), done_at: null, priority: 'normal' },
  ];
  data.appointments = [
    { id: 'appointment-1', deal_id: 'demo-04', contact_id: 'contact-demo-04', starts_at: todayAt('09:30'), ends_at: todayAt('09:45'), kind: 'call', status: 'booked', source: 'manual', notes: 'Talk through recent projects, the right-fit customers and timing.' },
    { id: 'appointment-2', deal_id: 'demo-05', contact_id: 'contact-demo-05', starts_at: todayAt('14:00'), ends_at: todayAt('14:15'), kind: 'call', status: 'booked', source: 'manual', notes: 'Discuss a simple portfolio and an easy enquiry form.' },
  ];
  return data;
}

export const getDemoData = createDemoData;

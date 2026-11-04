// An isolated production-optimised fixture build. Never changes the working source,
// reads local secrets, or connects to a real provider. This measures the rendered UI;
// hosted authentication, database latency and delivery remain separate release checks.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import lighthouse from 'lighthouse';

const root = process.cwd(), reuse = process.env.QUALITY_FIXTURE, rebuild = process.env.QUALITY_REBUILD === '1';
assert(!reuse || /^production-fixture-\d+$/.test(reuse), 'Reuse only a generated fixture directory');
const folder = path.join(root, '.quality', reuse || `production-fixture-${Date.now()}`);
if (!reuse || rebuild) {
  await mkdir(folder, { recursive: true });
  for (const item of ['src', 'public', 'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs']) await cp(path.join(root, item), path.join(folder, item), { recursive: true });
  const source = path.join(folder, 'src/lib/supabase/server.ts');
  const original = await readFile(source, 'utf8');
  assert(original.includes("process.env.NODE_ENV !== 'production' && process.env.LUMEN_DEMO_MODE === 'true'"));
  await writeFile(source, original.replace("process.env.NODE_ENV !== 'production' && process.env.LUMEN_DEMO_MODE === 'true'", "process.env.LUMEN_DEMO_MODE === 'true'"));
  const config = path.join(folder, 'next.config.ts');
  await writeFile(config, (await readFile(config, 'utf8')).replace('const config: NextConfig = {', 'const config: NextConfig = { turbopack: { root: process.cwd() }, outputFileTracingRoot: process.cwd(),'));
}
const token = 'q'.repeat(43), requests = [];
const quote = { number: 'LUM-Q-FIXTURE', status: 'sent', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000 * 30).toISOString(), accepted_at: null, business_name: 'Fictional Adelaide Electrical', total_once: 2200, total_monthly: 49, terms_url: 'https://example.com/terms', notes: 'Fictional test quote.', items: [{ description: 'Website build', qty: 1, unit_price: 2200, kind: 'once', included: false, included_details: ['Agreed pages and mobile checks'] }, { description: 'Hosting and maintenance', qty: 1, unit_price: 49, kind: 'monthly', included: false, included_details: [] }, { description: 'Local SEO months 1–3', qty: 1, unit_price: 0, kind: 'once', included: true, included_details: [] }], lumen: { trading_name: 'Lumen adl', phone: '+61491570156', email: 'troy@example.com' }, deposit_percentage: 50, gst: { registered: false, wording: 'No GST has been charged.' } };
const stub = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {}; const method = request.url?.split('/').at(-1);
  response.setHeader('Content-Type', 'application/json');
  if (body.p_token !== token) { response.statusCode = 404; response.end('{}'); return; }
  requests.push({ method, body });
  if (method === 'public_quote') response.end(JSON.stringify(quote));
  else if (method === 'record_quote_view') response.end('null');
  else if (method === 'accept_quote') { quote.accepted_at = new Date().toISOString(); response.end(JSON.stringify({ accepted_at: quote.accepted_at, already_accepted: false, deal_id: 'must-not-reach-browser' })); }
  else { response.statusCode = 404; response.end('{}'); }
});
const savedPort = reuse ? Number(process.env.QUALITY_STUB_PORT || JSON.parse(await readFile(path.join(folder, 'fixture.json'), 'utf8')).stubPort) : 0;
await new Promise(resolve => stub.listen(savedPort, '127.0.0.1', resolve));
const stubPort = stub.address().port, appPort = 3017, chromePort = 9237;
await writeFile(path.join(folder, 'fixture.json'), JSON.stringify({stubPort}));
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, PNPM_HOME: process.env.PNPM_HOME, APP_URL: `http://127.0.0.1:${appPort}`, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${stubPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional-test-anon-key', LUMEN_DEMO_MODE: 'true', NEXT_TELEMETRY_DISABLED: '1' };
function command(args, options = {}) { return spawn(args[0], args.slice(1), { cwd: folder, env, stdio: 'inherit', windowsHide: true, ...options }); }
async function run(args) { const child = command(args); await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))); }); }
let server, browser, quotePage;
try {
  // pnpm's entry point avoids cmd-string quoting on Windows.
  const pnpmEntry = process.env.PNPM_SCRIPT || process.env.npm_execpath;
  if (!pnpmEntry) throw new Error('Run this through pnpm check:production, or set PNPM_SCRIPT to the Node entry point of pnpm.');
  if (!reuse || rebuild) {
    await run([process.execPath, pnpmEntry, 'install', '--frozen-lockfile']);
    await run([process.execPath, path.join(folder, 'node_modules/next/dist/bin/next'), 'build']);
  }
  server = command([process.execPath, path.join(folder, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(appPort)]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) { try { const response = await fetch(`${env.APP_URL}/today`); if (response.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  assert(ready, 'Fixture production server did not start');
  browser = await chromium.launch({ args: [`--remote-debugging-port=${chromePort}`] });
  const result = await lighthouse(`${env.APP_URL}/today`, { port: chromePort, output: 'json', onlyCategories: ['performance', 'accessibility'], formFactor: 'mobile', screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 1, disabled: false }, logLevel: 'error' });
  await writeFile(path.join(folder, 'lighthouse.json'), result.report);
  const summary = { kind: 'isolated production fixture; no real auth or database', performance: result.lhr.categories.performance.score * 100, accessibility: result.lhr.categories.accessibility.score * 100, javascript: result.lhr.audits['resource-summary'].details.items.find(row => row.resourceType === 'script'), metrics: result.lhr.audits.metrics.details.items[0] };
  await writeFile(path.join(folder, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({performance:summary.performance,accessibility:summary.accessibility,javascript:summary.javascript}));
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  quotePage = page;
  const loginResponse = await page.goto(`${env.APP_URL}/login`);
  assert(loginResponse.headers()['content-security-policy'].includes("'nonce-"));
  await page.waitForLoadState('networkidle');
  assert(await page.locator('script[nonce]').count(), 'Sign-in HTML must carry a per-request CSP nonce');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('alex@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('status').filter({ hasText: 'We could not send a sign-in link.' }).waitFor();
  summary.sign_in = 'production CSP nonce and hydrated sign-in handler passed; local auth fixture intentionally refuses delivery';
  await page.goto(`${env.APP_URL}/q/${token}`);
  await page.getByRole('heading', { name: 'A clear plan for your website.' }).waitFor();
  assert((await page.locator('body').innerText()).includes('$2,200'));
  assert((await page.locator('body').innerText()).includes('$49/month'));
  assert((await page.locator('body').innerText()).includes('Included'));
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  assert.equal(scan.violations.length, 0, JSON.stringify(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
  await page.screenshot({ path: path.join(folder, 'public-quote.png'), fullPage: true });
  await page.getByLabel('Your full name').fill('Alex Fictional');
  await page.getByLabel('I accept this quote and the terms.').check();
  await page.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await page.getByRole('heading', { name: 'Thank you. Your quote is accepted.' }).waitFor();
  assert(requests.some(row => row.method === 'record_quote_view'));
  const accepted = requests.find(row => row.method === 'accept_quote');
  assert.equal(accepted.body.p_name, 'Alex Fictional'); assert.equal(accepted.body.p_terms_accepted, true); assert(accepted.body.p_user_agent);
  const html = await page.content(); assert(!html.includes('must-not-reach-browser'));
  summary.public_quote = 'phone display, accessible form, view, acceptance evidence and response isolation passed with local RPC fixture; SQL acceptance tested separately';
  await writeFile(path.join(folder, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ folder, ...summary }, null, 2));
  if (summary.performance < 90 || summary.accessibility < 90) process.exitCode = 1;
} finally {
  await writeFile(path.join(folder, 'fixture-rpc.json'), JSON.stringify(requests, null, 2));
  if (quotePage) await writeFile(path.join(folder, 'quote-page.html'), await quotePage.content());
  if (browser) await browser.close();
  if (server) server.kill();
  await new Promise(resolve => stub.close(resolve));
}

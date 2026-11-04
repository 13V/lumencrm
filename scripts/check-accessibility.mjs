import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.CHECK_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const results = [];
await mkdir('test-results/accessibility', { recursive: true });
try {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const route of ['today', 'leads', 'pipeline', 'calendar', 'reports', 'quotes', 'projects', 'invoices', 'settings']) {
        await page.goto(`${origin}/${route}`);
        await page.locator('main.main-content[aria-busy="false"]').waitFor();
        await page.waitForLoadState('networkidle');
        const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        const result = { route, width, theme, overflow, violations: scan.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) };
        results.push(result);
        console.log(`${result.violations.length || overflow ? 'FAIL' : 'PASS'} ${width} ${theme} /${route}: ${result.violations.length} violations${overflow ? ', page overflow' : ''}`);
        if (route === 'today' || result.violations.length || overflow) await page.screenshot({ path: `test-results/accessibility/${route}-${width}-${theme}.png`, fullPage: true });
      }
    }
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('test-results/accessibility/report.json', JSON.stringify(results, null, 2));
if (results.some(r => r.overflow || r.violations.length)) process.exitCode = 1;

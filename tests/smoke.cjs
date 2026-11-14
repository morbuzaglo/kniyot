const { chromium, devices } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'], defaultBrowserType: undefined, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type()==='warning') errs.push(m.type()+': '+m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8080/#home');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/s-home.png' });
  await page.goto('http://localhost:8080/#search');
  await page.fill('.search-input', 'חלב');
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/s-search.png' });
  console.log(await page.locator('.pcard').count(), 'results');
  console.log(errs.join('\n'));
  await browser.close();
})();

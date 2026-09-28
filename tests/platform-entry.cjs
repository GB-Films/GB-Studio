const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
  fs.readFile(file, (error, content) => {
    if (error) { response.statusCode = 404; response.end(); }
    else response.end(content);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    const url = `http://127.0.0.1:${server.address().port}`;

    await page.goto(url);
    assert.equal(await page.title(), 'GB Studio · Storyboards');
    assert.equal(await page.locator('#dashboardReviewsBtn').count(), 0);
    assert.equal(await page.locator('#reviewsNav').isVisible(), false);
    assert.doesNotMatch(await page.locator('.dashboard-hero-copy').textContent(), /reviews/i);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.body.classList.remove('auth-locked');
      document.querySelector('#authGate').hidden = true;
      window.STUDIO_PERMISSIONS = { storyboards: true, reviewsView: true };
      window.dispatchEvent(new Event('studio-auth-change'));
    });
    await page.locator('.brand').click();
    assert.equal(await page.locator('#dashboardView').isVisible(), true);
    assert.equal(await page.locator('#reviewsHome').isVisible(), false);

    await page.goto(`${url}/?app=reviews`);
    assert.equal(await page.title(), 'GB Studio · Reviews');
    assert.equal(await page.locator('#storyboardsNav').isVisible(), false);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.body.classList.remove('auth-locked');
      document.querySelector('#authGate').hidden = true;
      window.STUDIO_PERMISSIONS = { storyboards: true, reviewsView: true };
      window.dispatchEvent(new Event('studio-auth-change'));
      window.STUDIO_SHOW_REVIEWS();
    });
    assert.equal(await page.locator('#reviewsHome').isVisible(), true);
    await page.locator('.brand').click();
    assert.equal(await page.locator('#reviewsHome').isVisible(), true);
    assert.equal(await page.locator('#dashboardView').isVisible(), false);
    await page.goto(`${url}/#share=${'A'.repeat(43)}`);
    await page.waitForURL(/\?app=reviews#share=/);
    assert.equal(await page.title(), 'GB Studio · Reviews', 'old guest links resolve inside Reviews');
    assert.deepEqual(errors, []);
    console.log('Independent Storyboards and Reviews entries passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

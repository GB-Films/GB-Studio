const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const server = http.createServer((request, response) => {
  let pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(pathname)] || 'text/plain');
  fs.readFile(path.join(root, pathname), (error, data) => { response.statusCode = error ? 404 : 200; response.end(error ? '' : data); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const crawler = await browser.newContext({ javaScriptEnabled: false });
    const preview = await crawler.newPage();
    await preview.goto(origin + '/mira/');
    assert.match(await preview.title(), /^MIRA/);
    assert.match(await preview.locator('meta[property="og:site_name"]').getAttribute('content'), /GB Films/);
    const metaImage = await preview.locator('meta[property="og:image"]').getAttribute('content');
    assert.match(metaImage, /assets\/mira-social-v1.png$/);
    await preview.goto(origin + '/assets/mira-social-v1.png');
    assert.deepEqual(await preview.locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [1200, 630]);
    const page = await browser.newPage();
    // Do not initialize the actual app or contact Firebase in this routing test.
    await page.route(origin + '/?app=reviews*', route => route.fulfill({ contentType: 'text/html', body: '<title>Review</title>' }));
    for (const token of ['A'.repeat(22), 'B'.repeat(43)]) {
      await page.goto(origin + '/mira/#' + token + '.ANz0q1bQQ9q8g2KXYvPJfg');
      await page.waitForURL(origin + '/?app=reviews#share=' + token + '&file=00dcf4ab-56d0-43da-bc83-629762f3c97e');
    }
    await page.goto(origin + '/mira/#invalid');
    await page.locator('#status').filter({ hasText: 'Este enlace no es válido' }).waitFor();
    console.log('MIRA preview passed: static crawler metadata, 1200x630 image, short/legacy redirects and invalid links.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

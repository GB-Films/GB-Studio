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
    assert.match(metaImage, /assets\/gb-films-icon.png\?v=2$/);
    assert.equal(await preview.locator('meta[property="og:image:alt"]').getAttribute('content'), 'Logo oficial de GB Films sobre fondo negro.');
    assert.equal(await preview.locator('meta[property="og:image:width"]').getAttribute('content'), '1920');
    assert.equal(await preview.locator('meta[property="og:image:height"]').getAttribute('content'), '1920');
    await preview.goto(origin + '/assets/gb-films-icon.png?v=2');
    assert.deepEqual(await preview.locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [1920, 1920]);
    const page = await browser.newPage();
    // Do not initialize the actual app or contact Firebase in this routing test.
    await page.route(origin + '/?app=reviews*', route => route.fulfill({ contentType: 'text/html', body: '<title>Review</title>' }));
    for (const token of ['A'.repeat(22), 'B'.repeat(43)]) {
      await page.goto(origin + '/mira/#' + token + '.ANz0q1bQQ9q8g2KXYvPJfg');
      await page.waitForURL(origin + '/?app=reviews#share=' + token + '&file=00dcf4ab-56d0-43da-bc83-629762f3c97e');
    }
    await page.route('**/reviews-cloud.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function getReviewAlias(alias) {
        if (alias !== 'qm-0003-stella-cartel-montaje-v1') throw Error('Unavailable');
        return { token: '${'C'.repeat(22)}', fileId: 'client-video' };
      }` }));
    await page.goto(origin + '/mira/#/qm-0003-stella-cartel-montaje-v1');
    await page.waitForURL(origin + '/?app=reviews#share=' + 'C'.repeat(22) + '&file=client-video');
    await page.goto(origin + '/mira/#/unknown-project');
    await page.locator('#status').filter({ hasText: 'No se pudo abrir este enlace' }).waitFor();
    assert.match(page.url(), /mira\/#\/unknown-project$/);
    await page.goto(origin + '/mira/#invalid');
    await page.locator('#status').filter({ hasText: 'No se pudo abrir este enlace' }).waitFor();
    console.log('MIRA preview passed: official GB-only icon, square metadata, named/legacy redirects and unavailable links.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

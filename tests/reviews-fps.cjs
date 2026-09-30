const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures');
// Exercise the real cloud serialization while replacing only the transport.
const cloudSource = fs.readFileSync(path.join(root, 'reviews-cloud.js'), 'utf8');
const serializeFile = cloudSource.slice(cloudSource.indexOf('function cloudFile('), cloudSource.indexOf('export async function publishReview'));
const fakeCloud = `
  ${serializeFile}
  const load = key => JSON.parse(localStorage.getItem('fps-cloud-' + key) || '[]');
  const upsert = (key, value) => localStorage.setItem('fps-cloud-' + key, JSON.stringify([...load(key).filter(item => item.id !== value.id), value]));
  export async function listStaffProjects() { return load('projects'); }
  export async function listStaffFiles() { return load('files'); }
  export async function listSharedReviews() { return []; }
  export async function saveStaffProject(project) { upsert('projects', project); }
  export async function saveStaffFile(record) { upsert('files', { ...cloudFile(record), id: record.id, projectId: record.projectId, versionId: record.versionId, comments: record.comments }); }
`;

async function main() {
  const { videoMetadata, remoteReader } = await import(pathToFileURL(path.join(root, 'reviews-video-metadata.js')));
  assert.equal(videoMetadata({ media: { track: [{ '@type': 'Audio', FrameRate: 46.875 }, { '@type': 'Video' }] } }).fps, null, 'audio rate and missing video FPS are not a fallback');
  assert.equal(videoMetadata({ media: { track: [{ '@type': 'Video', FrameRate: 29.97, FrameRate_Num: 30000, FrameRate_Den: 1001, FrameRate_Mode: 'CFR' }] } }).fps, 30000 / 1001, 'the rational rate is preserved, not rounded to 29.97 or 30');
  assert.equal(videoMetadata({ media: { track: [{ '@type': 'Video', FrameRate: 25, FrameRate_Minimum: 15, FrameRate_Maximum: 30 }] } }).fpsMode, 'variable');
  assert.equal(videoMetadata({ media: { track: [{ '@type': 'Video', FrameRate: 25 }] } }).fpsMode, 'unknown', 'a missing mode does not claim CFR');

  const rangeRequests = [];
  const movie = fs.readFileSync(path.join(fixtures, 'review-25.mp4'));
  let moov = 0;
  while (movie.toString('ascii', moov + 4, moov + 8) !== 'moov') moov += movie.readUInt32BE(moov);
  const padding = Buffer.alloc(32 * 1024 * 1024);
  padding.writeUInt32BE(padding.length); padding.write('free', 4, 'ascii');
  const largeMovie = Buffer.concat([movie.subarray(0, moov), padding, movie.subarray(moov)]);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/large-no-range') {
      response.setHeader('Content-Length', 64 * 1024 * 1024);
      response.write(Buffer.alloc(32)); return;
    }
    if (pathname === '/padded.mp4') {
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
      if (!range) { response.writeHead(200, { 'Content-Length': largeMovie.length }); response.end(largeMovie); return; }
      const start = Number(range[1]), end = Math.min(Number(range[2]), largeMovie.length - 1);
      rangeRequests.push({ start, end });
      response.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${largeMovie.length}`, 'Content-Length': end - start + 1 });
      response.end(largeMovie.subarray(start, end + 1)); return;
    }
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
    if (!size) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm' })[path.extname(file)] || 'application/octet-stream');
    if (request.method === 'HEAD') { response.setHeader('Content-Length', size); response.end(); return; }
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2]), size - 1);
      rangeRequests.push({ start, end });
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(response);
    } else { response.setHeader('Content-Length', size); fs.createReadStream(file).pipe(response); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    await assert.rejects(remoteReader([`${base}/large-no-range`]), /por partes/, 'an ignored Range cannot download an entire large video');
    const reader = await remoteReader([`${base}/tests/fixtures/review-25.mp4`]);
    assert.equal(reader.size, fs.statSync(path.join(fixtures, 'review-25.mp4')).size);
    assert.deepEqual(Buffer.from(await reader.read(16, reader.size - 16)), fs.readFileSync(path.join(fixtures, 'review-25.mp4')).subarray(-16), 'the reader can address the tail');

    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    await page.route('**/reviews-cloud.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: fakeCloud }));
    const serveVideo = async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      const isProbe = route.request().resourceType() !== 'media';
      if (name === 'blocked.mp4' && isProbe) return route.abort('accessdenied');
      if (name === 'delayed.mp4' && isProbe) await new Promise(resolve => setTimeout(resolve, 500));
      const body = fs.readFileSync(path.join(fixtures, name === 'blocked.mp4' ? 'review-25.mp4' : name === 'delayed.mp4' ? 'review-24.mp4' : name));
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
      const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range', 'accept-ranges': 'bytes' };
      if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-length': String(body.length) } });
      if (!range) return route.fulfill({ status: 200, contentType: name.endsWith('.webm') ? 'video/webm' : 'video/mp4', headers, body });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      return route.fulfill({ status: 206, contentType: name.endsWith('.webm') ? 'video/webm' : 'video/mp4', headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
    };
    await page.route('https://dl.dropboxusercontent.com/**', serveVideo);
    await page.route('https://www.dropbox.com/scl/fi/**', serveVideo);
    const unlock = async () => {
      await page.waitForTimeout(300);
      await page.evaluate(() => {
      document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true;
      window.STUDIO_SIGNED_IN = true; window.STUDIO_ROLE = 'admin'; window.STUDIO_USER = { uid: 'fps-test', email: 'fps-test@example.com' };
      window.STUDIO_PERMISSIONS = { storyboards: true, reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true };
      window.dispatchEvent(new Event('studio-auth-change'));
      });
      await page.locator('#reviewsNav').click();
    };
    await page.goto(`${base}/?app=reviews`);
    rangeRequests.length = 0;
    const largeMetadata = await page.evaluate(async url => {
      const { inspectVideo } = await import('./reviews-video-metadata.js?v=1');
      return inspectVideo({ urls: [url] });
    }, `${base}/padded.mp4`);
    assert.equal(largeMetadata.fps, 25);
    assert.ok(rangeRequests.some(range => range.start > 32 * 1024 * 1024), 'large movies are inspected at the tail when headers are not at the start');
    assert.ok(rangeRequests.reduce((bytes, range) => bytes + range.end - range.start + 1, 0) < 1024 * 1024, 'metadata detection does not download the full 32 MB file');
    await unlock();
    await page.locator('#reviewsCreateProject').click();
    await page.locator('#reviewsEntityTitle').fill('FPS reales');
    await page.locator('#reviewsEntityClient').fill('Prueba');
    await page.locator('#reviewsEntityForm button[type=submit]').click();
    await page.locator('#reviewsFormModal').waitFor({ state: 'hidden' });
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').first().click();
    const link = async name => {
      await page.locator('#reviewsLinkBtn').click();
      await page.locator('#reviewsLinkUrl').fill(`https://www.dropbox.com/scl/fi/fps/${name}?rlkey=test`);
      await page.locator('#reviewsLinkForm button[type=submit]').click();
      await page.waitForFunction(filename => document.querySelector('#reviewsVideo').getAttribute('src')?.includes(filename), name);
    };
    const storedRate = () => page.evaluate(async () => new Promise(resolve => {
      const open = indexedDB.open('gb-studio-reviews-v1');
      open.onsuccess = () => { const get = open.result.transaction('items').objectStore('items').getAll(); get.onsuccess = () => resolve(get.result.find(record => record.name === document.querySelector('#reviewsMediaTitle').textContent)); };
    }));
    for (const [name, expected] of [
      ['review-24.mp4', 24], ['review-25.mp4', 25], ['review-30.mp4', 30], ['review-50.mp4', 50], ['review-60.mp4', 60],
      ['review-24000-1001.mp4', 24000 / 1001], ['review-30000-1001.mp4', 30000 / 1001], ['review-60000-1001.mp4', 60000 / 1001], ['review-25fps.webm', 25]
    ]) {
      await link(name);
      await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'ready');
      assert.equal(await page.locator('#reviewsFps').textContent(), String(Number(expected.toFixed(3))), `${name} shows its own FPS`);
      await page.waitForFunction(() => document.querySelector('#reviewsVideo').duration > 0);
      await page.locator('#reviewsTimelineMode').selectOption('frames');
      await page.locator('#reviewsFrameJump').fill('6');
      await page.locator('#reviewsFrameJump').dispatchEvent('change');
      assert.ok(Math.abs(await page.evaluate(() => document.querySelector('#reviewsVideo').currentTime) - 5 / expected) < .0001, `${name} seeks with its own exact frame rate`);
      await page.waitForFunction(async expectedRate => new Promise(resolve => { const open = indexedDB.open('gb-studio-reviews-v1'); open.onsuccess = () => { const get = open.result.transaction('items').objectStore('items').getAll(); get.onsuccess = () => resolve(get.result.find(record => record.name === document.querySelector('#reviewsMediaTitle').textContent)?.fps === expectedRate); }; }), expected);
      assert.equal((await storedRate()).fpsSource, 'metadata');
      const published = await page.evaluate(filename => JSON.parse(localStorage.getItem('fps-cloud-files')).find(file => file.name === filename), name);
      assert.equal(published.fps, expected, 'the cloud/share payload preserves the exact rate');
      assert.equal(published.fpsSource, 'metadata');
      console.log(`${name}: ${expected} FPS, saved and used for frame navigation`);
    }
    await page.reload(); await unlock();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'FPS reales' }).click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').first().click();
    await page.locator('.reviews-file').filter({ hasText: 'review-25fps.webm' }).click();
    await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'ready');
    assert.equal(await page.locator('#reviewsFps').textContent(), '25', 'reload does not reset the video to 24');

    // Migrate the false default persisted by the previous release.
    await page.evaluate(async () => new Promise(resolve => { const open = indexedDB.open('gb-studio-reviews-v1'); open.onsuccess = () => { const tx = open.result.transaction('items', 'readwrite'); const store = tx.objectStore('items'); const get = store.getAll(); get.onsuccess = () => { const record = get.result.find(item => item.name === 'review-25fps.webm'); record.fps = 24; delete record.fpsSource; store.put(record); }; tx.oncomplete = resolve; }; }));
    await page.evaluate(() => { const files = JSON.parse(localStorage.getItem('fps-cloud-files')); const record = files.find(file => file.name === 'review-25fps.webm'); record.fps = 24; delete record.fpsSource; localStorage.setItem('fps-cloud-files', JSON.stringify(files)); });
    await page.reload(); await unlock();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'FPS reales' }).click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').first().click();
    await page.locator('.reviews-file').filter({ hasText: 'review-25fps.webm' }).click();
    await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'ready');
    assert.equal(await page.locator('#reviewsFps').textContent(), '25', 'an old stored 24 is re-detected');

    await link('review-vfr.mp4');
    await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'ready');
    assert.match(await page.locator('#reviewsFps').textContent(), /Variable/);
    assert.equal(await page.locator('#reviewsNextFrame').isDisabled(), true, 'a VFR average is not used as a fixed frame clock');
    assert.equal(await page.locator('#reviewsTimelineMode').inputValue(), 'time');
    await link('blocked.mp4');
    await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'unavailable');
    assert.equal(await page.locator('#reviewsFps').textContent(), 'Sin detectar');
    assert.equal(await page.locator('#reviewsFrameNumber').textContent(), 'Fotograma —');
    assert.equal(await page.locator('#reviewsNextFrame').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('#reviewsVideo').duration > 0);
    await page.locator('#reviewsPlayBtn').click();
    await page.waitForFunction(() => document.querySelector('#reviewsVideo').currentTime > .05);
    assert.equal(await page.locator('#reviewsMediaError').isVisible(), false, 'metadata failure does not block playback');

    await link('delayed.mp4');
    await page.locator('.reviews-file').filter({ hasText: 'review-60.mp4' }).click();
    await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'ready');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#reviewsFps').textContent(), '60', 'a canceled probe cannot change the next selected video');
    if (process.env.REVIEW_FPS_SCREENSHOT) await page.screenshot({ path: process.env.REVIEW_FPS_SCREENSHOT });
    await page.goto(`${base}/#${new URLSearchParams({ review: 'https://www.dropbox.com/scl/fi/fps/review-30000-1001.mp4?rlkey=test', kind: 'video' })}`);
    await page.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status === 'ready');
    assert.equal(await page.locator('#reviewsFps').textContent(), '29.97', 'public guest playback reads the original rate too');
    assert.deepEqual(errors, []);
    console.log('Mira FPS checks passed: real CFR/NTSC/WebM/VFR files, migration, persistence, seeking, CORS failure, cancellation and guest viewing.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

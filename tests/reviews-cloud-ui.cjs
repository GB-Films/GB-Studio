const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const fulfillVideo = (route, base64) => {
  const body = Buffer.from(base64, 'base64');
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
  if (!range) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' }, body });
  const start = Math.min(Number(range[1]), body.length - 1);
  const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'content-range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
};

const root = path.join(__dirname, '..');
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/__blank') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Blank</title>'); return; }
  const file = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
  fs.readFile(file, (error, data) => { if (error) { response.statusCode = 404; response.end(); } else response.end(data); });
});
const fakeCloud = `
  const load = key => JSON.parse(localStorage.getItem('test-cloud-' + key) || '[]');
  const save = (key, value) => localStorage.setItem('test-cloud-' + key, JSON.stringify(value));
  const commentWatchers = new Map();
  const upsert = (key, value) => save(key, [...load(key).filter(item => item.id !== value.id), value]);
  export async function saveStaffProject(project) { upsert('projects', project); }
  export async function listStaffProjects() { return load('projects'); }
  export async function deleteStaffProject(id) { save('projects', load('projects').filter(item => item.id !== id)); }
  export async function saveStaffFile(file) { upsert('files', file); }
  export async function listStaffFiles() { return load('files'); }
  export async function deleteStaffFile(id) { save('files', load('files').filter(item => item.id !== id)); }
  export async function listReviewShares() { return load('published'); }
  export async function listSharedReviews(tokens = null) { return load('published').filter(share => !tokens || tokens.includes(share.token)); }
  export async function staffList() { return load('staff'); }
  export const ALL_PERMISSIONS = { storyboards: true, reviewsClient: true, reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true };
  export async function accessRequests() { return load('requests'); }
  export async function saveStaff(email, permissions, name = '', options = {}) { save('staff', [...load('staff').filter(item => item.email !== email), { email, name, permissions, active: options.active, roles: options.roles, reviewTokens: options.reviewTokens }]); }
  export async function removeStaff(email) { save('staff', load('staff').filter(item => item.email !== email)); save('requests', load('requests').filter(item => item.email !== email)); }
  export async function publishReview(project, version, records) {
    const share = { token: 'A'.repeat(43), projectId: project.id, versionId: version.id, projectTitle: project.title,
      versionTitle: version.title, category: version.category, updatedAt: new Date().toISOString(), active: true,
      fileCount: records.length, files: records.map(record => ({ ...record, comments: [] })) };
    save('published', [...load('published'), share]); return share.token;
  }
  export async function updateShareMetadata() {}
  export async function publishReviewAlias(project, version, token, file, multipleFiles) {
    const { shareAliasBase, reserveShareAlias, sameShareTarget } = await import('./reviews-links.js?v=2');
    const target = { token, fileId: file.id, projectId: project.id, versionId: version.id };
    return reserveShareAlias(shareAliasBase(project, version, file, multipleFiles), async alias => {
      const existing = load('aliases').find(item => item.alias === alias);
      if (existing) return sameShareTarget(existing, target);
      save('aliases', [...load('aliases'), { alias, ...target }]); return true;
    });
  }
  export async function getReviewAlias(alias) {
    const target = load('aliases').find(item => item.alias === alias);
    if (!target || !load('published').some(share => share.token === target.token && share.active && share.files.some(file => file.id === target.fileId))) throw Error('Review unavailable');
    return target;
  }
  export async function upsertSharedFile() {}
  export async function getSharedReview(token) { const share = load('published').find(item => item.token === token); if (!share) throw new Error('Unknown share'); return share; }
  export async function guestIdentity() { return { uid: window.STUDIO_USER?.uid || 'anonymous-test' }; }
  export async function addSharedComment(token, fileId, comment, authorName) { save('comments', [...load('comments'), { ...comment, fileId, authorUid: (await guestIdentity()).uid, authorName }]); commentWatchers.get(fileId)?.(load('comments').filter(item => item.fileId === fileId)); }
  export async function editOwnSharedComment(token, fileId, id, text) {
    const comment = load('comments').find(item => item.id === id && item.fileId === fileId);
    if (window.failCommentEdit || comment?.authorUid !== (await guestIdentity()).uid) throw new Error('permission-denied');
    save('comments', load('comments').map(item => item.id === id && item.fileId === fileId ? { ...item, text } : item));
    commentWatchers.get(fileId)?.(load('comments').filter(item => item.fileId === fileId));
  }
  export async function changeSharedComment(token, fileId, comment) {
    save('comments', load('comments').map(item => item.id === comment.id && item.fileId === fileId ? { ...item, resolved: comment.resolved } : item));
    commentWatchers.get(fileId)?.(load('comments').filter(item => item.fileId === fileId));
  }
  export async function deleteSharedComment(token, fileId, id) {
    const comment = load('comments').find(item => item.id === id && item.fileId === fileId);
    if (window.failCommentDelete || comment?.authorUid !== (await guestIdentity()).uid) throw new Error('permission-denied');
    save('comments', load('comments').filter(item => item.id !== id || item.fileId !== fileId));
    commentWatchers.get(fileId)?.(load('comments').filter(item => item.fileId === fileId));
  }
  export function watchComments(token, file, callback) { commentWatchers.set(file, callback); callback(load('comments').filter(comment => comment.fileId === file)); return () => commentWatchers.delete(file); }
`;
const fakeFirebaseApp = `export function initializeApp() { return {}; }`;
const fakeFirebaseAuth = `
  const auth = { currentUser: null }; let listener;
  export class GoogleAuthProvider {}
  export function getAuth() { return auth; }
  export function onAuthStateChanged(instance, callback) { listener = callback; queueMicrotask(() => callback(instance.currentUser)); return () => { listener = null; }; }
  export async function signInWithPopup(instance) {
    const user = { uid: 'google-test', email: 'cliente@example.com', displayName: 'Cliente Google', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
    instance.currentUser = user; listener?.(user); return { user };
  }
  export async function signOut(instance) { instance.currentUser = null; listener?.(null); }
`;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext();
    let page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: route.request().url().includes('firebase-app.js') ? fakeFirebaseApp : fakeFirebaseAuth }));
    await context.route('**/reviews-cloud.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: fakeCloud }));
    await context.route('https://dl.dropboxusercontent.com/scl/fi/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>' }));
    await context.route('https://www.dropbox.com/scl/fi/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>' }));
    const url = `http://127.0.0.1:${server.address().port}`;
    const reviewsUrl = `${url}/?app=reviews`;
    const authorize = async () => {
      await page.waitForTimeout(350);
      await page.evaluate(() => {
        document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true;
        window.STUDIO_SIGNED_IN = true; window.STUDIO_ROLE = 'admin'; window.STUDIO_PERMISSIONS = { storyboards: true, reviewsClient: true, reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true }; window.STUDIO_REVIEW_TOKENS = []; window.STUDIO_USER = { uid: 'test-admin', email: 'info@granbertafilms.com', displayName: 'Admin' };
        window.dispatchEvent(new Event('studio-auth-change'));
      });
    };
    const rejectTabCapture = async target => target.evaluate(() => {
      window.captureRequests = 0;
      navigator.mediaDevices.getDisplayMedia = async () => {
        window.captureRequests += 1;
        throw new Error('The browser permission dialog must not open');
      };
    });
    await page.goto(reviewsUrl);
    assert.equal(await page.title(), 'GB Studio · Mira');
    assert.equal(await page.locator('#storyboardsNav').isVisible(), false, 'the Reviews entry does not show Storyboards navigation');
    assert.equal(await page.locator('#authGate').isVisible(), true, 'the studio starts behind the access gate');
    await authorize();
    await page.locator('#reviewsNav').click();
    await page.locator('#reviewsCreateProject').click();
    assert.equal(await page.locator('input[name="reviewsCoverType"][value="color"]').isChecked(), true, 'new projects select a solid color by default');
    assert.equal(await page.locator('#reviewsCoverColor').isVisible(), true);
    assert.equal(await page.locator('#reviewsCoverPreview').evaluate(preview => getComputedStyle(preview).backgroundColor), 'rgb(232, 111, 76)');
    await page.locator('#reviewsEntityTitle').fill('Proyecto sincronizado');
    await page.locator('#reviewsEntityClient').fill('Cliente');
    await page.locator('#reviewsEntityForm button[type=submit]').click();
    await page.waitForFunction(() => Boolean(localStorage.getItem('test-cloud-projects')));
    assert.deepEqual(await page.evaluate(() => {
      const project = JSON.parse(localStorage.getItem('test-cloud-projects'))[0];
      return [project.coverType, project.coverColor];
    }), ['color', '#e86f4c'], 'the default cover color is saved with the project');
    const addProject = async (title, client, color = '') => {
      await page.locator('#reviewsBackProjects').click();
      await page.locator('#reviewsCreateProject').click();
      if (color) await page.locator('#reviewsCoverColor').fill(color);
      await page.locator('#reviewsEntityTitle').fill(title);
      await page.locator('#reviewsEntityClient').fill(client);
      await page.locator('#reviewsEntityForm button[type=submit]').click();
      await page.waitForFunction(name => JSON.parse(localStorage.getItem('test-cloud-projects') || '[]').some(project => project.title === name), title);
    };
    await addProject('Zeta', 'Agencia C', '#35678a');
    await addProject('Alfa', 'Cliente A');
    await page.evaluate(() => {
      const projects = JSON.parse(localStorage.getItem('test-cloud-projects'));
      const legacy = projects.find(project => project.title === 'Alfa');
      legacy.coverType = 'default'; delete legacy.coverColor;
      localStorage.setItem('test-cloud-projects', JSON.stringify(projects));
    });
    await page.goto(reviewsUrl); await authorize(); await page.locator('#reviewsNav').click();
    assert.equal(await page.locator('#reviewsHomeGrid .is-project-card').count(), 3);
    const coverColor = async title => page.locator('#reviewsHomeGrid .reviews-home-card').filter({ hasText: title }).locator('.reviews-home-card-cover').evaluate(cover => getComputedStyle(cover).backgroundColor);
    assert.equal(await coverColor('Alfa'), 'rgb(232, 111, 76)', 'older automatic MIRA covers now display the default color');
    assert.equal(await coverColor('Zeta'), 'rgb(53, 103, 138)', 'a chosen project color stays intact');
    assert.equal(await page.locator('#reviewsHomeGrid .reviews-home-card-cover').getByText('MIRA').count(), 0, 'the old MIRA artwork is gone');
    await page.locator('#reviewsHomeListView').click();
    assert.equal(await page.locator('#reviewsHomeGrid').evaluate(grid => grid.classList.contains('is-list-view')), true, 'projects can be displayed one below another');
    assert.ok((await page.locator('#reviewsHomeGrid .reviews-home-card').first().boundingBox()).height < 100, 'list rows are compact');
    await page.locator('#reviewsHomeSort').selectOption('name');
    assert.deepEqual(await page.locator('#reviewsHomeGrid .is-project-card strong').allTextContents(), ['Alfa', 'Proyecto sincronizado', 'Zeta'], 'projects sort by name');
    await page.locator('#reviewsHomeSort').selectOption('client');
    assert.equal(await page.locator('#reviewsHomeGrid .is-project-card strong').first().textContent(), 'Zeta', 'projects can sort by client');
    await page.locator('#reviewsHomeClientFilter').selectOption({ label: 'Cliente A' });
    assert.deepEqual(await page.locator('#reviewsHomeGrid .is-project-card strong').allTextContents(), ['Alfa'], 'projects can be filtered by client');
    assert.equal(await page.locator('#reviewsHomeCount').textContent(), '1 de 3 proyectos');
    await page.locator('#reviewsHomeClientFilter').selectOption('all');
    if (process.env.REVIEWS_HOME_LIST_SCREENSHOT) await page.screenshot({ path: process.env.REVIEWS_HOME_LIST_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'project list and controls fit a phone');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#reviewsHomeGridView').click();
    assert.equal(await page.locator('#reviewsHomeGrid').evaluate(grid => grid.classList.contains('is-list-view')), false, 'card view remains available');
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Proyecto sincronizado' }).click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Montaje · V1' }).click();
    await page.locator('#reviewsLinkBtn').click();
    await page.locator('#reviewsLinkUrl').fill('https://www.dropbox.com/scl/fi/test/foto.jpg?rlkey=test');
    await page.locator('#reviewsLinkKind').selectOption('image');
    await page.locator('#reviewsLinkForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#reviewsCount').textContent === '1');
    const drawingBar = await page.locator('#reviewsAnnotationBar').boundingBox();
    const keyboardButton = await page.locator('#reviewsShortcutsBtn').boundingBox();
    assert.ok(drawingBar.height < 55, 'the drawing controls and keyboard share one row on desktop');
    assert.ok(Math.abs(drawingBar.x + drawingBar.width - keyboardButton.x - keyboardButton.width) < 16, 'the keyboard stays at the far right');
    assert.equal(await page.locator('.reviews-section-heading strong').first().textContent(), 'Última versión');
    assert.equal(await page.locator('.reviews-section').count(), 1, 'new reviews start with one section');
    assert.equal(await page.locator('.reviews-section-files[data-section-id="default"] .reviews-file').count(), 1, 'new files enter the default section');
    if (process.env.REVIEWS_VIEW_SCREENSHOT) await page.screenshot({ path: process.env.REVIEWS_VIEW_SCREENSHOT, fullPage: true });
    await page.locator('#reviewsDrawBtn').click();
    const adminCanvas = await page.locator('#reviewsCanvas').boundingBox();
    await page.mouse.move(adminCanvas.x + adminCanvas.width * .2, adminCanvas.y + adminCanvas.height * .2);
    await page.mouse.down();
    await page.mouse.move(adminCanvas.x + adminCanvas.width * .4, adminCanvas.y + adminCanvas.height * .4);
    await page.mouse.up();
    const adminDrawing = await page.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL());
    await page.locator('#reviewsClearBtn').click();
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), adminDrawing, 'Ctrl+Z in Mira restores drawings for an admin instead of undoing Visto');
    await page.locator('#reviewsClearBtn').click();
    await page.getByRole('button', { name: 'Renombrar sección Última versión' }).click();
    await page.locator('#reviewsSectionName').fill('Entrega actual');
    await page.locator('#reviewsSectionForm button[type=submit]').click();
    await page.getByRole('button', { name: '＋ Sección' }).click();
    await page.locator('#reviewsSectionName').fill('Versiones anteriores');
    await page.locator('#reviewsSectionForm button[type=submit]').click();
    const olderSection = page.locator('.reviews-section').filter({ hasText: 'Versiones anteriores' });
    await page.locator('.reviews-section-files[data-section-id="default"] .reviews-file').dragTo(olderSection.locator('.reviews-section-files'));
    await olderSection.locator('.reviews-file').waitFor();
    assert.equal(await page.locator('.reviews-section-heading strong').first().textContent(), 'Entrega actual', 'renaming the default section persists after moving a file');
    await page.locator('#reviewsBackVersions').click();
    await page.locator('.reviews-home-card-actions button[aria-label="Compartir Montaje · V1"]').click();
    await page.locator('#reviewsCopyModal').waitFor({ state: 'visible' });
    const shareUrl = await page.locator('#reviewsCopyInput').inputValue();
    assert.match(shareUrl, /\/mira\/#\/[a-z0-9-]+$/);
    assert.match(shareUrl, /montaje-v1$/);
    assert.ok(!shareUrl.includes('A'.repeat(43)), 'the client link has no opaque capability');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-published'))[0].fileCount), 1);
    await page.locator('#reviewsCopyDone').click();
    const namedGuest = await context.newPage(); namedGuest.on('pageerror', error => errors.push(error.message));
    await namedGuest.goto(shareUrl);
    await namedGuest.locator('#reviewsImage').waitFor({ state: 'visible' });
    await namedGuest.waitForFunction(() => document.querySelector('#reviewsImage').naturalWidth > 0);
    assert.match(await namedGuest.locator('#reviewsImage').evaluate(image => image.currentSrc), /^https:\/\/dl\.dropboxusercontent\.com\//, 'shared images use the CORS-enabled Dropbox content host');
    assert.equal(await namedGuest.locator('#reviewsImage').evaluate(image => image.crossOrigin), 'anonymous');
    assert.equal(await namedGuest.locator('#reviewsView').isVisible(), true, 'the link opens the shared file directly');
    assert.equal(await namedGuest.locator('#reviewsViewTools').count(), 0, 'the extra viewer toolbar is gone');
    assert.equal(await namedGuest.locator('.reviews-main-head #reviewsZoomValue').isVisible(), true, 'zoom sits beside the filename');
    assert.equal(await namedGuest.locator('#reviewsAnnotationBar #reviewsShortcutsBtn').isVisible(), true, 'shortcuts are at the end of the bottom toolbar');
    assert.equal(await namedGuest.locator('#reviewsDrawBtn').isVisible(), false, 'guests see shortcuts without drawing controls before choosing an identity');
    const stageBox = await namedGuest.locator('#reviewsStage').boundingBox();
    const center = { x: stageBox.x + stageBox.width / 2, y: stageBox.y + stageBox.height / 2 };
    await namedGuest.mouse.move(center.x, center.y);
    await namedGuest.mouse.wheel(0, -250);
    await namedGuest.waitForFunction(() => Number.parseInt(document.querySelector('#reviewsZoomValue').textContent) > 100);
    const beforePan = await namedGuest.locator('#reviewsMediaSurface').boundingBox();
    await namedGuest.mouse.down({ button: 'middle' });
    await namedGuest.mouse.move(center.x + 46, center.y - 31, { steps: 4 });
    await namedGuest.mouse.up({ button: 'middle' });
    const afterPan = await namedGuest.locator('#reviewsMediaSurface').boundingBox();
    assert.ok(Math.abs(afterPan.x - beforePan.x - 46) < 2 && Math.abs(afterPan.y - beforePan.y + 31) < 2, 'middle-button drag pans the media in both directions');
    assert.equal(await namedGuest.locator('#reviewsStage').evaluate(stage => stage.classList.contains('is-panning')), false, 'panning ends when the button is released');
    await namedGuest.mouse.move(center.x - 40, center.y + 20);
    const afterRelease = await namedGuest.locator('#reviewsMediaSurface').boundingBox();
    assert.ok(Math.abs(afterRelease.x - afterPan.x) < 1 && Math.abs(afterRelease.y - afterPan.y) < 1, 'moving the cursor after release does not pan');
    await namedGuest.mouse.wheel(0, 250);
    await namedGuest.waitForFunction(() => Number.parseInt(document.querySelector('#reviewsZoomValue').textContent) < 166);
    await namedGuest.keyboard.press('h');
    assert.equal(await namedGuest.locator('#reviewsZoomValue').textContent(), '100%', 'fit resets zoom and pan');
    assert.equal(await namedGuest.evaluate(() => Boolean(document.querySelector('#reviewsScreenshotBtn').compareDocumentPosition(document.querySelector('#reviewsDownloadBtn')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'capture sits before download');
    await namedGuest.locator('#reviewsShortcutsBtn').click();
    assert.equal(await namedGuest.locator('#reviewsShortcutsMenu').isVisible(), true);
    if (process.env.REVIEWS_SHORTCUTS_SCREENSHOT) await namedGuest.screenshot({ path: process.env.REVIEWS_SHORTCUTS_SCREENSHOT, fullPage: true });
    assert.match(await namedGuest.locator('#reviewsShortcutsMenu').textContent(), /Ajustar imagen.*Pantalla completa.*Ocultar controles.*Ruedita.*desplazar/s);
    await namedGuest.keyboard.press('Escape');
    assert.equal(await namedGuest.locator('#reviewsShortcutsMenu').isVisible(), false);
    await rejectTabCapture(namedGuest);
    const captureDownload = namedGuest.waitForEvent('download');
    await namedGuest.locator('#reviewsScreenshotBtn').click();
    const photoPng = await captureDownload;
    assert.match(photoPng.suggestedFilename(), /foto-captura\.png$/);
    const photoBytes = fs.readFileSync(await photoPng.path());
    assert.deepEqual([photoBytes.readUInt32BE(16), photoBytes.readUInt32BE(20)], [320, 180], 'the image exports at its native dimensions');
    assert.equal(await namedGuest.evaluate(() => window.captureRequests), 0, 'PNG download does not ask to capture the tab');
    assert.match(await namedGuest.locator('#reviewsCommentContext').textContent(), /Captura PNG descargada/);
    const fallbackGuest = await context.newPage(); fallbackGuest.on('pageerror', error => errors.push(error.message));
    await fallbackGuest.route('https://dl.dropboxusercontent.com/scl/fi/**', route => route.abort());
    await fallbackGuest.goto(shareUrl);
    await fallbackGuest.waitForFunction(() => document.querySelector('#reviewsImage').naturalWidth > 0);
    assert.match(await fallbackGuest.locator('#reviewsImage').evaluate(image => image.currentSrc), /^https:\/\/www\.dropbox\.com\//, 'a blocked CORS link falls back to the viewable Dropbox link');
    await rejectTabCapture(fallbackGuest);
    let unexpectedDownload = false; fallbackGuest.on('download', () => { unexpectedDownload = true; });
    await fallbackGuest.locator('#reviewsScreenshotBtn').click();
    await fallbackGuest.waitForFunction(() => /Dropbox no permite exportar/.test(document.querySelector('#reviewsCommentContext').textContent));
    assert.equal(await fallbackGuest.evaluate(() => window.captureRequests), 0, 'a blocked CORS link never triggers a browser capture prompt');
    assert.equal(unexpectedDownload, false, 'a blocked CORS link does not download a corrupt PNG');
    await fallbackGuest.close();
    assert.equal(await namedGuest.locator('#authGate').isVisible(), false, 'viewing requires no sign-in');
    assert.equal(await namedGuest.locator('#reviewsGuestName').isVisible(), true);
    assert.equal(await namedGuest.locator('#reviewsGuestGoogle').isVisible(), true);
    assert.equal(await namedGuest.locator('#reviewsRemoveMedia').isVisible(), false);
    assert.equal(await namedGuest.locator('#reviewsShareBtn').isVisible(), false);
    if (process.env.REVIEW_CLIENT_SCREENSHOT) await namedGuest.screenshot({ path: process.env.REVIEW_CLIENT_SCREENSHOT, fullPage: true });
    await namedGuest.setViewportSize({ width: 390, height: 844 });
    assert.equal(await namedGuest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'the shared review fits a phone');
    await namedGuest.locator('#reviewsShortcutsBtn').click();
    const shortcutsBox = await namedGuest.locator('#reviewsShortcutsMenu').boundingBox();
    assert.ok(shortcutsBox.x >= 0 && shortcutsBox.x + shortcutsBox.width <= 391, 'the shortcut list fits a phone');
    await namedGuest.locator('#reviewsShortcutsBtn').click();
    assert.equal(await namedGuest.locator('#reviewsGuestGoogle').isVisible(), true);
    await namedGuest.setViewportSize({ width: 1280, height: 720 });
    await namedGuest.locator('#reviewsGuestName').fill('Roberto');
    await namedGuest.locator('#reviewsGuestLogin').click();
    await namedGuest.locator('#reviewsCommentForm').waitFor({ state: 'visible' });
    assert.equal(await namedGuest.locator('#reviewsDrawBtn').isVisible(), true);
    assert.match(await namedGuest.locator('#reviewsCommentIdentity').textContent(), /Roberto/);
    assert.match(await namedGuest.locator('#reviewsSketchBtn').getAttribute('title'), /no se guarda/);
    assert.equal(await namedGuest.locator('#reviewsToolMenu [data-review-tool]').count(), 3, 'brushes are in their own picker');
    assert.equal(await namedGuest.locator('#reviewsShapeMenu [data-review-tool]').count(), 4, 'the shapes have one rectangle and one ellipse option');
    assert.equal(await namedGuest.locator('[data-review-tool="square"], [data-review-tool="circle"]').count(), 0);
    await namedGuest.setViewportSize({ width: 390, height: 844 });
    await namedGuest.locator('#reviewsShapePicker').click();
    const shapeMenuBox = await namedGuest.locator('#reviewsShapeMenu').boundingBox();
    assert.ok(shapeMenuBox.x >= 0 && shapeMenuBox.x + shapeMenuBox.width <= 391, 'shape tools fit a phone');
    if (process.env.REVIEWS_SHAPES_SCREENSHOT) await namedGuest.screenshot({ path: process.env.REVIEWS_SHAPES_SCREENSHOT, fullPage: true });
    await namedGuest.locator('#reviewsShapePicker').click();
    await namedGuest.setViewportSize({ width: 1280, height: 720 });
    const drawShape = async (tool, start, end, shift) => {
      await namedGuest.locator('#reviewsShapePicker').click();
      await namedGuest.locator(`[data-review-tool="${tool}"]`).click();
      const bounds = await namedGuest.locator('#reviewsCanvas').boundingBox();
      await namedGuest.mouse.move(bounds.x + bounds.width * start[0], bounds.y + bounds.height * start[1]);
      if (shift) await namedGuest.keyboard.down('Shift');
      await namedGuest.mouse.down();
      await namedGuest.mouse.move(bounds.x + bounds.width * end[0], bounds.y + bounds.height * end[1], { steps: 5 });
      await namedGuest.mouse.up();
      if (shift) await namedGuest.keyboard.up('Shift');
    };
    await drawShape('rect', [.1, .1], [.5, .3], false);
    await drawShape('rect', [.1, .4], [.5, .6], true);
    await drawShape('ellipse', [.55, .1], [.9, .3], false);
    await drawShape('ellipse', [.55, .4], [.9, .6], true);
    const drawingBeforePan = await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL());
    const drawingBounds = await namedGuest.locator('#reviewsCanvas').boundingBox();
    await namedGuest.mouse.move(drawingBounds.x + drawingBounds.width / 2, drawingBounds.y + drawingBounds.height / 2);
    await namedGuest.mouse.down({ button: 'middle' });
    await namedGuest.mouse.move(drawingBounds.x + drawingBounds.width / 2 - 28, drawingBounds.y + drawingBounds.height / 2 + 23);
    await namedGuest.mouse.up({ button: 'middle' });
    assert.equal(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), drawingBeforePan, 'middle-button pan preserves existing annotations while drawing mode is active');
    await namedGuest.keyboard.press('h');
    await namedGuest.locator('#reviewsClearBtn').click();
    const emptyDrawing = await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL());
    assert.notEqual(emptyDrawing, drawingBeforePan, 'Clear removes every unsaved annotation');
    await drawShape('rect', [.15, .15], [.25, .25], false);
    await namedGuest.keyboard.press('Control+z');
    assert.equal(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), emptyDrawing, 'Ctrl+Z first removes a new stroke drawn after Clear');
    await namedGuest.keyboard.press('Control+z');
    assert.equal(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), drawingBeforePan, 'Ctrl+Z restores every annotation removed by Clear');
    await namedGuest.locator('#reviewsClearBtn').click();
    await namedGuest.locator('#reviewsUndoBtn').click();
    assert.equal(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), drawingBeforePan, 'the Undo button also restores a cleared drawing');
    await namedGuest.locator('#reviewsCommentText').fill('Borrador');
    await namedGuest.keyboard.press('Control+z');
    assert.equal(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), drawingBeforePan, 'Ctrl+Z in comment text does not undo the drawing');
    await namedGuest.locator('#reviewsCommentText').fill('Ajustar color');
    await namedGuest.locator('#reviewsCommentForm button[type=submit]').click();
    await namedGuest.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '1');
    const shapes = await namedGuest.evaluate(() => {
      const canvas = document.querySelector('#reviewsCanvas');
      return JSON.parse(localStorage.getItem('test-cloud-comments'))[0].strokes.map(stroke => ({
        tool: stroke.tool,
        width: Math.abs(stroke.points[1][0] - stroke.points[0][0]) * canvas.clientWidth,
        height: Math.abs(stroke.points[1][1] - stroke.points[0][1]) * canvas.clientHeight,
      }));
    });
    assert.deepEqual(shapes.map(shape => shape.tool), ['rect', 'rect', 'ellipse', 'ellipse']);
    assert.ok(Math.abs(shapes[0].width - shapes[0].height) > 20 && Math.abs(shapes[2].width - shapes[2].height) > 20, 'without Shift the shapes stay free');
    assert.ok(Math.abs(shapes[1].width - shapes[1].height) < 2 && Math.abs(shapes[3].width - shapes[3].height) < 2, 'Shift keeps squares and circles exact');
    const savedDrawing = await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL());
    await namedGuest.locator('#reviewsClearBtn').click();
    assert.notEqual(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), savedDrawing, 'Clear hides a selected saved annotation without deleting its comment');
    await namedGuest.keyboard.press('Control+z');
    assert.equal(await namedGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.toDataURL()), savedDrawing, 'Ctrl+Z restores a selected saved annotation');
    assert.match(await namedGuest.locator('.reviews-comment-meta').textContent(), /Roberto/);
    assert.deepEqual(await namedGuest.locator('.reviews-comment-actions button').allTextContents(), ['Editar', 'Eliminar'], 'a named guest can edit or delete their own feedback but cannot resolve it');
    await namedGuest.getByRole('button', { name: 'Editar comentario de Roberto' }).click();
    if (process.env.REVIEWS_COMMENT_EDIT_SCREENSHOT) await namedGuest.screenshot({ path: process.env.REVIEWS_COMMENT_EDIT_SCREENSHOT, fullPage: true });
    await namedGuest.getByRole('textbox', { name: 'Editar tu comentario' }).fill('Cambio descartado');
    await namedGuest.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.match(await namedGuest.locator('.reviews-comment-text').textContent(), /Ajustar color/, 'cancel does not change the comment');
    await namedGuest.getByRole('button', { name: 'Editar comentario de Roberto' }).click();
    await namedGuest.getByRole('textbox', { name: 'Editar tu comentario' }).fill('Ajustar color y contraste');
    await namedGuest.getByRole('button', { name: 'Guardar cambios' }).click();
    await namedGuest.waitForFunction(() => JSON.parse(localStorage.getItem('test-cloud-comments'))[0].text === 'Ajustar color y contraste');
    assert.equal(await namedGuest.locator('.reviews-comment-text').textContent(), 'Ajustar color y contraste');
    assert.equal(await namedGuest.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-comments'))[0].strokes.length), 4, 'editing text preserves the drawing');
    await namedGuest.close();
    const googleGuest = await context.newPage(); googleGuest.on('pageerror', error => errors.push(error.message));
    await googleGuest.goto(shareUrl);
    await googleGuest.locator('#reviewsGuestGoogle').click();
    await googleGuest.locator('#reviewsCommentForm').waitFor({ state: 'visible' });
    assert.match(await googleGuest.locator('#reviewsCommentIdentity').textContent(), /Cliente Google/);
    assert.equal(await googleGuest.locator('#reviewsRemoveMedia').isVisible(), false);
    await googleGuest.locator('#reviewsCommentText').fill('Revisar final');
    await googleGuest.locator('#reviewsCommentForm button[type=submit]').click();
    await googleGuest.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '2');
    assert.equal(await googleGuest.locator('.reviews-comment-actions button').count(), 2, 'a Google review guest can edit and delete only their own comment');
    assert.deepEqual(await googleGuest.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-comments')).map(comment => comment.authorName)), ['Roberto', 'Cliente Google']);
    assert.equal(await googleGuest.locator('.reviews-comment').filter({ hasText: 'Roberto' }).getByRole('button', { name: /Editar comentario/ }).count(), 0, 'another user cannot edit Roberto’s comment');
    assert.equal(await googleGuest.evaluate(async () => {
      const comment = JSON.parse(localStorage.getItem('test-cloud-comments'))[0];
      try { await (await import('./reviews-cloud.js?v=10')).editOwnSharedComment('A'.repeat(43), comment.fileId, comment.id, 'Intento ajeno'); return false; }
      catch { return true; }
    }), true, 'the backend rejects another user’s edit');
    assert.equal(await googleGuest.locator('.reviews-comment').filter({ hasText: 'Roberto' }).getByRole('button', { name: 'Eliminar', exact: true }).count(), 0, 'cannot delete another guest with the same shared link');
    await googleGuest.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await googleGuest.locator('#reviewsConfirmCancel').click();
    assert.equal(await googleGuest.locator('#reviewsCommentCount').textContent(), '2', 'cancelling preserves feedback');
    await googleGuest.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await googleGuest.locator('#reviewsConfirmAccept').click();
    await googleGuest.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '1');
    assert.deepEqual(await googleGuest.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-comments')).map(comment => comment.authorName)), ['Roberto']);
    await googleGuest.close();
    const returningGuest = await context.newPage();
    await returningGuest.goto(shareUrl);
    await returningGuest.locator('#reviewsGuestName').fill('Roberto');
    await returningGuest.locator('#reviewsGuestLogin').click();
    await returningGuest.locator('.reviews-comment-actions button').first().waitFor();
    await returningGuest.getByRole('button', { name: 'Editar comentario de Roberto' }).click();
    await returningGuest.getByRole('textbox', { name: 'Editar tu comentario' }).fill('Edición recuperada en otra pestaña');
    await returningGuest.evaluate(() => { window.failCommentEdit = true; });
    await returningGuest.getByRole('button', { name: 'Guardar cambios' }).click();
    await returningGuest.waitForFunction(() => /Tu texto sigue acá/.test(document.querySelector('#reviewsCommentContext').textContent));
    assert.equal(await returningGuest.getByRole('textbox', { name: 'Editar tu comentario' }).inputValue(), 'Edición recuperada en otra pestaña', 'a failed edit keeps the draft');
    await returningGuest.evaluate(() => { window.failCommentEdit = false; });
    await returningGuest.getByRole('button', { name: 'Guardar cambios' }).click();
    await returningGuest.waitForFunction(() => JSON.parse(localStorage.getItem('test-cloud-comments'))[0].text === 'Edición recuperada en otra pestaña');
    await returningGuest.locator('.reviews-comment-open').click();
    await returningGuest.evaluate(() => { window.failCommentDelete = true; });
    await returningGuest.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await returningGuest.locator('#reviewsConfirmAccept').click();
    await returningGuest.waitForFunction(() => /El comentario se conserva/.test(document.querySelector('#reviewsCommentContext').textContent));
    assert.equal(await returningGuest.locator('#reviewsCommentCount').textContent(), '1', 'failed deletion preserves the comment and annotation');
    await returningGuest.evaluate(() => { window.failCommentDelete = false; });
    await returningGuest.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await returningGuest.locator('#reviewsConfirmAccept').click();
    await returningGuest.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '0');
    assert.deepEqual(await returningGuest.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-comments'))), []);
    assert.equal(await returningGuest.locator('#reviewsCanvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    }), false, 'deleting the selected feedback also clears its drawing');
    await returningGuest.reload();
    await returningGuest.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '0');
    await returningGuest.close();
    await page.evaluate(() => {
      const shares = JSON.parse(localStorage.getItem('test-cloud-published'));
      const second = { ...shares[0], token: 'B'.repeat(43), files: [...shares[0].files, {
        id: 'client-video', name: 'revision.webm', kind: 'video', source: 'dropbox',
        sourceUrl: 'https://www.dropbox.com/scl/fi/test/revision.webm?rlkey=test', comments: []
      }] };
      localStorage.setItem('test-cloud-published', JSON.stringify([...shares, second]));
    });
    const videoFixture = await page.evaluate(async () => {
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return null;
      const source = document.createElement('canvas'); source.width = 320; source.height = 180;
      const graphics = source.getContext('2d'); graphics.fillStyle = '#547d8e'; graphics.fillRect(0, 0, 320, 180);
      const stream = source.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const done = new Promise(resolve => { recorder.onstop = resolve; });
      let frame = 0;
      const animation = setInterval(() => { graphics.fillStyle = frame++ % 2 ? '#547d8e' : '#647d8e'; graphics.fillRect(0, 0, 320, 180); }, 50);
      recorder.start(); await new Promise(resolve => setTimeout(resolve, 600)); clearInterval(animation); recorder.stop(); await done;
      stream.getTracks().forEach(track => track.stop());
      const file = new File(chunks, 'revision.webm', { type: 'video/webm' });
      return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(file); });
    });
    assert.ok(videoFixture, 'the browser can generate a test video');
    await context.route('**/revision.webm?*', route => fulfillVideo(route, videoFixture));
    const videoGuest = await context.newPage(); videoGuest.on('pageerror', error => errors.push(error.message));
    await videoGuest.goto(`${reviewsUrl}#share=${'B'.repeat(43)}&file=client-video`);
    await videoGuest.locator('#reviewsDownloadBtn').waitFor({ state: 'visible' });
    await videoGuest.waitForFunction(() => document.querySelector('#reviewsVideo').videoWidth > 0);
    assert.match(await videoGuest.locator('#reviewsVideo').evaluate(video => video.currentSrc), /^https:\/\/dl\.dropboxusercontent\.com\//, 'shared videos use the CORS-enabled Dropbox content host');
    assert.equal(await videoGuest.locator('#reviewsMediaTitle').textContent(), 'revision.webm', 'the file in the shared link opens instead of the first file');
    const videoBounds = await videoGuest.locator('#reviewsVideo').boundingBox();
    const videoCenter = { x: videoBounds.x + videoBounds.width / 2, y: videoBounds.y + videoBounds.height / 2 };
    await videoGuest.mouse.move(videoCenter.x, videoCenter.y);
    await videoGuest.mouse.down({ button: 'middle' });
    await videoGuest.mouse.move(videoCenter.x - 37, videoCenter.y + 26);
    await videoGuest.mouse.up({ button: 'middle' });
    const movedVideo = await videoGuest.locator('#reviewsVideo').boundingBox();
    assert.ok(Math.abs(movedVideo.x - videoBounds.x + 37) < 2 && Math.abs(movedVideo.y - videoBounds.y - 26) < 2, 'middle-button drag pans the video itself');
    assert.equal(await videoGuest.locator('#reviewsVideo').evaluate(video => video.paused), true, 'middle-button drag does not toggle video playback');
    await videoGuest.keyboard.press('h');
    await videoGuest.waitForFunction(() => document.querySelector('#reviewsFps').dataset.status !== 'loading');
    await videoGuest.locator('#reviewsGuestName').fill('Montajista');
    await videoGuest.locator('#reviewsGuestLogin').click();
    await videoGuest.locator('#reviewsDrawBtn').click();
    assert.equal(await videoGuest.locator('#reviewsDrawBtn').getAttribute('aria-pressed'), 'true');
    await videoGuest.locator('#reviewsSeek').evaluate(seek => { seek.value = '500'; seek.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await videoGuest.locator('#reviewsDrawBtn').getAttribute('aria-pressed'), 'true', 'scrubbing to another moment keeps the brush selected');
    assert.equal(await videoGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.classList.contains('is-drawing')), true, 'the brush can draw immediately after scrubbing');
    await videoGuest.locator('#reviewsVideo').evaluate(video => { video.loop = true; });
    await videoGuest.locator('#reviewsPlayBtn').click();
    await videoGuest.waitForFunction(() => !document.querySelector('#reviewsVideo').paused && !document.querySelector('#reviewsCanvas').classList.contains('is-drawing'));
    assert.equal(await videoGuest.locator('#reviewsDrawBtn').getAttribute('aria-pressed'), 'true', 'playback does not deselect the brush');
    assert.equal(await videoGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.classList.contains('is-drawing')), false, 'drawing is suspended while the video plays');
    await videoGuest.locator('#reviewsPlayBtn').click();
    await videoGuest.waitForFunction(() => document.querySelector('#reviewsVideo').paused && document.querySelector('#reviewsCanvas').classList.contains('is-drawing'));
    assert.equal(await videoGuest.locator('#reviewsDrawBtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await videoGuest.locator('#reviewsCanvas').evaluate(canvas => canvas.classList.contains('is-drawing')), true, 'drawing resumes when playback pauses');
    await rejectTabCapture(videoGuest);
    const frameDownload = videoGuest.waitForEvent('download');
    await videoGuest.locator('#reviewsScreenshotBtn').click();
    const framePng = await frameDownload;
    const hasFrameClock = !await videoGuest.locator('#reviewsNextFrame').isDisabled();
    assert.match(framePng.suggestedFilename(), hasFrameClock ? /revision-fotograma-\d+\.png$/ : /revision-tiempo-\d+ms\.png$/, 'the capture does not invent a frame number if the rate is unknown or variable');
    const frameBytes = fs.readFileSync(await framePng.path());
    assert.deepEqual([frameBytes.readUInt32BE(16), frameBytes.readUInt32BE(20)], [320, 180], 'the video frame exports at its native dimensions');
    assert.equal(await videoGuest.evaluate(() => window.captureRequests), 0, 'video PNG download does not ask to capture the tab');
    assert.equal(await videoGuest.locator('#authGate').isVisible(), false);
    assert.equal(await videoGuest.locator('#reviewsRemoveMedia').isVisible(), false);
    await videoGuest.evaluate(() => { HTMLAnchorElement.prototype.click = function () { window.clientDownload = this.href; }; });
    await videoGuest.locator('#reviewsDownloadBtn').click();
    assert.match(await videoGuest.evaluate(() => window.clientDownload), /revision\.webm\?rlkey=test&dl=1$/, 'client download requests the original video');
    await videoGuest.close();
    await page.evaluate(() => localStorage.setItem('test-cloud-published', JSON.stringify(JSON.parse(localStorage.getItem('test-cloud-published')).filter(share => share.token !== 'B'.repeat(43)))));
    await page.locator('#reviewsAdminBtn').click();
    await page.locator('#reviewsAdminModal').waitFor({ state: 'visible' });
    await page.locator('#reviewsAddPerson').click();
    await page.locator('#reviewsPersonEmail').fill('equipo@granbertafilms.com');
    await page.locator('#reviewsPersonName').fill('Equipo');
    await page.locator('#reviewsPersonReviewsRole').selectOption('manager');
    await page.locator('#reviewsPersonSave').click();
    await page.locator('.reviews-staff-row').filter({ hasText: 'equipo@granbertafilms.com' }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-staff'))[0].permissions.reviewsCreate), true);
    await page.locator('.reviews-staff-row').filter({ hasText: 'equipo@granbertafilms.com' }).click();
    await page.locator('#reviewsPersonReviewsRole').selectOption('client');
    if (process.env.REVIEWS_PERSON_SCREENSHOT) await page.screenshot({ path: process.env.REVIEWS_PERSON_SCREENSHOT, fullPage: true });
    await page.locator('#reviewsPersonShareList input').check();
    await page.locator('#reviewsPersonSave').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-cloud-staff'))?.[0]?.permissions?.reviewsClient === true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-staff'))[0].permissions.reviewsClient), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-staff'))[0].permissions.reviewsView), false);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-staff'))[0].reviewTokens), ['A'.repeat(43)]);
    await page.locator('.reviews-staff-row').filter({ hasText: 'equipo@granbertafilms.com' }).click();
    await page.locator('#reviewsPersonActive').uncheck();
    await page.locator('#reviewsPersonSave').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-cloud-staff'))?.[0]?.active === false);
    assert.match(await page.locator('.reviews-staff-row').filter({ hasText: 'equipo@granbertafilms.com' }).textContent(), /Desactivado/);
    await page.locator('.reviews-staff-row').filter({ hasText: 'equipo@granbertafilms.com' }).click();
    await page.locator('#reviewsPersonRemove').click();
    await page.locator('#reviewsConfirmAccept').click();
    await page.waitForFunction(() => document.querySelectorAll('.reviews-staff-row').length === 1);
    await page.locator('#reviewsAdminClose').click();
    await page.evaluate(() => localStorage.setItem('test-cloud-requests', JSON.stringify([{ uid: 'pending-1', email: 'nueva@example.com', name: 'Nueva persona' }])));
    await page.locator('#reviewsAdminBtn').click();
    const pending = page.locator('.reviews-staff-row').filter({ hasText: 'nueva@example.com' });
    assert.match(await pending.textContent(), /Pendiente/);
    await pending.click();
    await page.locator('#reviewsPersonStoryboardsRole').selectOption('editor');
    await page.locator('#reviewsPersonSave').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-cloud-staff'))?.[0]?.permissions?.storyboards === true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-staff'))[0].permissions.storyboards), true);
    if (process.env.REVIEWS_ADMIN_SCREENSHOT) await page.screenshot({ path: process.env.REVIEWS_ADMIN_SCREENSHOT, fullPage: true });
    await page.locator('#reviewsAdminClose').click();
    await page.close();
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}/__blank`);
    await page.evaluate(async () => { await new Promise(resolve => { const request = indexedDB.deleteDatabase('gb-studio-reviews-v1'); request.onsuccess = resolve; request.onerror = resolve; }); });
    await page.goto(reviewsUrl); await authorize();
    await page.locator('#reviewsNav').click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Proyecto sincronizado' }).waitFor();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Proyecto sincronizado' }).click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Montaje · V1' }).click();
    assert.equal(await page.locator('#reviewsCount').textContent(), '1', 'an authorized team member sees a cloud project without local IndexedDB data');
    await page.evaluate(() => {
      const projects = JSON.parse(localStorage.getItem('test-cloud-projects'));
      localStorage.setItem('test-cloud-projects', JSON.stringify([...projects, { id: 'private-project', title: 'Proyecto no asignado', client: 'Otro cliente', updatedAt: new Date().toISOString(), versions: [] }]));
      const published = JSON.parse(localStorage.getItem('test-cloud-published'));
      localStorage.setItem('test-cloud-published', JSON.stringify([...published, { token: 'B'.repeat(43), projectId: 'private-project', versionId: 'private-review', projectTitle: 'Proyecto no asignado', versionTitle: 'Review privada', category: 'General', updatedAt: new Date().toISOString(), active: true, files: [] }]));
      window.STUDIO_ROLE = 'staff'; window.STUDIO_MIRA_ROLE = 'client'; window.STUDIO_PERMISSIONS = { storyboards: true, reviewsClient: true, reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true }; window.STUDIO_REVIEW_TOKENS = ['A'.repeat(43)];
      window.STUDIO_USER = { uid: 'test-reader', email: 'reader@example.com', displayName: 'Reader' };
      window.dispatchEvent(new Event('studio-auth-change'));
    });
    await page.locator('#reviewsMediaTitle').getByText('foto.jpg').waitFor();
    assert.equal(await page.locator('#reviewsView').isVisible(), true, 'the sole assigned review opens directly');
    await page.locator('#reviewsBackVersions').click();
    await page.waitForFunction(() => document.querySelectorAll('#reviewsHomeGrid .reviews-home-card-open').length === 1);
    assert.equal(await page.locator('#reviewsHomeTitle').textContent(), 'Tus reviews');
    assert.equal(await page.locator('#reviewsHomeGrid .is-project-card').count(), 0, 'clients never see project cards');
    assert.equal(await page.locator('#reviewsHomeGrid').getByText('Proyecto no asignado').count(), 0);
    assert.equal(await page.locator('#storyboardsNav').isVisible(), true, 'a separate Visto grant remains intact');
    assert.equal(await page.locator('#reviewsCreateProject').isVisible(), false);
    assert.equal(await page.locator('#reviewsCreateVersion').isVisible(), false);
    assert.equal(await page.locator('#reviewsHomeGrid .reviews-home-card-actions').count(), 0);
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').click();
    await page.locator('#reviewsCommentForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#reviewsRemoveMedia').isVisible(), false, 'an assigned client cannot remove files');
    assert.equal(await page.locator('.reviews-comment-actions').count(), 0, 'an assigned client cannot delete or resolve comments');
    await page.locator('#reviewsCommentText').fill('Comentario del cliente asignado');
    await page.locator('#reviewsCommentForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '1');
    const ownClientComment = page.locator('.reviews-comment').filter({ hasText: 'Comentario del cliente asignado' });
    await ownClientComment.getByRole('button', { name: /Editar comentario/ }).click();
    await ownClientComment.getByRole('textbox', { name: 'Editar tu comentario' }).fill('Comentario corregido del cliente');
    await ownClientComment.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-cloud-comments')).some(comment => comment.text === 'Comentario corregido del cliente'));
    assert.equal(await page.locator('.reviews-file[draggable="true"]').count(), 0, 'an assigned client cannot rearrange files');
    assert.deepEqual(errors, []);
    console.log('Cloud UI passed: shared-file links, guest and Google comments, read-only client access, video download, and project sync.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

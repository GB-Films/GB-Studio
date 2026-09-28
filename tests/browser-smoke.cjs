// Run with Playwright available in NODE_PATH. Uses an isolated browser profile.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const fixture = () => {
  const assets = Array.from({ length: 15 }, (_, index) => {
    const [width, height] = index < 6 ? [900, 900] : [[900, 1600], [1600, 900], [900, 900]][index % 3];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${['#578e89', '#ce8b51', '#56698c'][index % 3]}"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 3}" fill="#ffffff" opacity=".15"/><text x="50%" y="50%" text-anchor="middle" fill="white" font-size="90" font-family="sans-serif">${index + 1}</text></svg>`;
    return { id: `asset-${index}`, name: `Toma ${index + 1}`, width, height, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  });
  return { version: 2, title: 'Prueba · secuencia automática', ratio: 'landscape', padding: 0, gap: 0, showDescriptions: true, showProjectFrame: true, showPageNumber: true, assets,
    pages: [{ id: 'page-1', photosPerPage: 4, layoutDirection: 'columns', items: assets.slice(0, 6).map((asset, slot) => ({ id: `item-${slot}`, assetId: asset.id, slot, fit: 'contain', title: `Escena ${slot + 1}`, description: `Descripción conservada ${slot + 1}`, shotType: 'PP', focusX: 50, focusY: 50 })) }] };
};

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname === '/' ? 'index.html' : new URL(req.url, 'http://localhost').pathname);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
    fs.readFile(file, (error, bytes) => { if (error) { res.statusCode = 404; res.end(); } else res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), 'assets/gb-films-logo-white.png?v=2');
    // The production app requires Google authentication before exposing the
    // workspace. The smoke test supplies its own fixture, so unlock that
    // workspace after Firebase's signed-out state has settled.
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true; window.STUDIO_PERMISSIONS = { storyboards: true }; window.dispatchEvent(new Event('studio-auth-change')); });
    const original = fixture();
    await page.evaluate(data => { project = normalizeProject(data); currentProjectId = project.id; currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; showEditor(); render(); saveProject(); }, original);
    await page.waitForFunction(() => document.querySelectorAll('#canvasPage .design-item').length === 6);
    assert.equal(await page.locator('.library-tip').count(), 0);
    assert.equal(await page.locator('[data-delete-asset]').count(), 15);
    const initialCanvasBox = await page.locator('#canvasPage').boundingBox();
    assert.ok(Math.abs(initialCanvasBox.width / initialCanvasBox.height - 16 / 9) < .03, 'landscape canvas keeps its aspect ratio');
    const squarePhoto = await page.locator('#canvasPage .design-item').first().locator('.design-photo').boundingBox();
    assert.ok(Math.abs(squarePhoto.width / squarePhoto.height - 1) < .03, 'original square photos stay inside square frames');
    const titleAlignment = await page.evaluate(() => { const frame = document.querySelector('#canvasPage .storyboard-meta-frame').getBoundingClientRect(); const title = document.querySelector('#canvasPage .storyboard-meta-title').getBoundingClientRect(); return { frameRight: frame.right, titleRight: title.right }; });
    assert.ok(titleAlignment.titleRight > titleAlignment.frameRight - 80, 'project title defaults to the top-right of the artboard');
    await page.evaluate(() => { project.showProducerBranding = true; project.producer = 'GRAN BERTA FILMS'; project.title = 'STORY SAMSUNG S26FE'; project.showProjectFrame = true; render(); });
    const frameHeader = await page.evaluate(() => {
      const frame = document.querySelector('#canvasPage .storyboard-meta-frame');
      const producer = frame.querySelector('.storyboard-meta-producer strong');
      const title = frame.querySelector('.storyboard-meta-title');
      const rules = [...frame.querySelectorAll('.storyboard-meta-top .storyboard-meta-rule')].map(node => node.getBoundingClientRect());
      const textRects = [producer, title].map(node => node.getBoundingClientRect());
      return { display: getComputedStyle(frame.querySelector('.storyboard-meta-top')).display, producerFits: producer.scrollWidth <= producer.clientWidth + 1, titleFits: title.scrollWidth <= title.clientWidth + 1, noRuleOverText: rules.every(rule => textRects.every(text => rule.right <= text.left || rule.left >= text.right)) };
    });
    assert.equal(frameHeader.display, 'flex', 'frame header uses separated line segments');
    assert.equal(frameHeader.producerFits, true, 'producer text is not clipped in the frame header');
    assert.equal(frameHeader.titleFits, true, 'project title is not clipped in the frame header');
    assert.equal(frameHeader.noRuleOverText, true, 'top frame lines leave a real gap around text');
    assert.equal(await page.locator('#canvasPage .storyboard-meta-page').textContent(), '01');
    await page.locator('#selectAllPhotosBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item.is-selected').count(), 6);
    assert.equal(await page.locator('#selectionCount').textContent(), '6 seleccionadas');
    assert.equal(await page.locator('#batchFrameSection').isVisible(), true);
    await page.locator('.batch-fit-btn[data-frame="vertical"]').click();
    assert.equal(await page.evaluate(() => currentPage().items.every(item => item.frame === 'vertical' && item.fit === 'cover')), true);
    await page.locator('.batch-fit-btn[data-frame="original"]').click();
    assert.equal(await page.evaluate(() => currentPage().items.every(item => item.frame === 'original' && item.fit === 'contain')), true);
    await page.locator('#clearPhotoSelectionBtn').click();
    await page.locator('#canvasPage .design-item').nth(0).click();
    await page.locator('#canvasPage .design-item').nth(1).click({ modifiers: ['Control'] });
    assert.equal(await page.locator('#canvasPage .design-item.is-selected').count(), 2);
    await page.locator('#clearPhotoSelectionBtn').click();
    await page.locator('#showProjectFrame').uncheck({ force: true });
    const viewportLayout = await page.evaluate(() => {
      const workspace = document.querySelector('#canvasWorkspace').getBoundingClientRect();
      const carousel = document.querySelector('#pageCarousel').getBoundingClientRect();
      const inspector = document.querySelector('.inspector-panel');
      return { workspaceScrolls: document.querySelector('#canvasWorkspace').scrollHeight > document.querySelector('#canvasWorkspace').clientHeight + 1, carouselInside: carousel.bottom <= workspace.bottom + 1, inspectorCanScroll: inspector.scrollHeight >= inspector.clientHeight };
    });
    await page.locator('#showDescriptions').uncheck({ force: true });
    const noInfoLayout = await page.evaluate(() => { const workspace = document.querySelector('#canvasWorkspace').getBoundingClientRect(); const canvas = document.querySelector('#canvasPage').getBoundingClientRect(); const carousel = document.querySelector('#pageCarousel').getBoundingClientRect(); return { workspace, canvas, carousel }; });
    await page.locator('#showDescriptions').check({ force: true });
    const withInfoLayout = await page.evaluate(() => { const workspace = document.querySelector('#canvasWorkspace').getBoundingClientRect(); const canvas = document.querySelector('#canvasPage').getBoundingClientRect(); const carousel = document.querySelector('#pageCarousel').getBoundingClientRect(); return { workspace, canvas, carousel }; });
    assert.ok(Math.abs(noInfoLayout.workspace.top - withInfoLayout.workspace.top) < 1);
    assert.ok(Math.abs(noInfoLayout.carousel.bottom - withInfoLayout.carousel.bottom) < 1, 'page thumbnails stay fixed when photo information changes');
    assert.ok(withInfoLayout.carousel.bottom <= withInfoLayout.workspace.bottom + 1);
    assert.equal(viewportLayout.workspaceScrolls, false, 'canvas workspace does not need page scrolling');
    assert.equal(viewportLayout.carouselInside, true, 'page thumbnails stay inside the fixed canvas area');
    assert.equal(viewportLayout.inspectorCanScroll, true, 'long inspector content scrolls independently');
    assert.equal(await page.locator('#photosPerPage').count(), 0);
    assert.equal(await page.locator('#layoutDirection').count(), 0);
    assert.equal(await page.locator('#addPageBtn').count(), 0);
    assert.equal(await page.locator('#importBtn').count(), 0);
    assert.equal(await page.locator('#newProjectBtn').count(), 0);
    assert.equal(await page.locator('#accountButton').count(), 1);
    assert.equal(await page.locator('.fit-btn').count(), 4);
    assert.equal(await page.locator('.fit-default-btn').count(), 4);
    assert.equal(await page.locator('#pageTotal').textContent(), '1');
    const screenshot = path.join(os.tmpdir(), 'storyapp-adaptive-six.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log('Screenshot:', screenshot);
    // A saved project with holes must keep visual order and user-chosen crop/focus.
    const migration = await page.evaluate(() => {
      const old = { ...project, layoutEngine: undefined, photosPerPage: 4, layoutDirection: 'grid', pages: [
        { id: 'old-1', items: [{ id: 'b', slot: 7, fit: 'cover', focusX: 20, focusY: 80, title: 'Encuadre propio', shotType: 'PD' }, { id: 'a', slot: 2, fit: 'contain' }] },
        { id: 'old-2', items: [{ id: 'c', slot: 0, fit: 'contain' }] }
      ] };
      const migrated = normalizeProject(old);
      return { pages: migrated.pages.length, items: migrated.pages[0].items, roundtrip: JSON.stringify(normalizeProject(migrated)) === JSON.stringify(migrated) };
    });
    assert.equal(migration.pages, 2);
    assert.deepEqual(migration.items.map(item => item.id), ['a', 'b']);
    assert.deepEqual(migration.items.map(item => item.slot), [0, 1]);
    assert.ok(migration.items[1].cropAspect > 0);
    assert.equal(migration.items[1].focusX, 20);
    assert.ok(migration.roundtrip);

    await page.locator('#canvasPage .design-item').first().click();
    assert.equal(await page.locator('.fit-btn:visible').count(), 3);
    assert.equal(await page.locator('.fit-btn[data-frame="square"]').isHidden(), true);
    for (const mode of ['horizontal', 'vertical', 'original']) {
      await page.locator(`.fit-btn[data-frame="${mode}"]`).click();
      const frame = await page.evaluate(() => { const item = findItem(selectedItemId); return { frame: item.frame, fit: item.fit, cropAspect: item.cropAspect }; });
      assert.equal(frame.frame, mode);
      assert.equal(frame.fit, mode === 'original' ? 'contain' : 'cover');
      if (mode === 'original') assert.equal(frame.cropAspect, null);
      else assert.ok(frame.cropAspect > 0);
    }
    await page.locator('#photoTitle').fill('Título que debe conservarse');
    await page.locator('#photoShotType').selectOption('PD');
    await page.locator('[data-camera-preset="pan-right"]').click();
    assert.equal(await page.locator('#canvasPage .design-photo > .camera-move-overlay.camera-move-pan-right').count(), 1);
    assert.equal(await page.locator('#canvasPage .camera-move-overlay > span').count(), 0, 'camera arrows do not add a label over the image');
    await page.locator('#photoAnnotationColor').fill('#00aaee');
    await page.locator('#photoCameraScale').fill('120');
    const moveBefore = await page.evaluate(() => { const item = findItem(selectedItemId); return [item.cameraMoveX, item.cameraMoveY, item.cameraMoveScale, item.cameraMoveColor]; });
    await page.locator('#moveCameraOverlayBtn').click();
    const cameraOverlayBox = await page.locator('#canvasPage .camera-move-overlay.is-editing').boundingBox();
    await page.mouse.move(cameraOverlayBox.x + cameraOverlayBox.width / 2, cameraOverlayBox.y + cameraOverlayBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cameraOverlayBox.x + cameraOverlayBox.width / 2 + 24, cameraOverlayBox.y + cameraOverlayBox.height / 2 + 12, { steps: 6 });
    await page.mouse.up();
    const moveAfter = await page.evaluate(() => { const item = findItem(selectedItemId); return [item.cameraMoveX, item.cameraMoveY, item.cameraMoveScale, item.cameraMoveColor]; });
    assert.notDeepEqual(moveAfter.slice(0, 2), moveBefore.slice(0, 2), 'camera arrows can be dragged over the photo');
    assert.equal(moveAfter[2], 1.2);
    assert.equal(moveAfter[3], '#00aaee');
    const arrowLayering = await page.evaluate(() => {
      const photo = document.querySelector('#canvasPage .design-item.is-selected .design-photo');
      const item = photo?.closest('.design-item');
      const overlay = photo?.querySelector('.camera-move-overlay');
      const nextItem = item?.nextElementSibling;
      return {
        photoOverflow: getComputedStyle(photo).overflow,
        photoContain: getComputedStyle(photo).contain,
        photoIsolation: getComputedStyle(photo).isolation,
        itemIsolation: getComputedStyle(item).isolation,
        selectedZIndex: getComputedStyle(item).zIndex,
        overlayZIndex: getComputedStyle(overlay).zIndex,
        nextZIndex: nextItem ? getComputedStyle(nextItem).zIndex : 'auto',
        overlayInsidePhoto: overlay?.parentElement === photo
      };
    });
    assert.equal(arrowLayering.photoOverflow, 'clip', 'the photo clips camera arrows at its own bounds');
    assert.match(arrowLayering.photoContain, /paint/, 'the photo establishes a paint clipping boundary');
    assert.equal(arrowLayering.photoIsolation, 'isolate');
    assert.equal(arrowLayering.itemIsolation, 'isolate');
    assert.equal(arrowLayering.selectedZIndex, '20', 'the selected photo owns the arrow layer while editing');
    assert.equal(arrowLayering.overlayZIndex, '12');
    assert.equal(arrowLayering.overlayInsidePhoto, true);
    assert.equal(await page.locator('#cameraMoveSpill').isChecked(), false, 'camera arrows stay clipped by default');
    await page.locator('#cameraMoveSpill').check({ force: true });
    const spillLayering = await page.evaluate(() => {
      const item = document.querySelector('#canvasPage .design-item.is-selected');
      const photo = item?.querySelector('.design-photo');
      const overlay = photo?.querySelector('.camera-move-overlay');
      return { itemClass: item?.classList.contains('has-camera-spill'), photoOverflow: getComputedStyle(photo).overflow, photoContain: getComputedStyle(photo).contain, overlayZIndex: getComputedStyle(overlay).zIndex };
    });
    assert.equal(spillLayering.itemClass, true, 'spill mode belongs to the selected shot');
    assert.equal(spillLayering.photoOverflow, 'visible', 'spill mode lets the arrow leave the photo');
    assert.equal(spillLayering.photoContain, 'none', 'spill mode releases the photo paint clip');
    assert.equal(spillLayering.overlayZIndex, '30', 'spilled arrows sit above neighboring photos');
    const spillOverlayBox = await page.locator('#canvasPage .camera-move-overlay.camera-spill').boundingBox();
    await page.mouse.move(spillOverlayBox.x + spillOverlayBox.width / 2, spillOverlayBox.y + spillOverlayBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(spillOverlayBox.x - spillOverlayBox.width * 3, spillOverlayBox.y - spillOverlayBox.height * .5, { steps: 8 });
    await page.mouse.up();
    const freeSpillPosition = await page.evaluate(() => { const item = findItem(selectedItemId); return [item.cameraMoveX, item.cameraMoveY]; });
    assert.ok(freeSpillPosition[0] < 8, 'spill arrows can move freely beyond the photo left edge');
    await page.evaluate(() => saveProject());
    await page.waitForTimeout(400);
    const persistedSpillPosition = await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('storyboard-studio-projects-v1')); const current = saved.find(entry => entry.id === project.id); const item = current.pages[0].items.find(entry => entry.id === selectedItemId); return [item.cameraMoveSpill, item.cameraMoveX, item.cameraMoveY]; });
    assert.equal(persistedSpillPosition[0], true);
    assert.equal(persistedSpillPosition[1], freeSpillPosition[0]);
    assert.equal(persistedSpillPosition[2], freeSpillPosition[1]);
    await page.locator('#cameraMoveSpill').uncheck({ force: true });
    await page.locator('#photoDrawingWidth').fill('4');
    await page.locator('#drawOnPhotoBtn').click();
    const drawingLayerBox = await page.locator('#canvasPage .photo-drawing-layer.is-editing').boundingBox();
    await page.mouse.move(drawingLayerBox.x + drawingLayerBox.width * .2, drawingLayerBox.y + drawingLayerBox.height * .25);
    await page.mouse.down();
    await page.mouse.move(drawingLayerBox.x + drawingLayerBox.width * .75, drawingLayerBox.y + drawingLayerBox.height * .7, { steps: 14 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => findItem(selectedItemId).drawingStrokes.length), 1);
    assert.equal(await page.evaluate(() => findItem(selectedItemId).drawingStrokes[0].width), 4);
    assert.equal(await page.locator('#canvasPage .photo-drawing-layer path').count(), 1);
    await page.locator('#undoDrawingBtn').click();
    assert.equal(await page.evaluate(() => findItem(selectedItemId).drawingStrokes.length), 0);
    await page.mouse.move(drawingLayerBox.x + drawingLayerBox.width * .25, drawingLayerBox.y + drawingLayerBox.height * .7);
    await page.mouse.down();
    await page.mouse.move(drawingLayerBox.x + drawingLayerBox.width * .7, drawingLayerBox.y + drawingLayerBox.height * .3, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => findItem(selectedItemId).drawingStrokes.length), 1);
    await page.screenshot({ path: path.join(os.tmpdir(), 'storyapp-camera-tools.png'), fullPage: true });
    await page.locator('#drawOnPhotoBtn').click();
    await page.locator('#autoArrangeBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    assert.equal(await page.locator('#pageTotal').textContent(), '1');
    await page.locator('#autoArrangeBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    await page.locator('#duplicatePhotoBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    await page.locator('#deletePhotoBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    await page.locator('[data-asset-id="asset-14"]').dragTo(page.locator('#canvasPage'), { targetPosition: { x: 500, y: 300 } });
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    // Dragging an existing shot outside the artboard removes it; a deliberate duplicate restores it.
    const removable = page.locator('#canvasPage .design-item').last();
    const removableBox = await removable.boundingBox();
    const boardBox = await page.locator('#canvasPage').boundingBox();
    await page.mouse.move(removableBox.x + removableBox.width / 2, removableBox.y + removableBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(boardBox.x - 80, boardBox.y - 80, { steps: 10 });
    await page.mouse.up();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    await page.locator('#canvasPage .design-item').first().click();
    await page.locator('#duplicatePhotoBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    const first = await page.locator('#canvasPage .design-item').first().boundingBox();
    const last = await page.locator('#canvasPage .design-item').last().boundingBox();
    const firstItemId = await page.locator('#canvasPage .design-item').first().getAttribute('data-item-id');
    const firstItemText = await page.locator('#canvasPage .design-item').first().locator('.description-box').textContent();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 3);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 3, { steps: 10 });
    await page.mouse.up();
    assert.equal(await page.locator('#canvasPage .design-item').last().getAttribute('data-item-id'), firstItemId);
    assert.equal(await page.locator('#canvasPage .design-item').last().locator('.description-box').textContent(), firstItemText);
    const expectedLastTitle = await page.evaluate(() => currentPage().items.at(-1).title);

    await page.locator('[data-inspector="page"]').click();
    assert.equal(await page.locator('[data-inspector="info"]').count(), 1);
    await page.locator('#backgroundPattern').selectOption('dots');
    assert.match(await page.locator('#canvasPage').evaluate(node => getComputedStyle(node).backgroundImage), /radial-gradient/);
    await page.locator('#backgroundImageInput').setInputFiles({ name: 'fondo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#d8d8d8"/></svg>') });
    await page.waitForFunction(() => Boolean(project.backgroundImage));
    assert.match(await page.locator('#canvasPage').evaluate(node => getComputedStyle(node).backgroundImage), /url\(/);
    assert.equal(await page.locator('#removeBackgroundImageBtn').isDisabled(), false);
    const inspectorWidth = () => page.evaluate(() => {
      const panel = document.querySelector('.inspector-panel').getBoundingClientRect();
      const editor = document.querySelector('.editor-area').getBoundingClientRect();
      return { panel: panel.width, editor: editor.width };
    });
    const pageInspectorLayout = await inspectorWidth();
    await page.locator('[data-inspector="photo"]').click();
    const photoInspectorLayout = await inspectorWidth();
    await page.locator('[data-inspector="info"]').click();
    const infoInspectorLayout = await inspectorWidth();
    assert.ok(Math.abs(pageInspectorLayout.panel - photoInspectorLayout.panel) < 1 && Math.abs(pageInspectorLayout.panel - infoInspectorLayout.panel) < 1, 'inspector width stays stable across tabs');
    assert.ok(Math.abs(pageInspectorLayout.editor - photoInspectorLayout.editor) < 1 && Math.abs(pageInspectorLayout.editor - infoInspectorLayout.editor) < 1, 'editor width stays stable across tabs');
    assert.equal(await page.locator('#projectTitle').isVisible(), true);
    assert.equal(await page.locator('#showClientMeta').isVisible(), false);
    await page.locator('#projectProducer').fill('GB Films');
    await page.locator('[data-inspector="page"]').click();
    await page.locator('#infoStyle').selectOption('light');
    assert.equal(await page.locator('#canvasPage .description-style-light').count(), 16);
    assert.deepEqual(await page.locator('#canvasPage .description-style-light').first().evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]), ['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
    await page.locator('#infoPlacement').selectOption('overlay');
    assert.equal(await page.locator('#canvasPage .description-overlay').count(), 16);
    assert.equal(await page.locator('#infoStyle').isDisabled(), false);
    assert.equal(await page.locator('#canvasPage .description-overlay.description-style-light').count(), 16);
    assert.deepEqual(await page.locator('#canvasPage .description-overlay.description-style-light').first().evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]), ['rgba(255, 255, 255, 0.92)', 'rgb(0, 0, 0)']);
    const descriptionLayering = await page.locator('#canvasPage .description-overlay').first().evaluate(node => {
      const arrow = node.closest('.design-photo')?.querySelector('.camera-move-overlay');
      return { descriptionZIndex: getComputedStyle(node).zIndex, arrowZIndex: arrow ? getComputedStyle(arrow).zIndex : null };
    });
    assert.equal(descriptionLayering.descriptionZIndex, '40', 'descriptions stay above camera arrows');
    assert.equal(descriptionLayering.arrowZIndex, '12');
    await page.locator('#infoPlacement').selectOption('below');
    assert.equal(await page.locator('#canvasPage .description-overlay').count(), 0);
    await page.locator('#showProducerBranding').check({ force: true });
    await page.locator('#producerLogoInput').setInputFiles({ name: 'gb-films.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="black"/></svg>') });
    await page.waitForSelector('#canvasPage .storyboard-meta-frame');
    await page.waitForSelector('#canvasPage .storyboard-meta-producer img');
    assert.equal(await page.locator('#canvasPage .storyboard-meta-producer img').count(), 1);
    assert.match(await page.locator('#canvasPage .storyboard-meta-producer').textContent(), /GB Films/);
    await page.locator('[data-inspector="info"]').click();
    await page.locator('#projectClient').fill('Cliente prueba');
    await page.locator('[data-inspector="page"]').click();
    await page.locator('#showClientMeta').check({ force: true });
    await page.locator('[data-inspector="info"]').click();
    await page.locator('#clientLogoInput').setInputFiles({ name: 'cliente.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#ff00aa"/></svg>') });
    await page.waitForSelector('#canvasPage .storyboard-meta-client-logo');
    assert.equal(await page.locator('#canvasPage .storyboard-meta-client-logo').count(), 1);
    assert.equal(await page.locator('#removeClientLogoBtn').isDisabled(), false);
    assert.equal(await page.locator('#canvasPage .storyboard-meta-frame').evaluate(node => node.classList.contains('is-frame-hidden')), true);
    // No image/caption may extend beyond its assigned card or beyond the safe area.
    const check = await page.evaluate(() => {
      const board = document.querySelector('#canvasPage').getBoundingClientRect();
      return [...document.querySelectorAll('#canvasPage .design-item')].every(node => {
        const card = node.getBoundingClientRect();
        const photo = node.querySelector('.design-photo').getBoundingClientRect();
        const caption = node.querySelector('.description-box').getBoundingClientRect();
        return card.left >= board.left + board.width * .06 - 1 && card.right <= board.right - board.width * .06 + 1 && card.top >= board.top + board.height * .06 - 1 && card.bottom <= board.bottom - board.height * .06 + 1 && photo.bottom <= card.bottom + 1 && caption.bottom <= card.bottom + 1;
      });
    });
    assert.ok(check, 'DOM photos and captions respect safe layout');
    for (const type of ['png', 'jpg']) {
      await page.locator('#exportBtn').click();
      const downloadPromise = page.waitForEvent('download');
      await page.locator(`[data-export="${type}"]`).click();
      const download = await downloadPromise;
      assert.ok((await fs.promises.stat(await download.path())).size > 100);
      if (type === 'png') await download.saveAs(path.join(os.tmpdir(), 'storyapp-adaptive-export.png'));
    }
    assert.equal(await page.locator('[data-export="json"]').count(), 0);
    const totalPagesForPng = await page.evaluate(() => project.pages.length);
    await page.locator('#exportBtn').click();
    const allPngDownload = page.waitForEvent('download');
    await page.locator('[data-export="png-all"]').click();
    const allPngDownloadResult = await allPngDownload;
    assert.match(allPngDownloadResult.suggestedFilename(), /-todas-las-paginas-png\.zip$/);
    const zipBytes = await fs.promises.readFile(await allPngDownloadResult.path());
    assert.ok(zipBytes.length > totalPagesForPng * 100);
    let zipEntryCount = 0;
    for (let offset = 0; offset < zipBytes.length - 3; offset += 1) if (zipBytes.readUInt32LE(offset) === 0x04034b50) zipEntryCount += 1;
    assert.equal(zipEntryCount, totalPagesForPng);
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('#exportBtn').click();
    await page.locator('[data-export="print"]').click();
    assert.equal(await page.locator('.print-page .design-item').count(), 16);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true; window.STUDIO_PERMISSIONS = { storyboards: true }; window.dispatchEvent(new Event('studio-auth-change')); });
    assert.equal(await page.locator('.project-card-arrow').count(), 0);
    assert.equal(await page.locator('.project-version-chip').count(), 0);
    assert.equal(await page.locator('[data-edit-project]').count(), 1);
    assert.equal(await page.locator('[data-delete-project]').count(), 1);
    assert.equal(await page.locator('.project-card-edit-row').count(), 0);
    const dashboardHero = await page.evaluate(() => { const hero = document.querySelector('.dashboard-hero').getBoundingClientRect(); const copy = document.querySelector('.dashboard-hero-copy').getBoundingClientRect(); const projects = document.querySelector('.projects-section').getBoundingClientRect(); return { heroHeight: hero.height, copyWidth: copy.width, projectsTop: projects.top }; });
    assert.ok(dashboardHero.heroHeight < 360, 'dashboard welcome block stays compact');
    assert.ok(dashboardHero.copyWidth > 600, 'dashboard welcome copy uses the horizontal space');
    const dashboardCard = await page.locator('.project-card').first().boundingBox();
    const dashboardCardOpen = await page.locator('.project-card-open').first().boundingBox();
    const dashboardEdit = await page.locator('[data-edit-project]').first().boundingBox();
    assert.ok(dashboardEdit.y > dashboardCard.y + dashboardCard.height - 60, 'dashboard actions stay in the bottom area');
    assert.ok(dashboardEdit.y + dashboardEdit.height <= dashboardCardOpen.y + dashboardCardOpen.height, 'dashboard actions stay inside the card');
    await page.locator('[data-edit-project]').click();
    assert.equal(await page.locator('[data-project-title]').isVisible(), true);
    assert.equal(await page.locator('.project-card-edit-row').count(), 0);
    const editingAction = await page.locator('[data-edit-project]').first().boundingBox();
    const editingCard = await page.locator('.project-card').first().boundingBox();
    assert.ok(editingAction.y > editingCard.y + editingCard.height - 60, 'dashboard actions stay at the bottom while editing');
    await page.locator('[data-project-title]').press('Enter');
    await page.locator('[data-open-project]').first().click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    await page.evaluate(() => { project.background = '#111111'; project.frameTextColor = '#ff00aa'; project.descriptionTextColor = '#00aaff'; render(); });
    const customTextVisual = await page.evaluate(() => { const top = document.querySelector('.storyboard-meta-top'); const description = document.querySelector('.description-box'); return { topBackground: getComputedStyle(top).backgroundColor, frameColor: getComputedStyle(document.querySelector('.storyboard-meta-frame')).color, descriptionColor: getComputedStyle(description).color }; });
    assert.equal(customTextVisual.topBackground, 'rgba(0, 0, 0, 0)', 'editorial frame stays transparent over custom backgrounds');
    assert.equal(customTextVisual.frameColor, 'rgb(255, 0, 170)', 'editorial frame text color is customizable');
    assert.equal(customTextVisual.descriptionColor, 'rgb(0, 170, 255)', 'shot text color is customizable');
    await page.evaluate(() => { project.background = '#ffffff'; project.frameTextColor = '#111111'; project.descriptionTextColor = ''; render(); });
    assert.match(await page.locator('#canvasPage .design-item').last().textContent(), new RegExp(expectedLastTitle));
    await page.locator('[data-add-page]').click();
    assert.equal(await page.locator('#pageTotal').textContent(), '2');
    assert.equal(await page.locator('#canvasPage .design-item').count(), 0);
    const pageSource = page.locator('[data-page-index="0"]');
    const pageTarget = page.locator('[data-page-index="1"]');
    const pageTargetBox = await pageTarget.boundingBox();
    await page.keyboard.down('Alt');
    const pageSourceBox = await pageSource.boundingBox();
    await page.mouse.move(pageSourceBox.x + pageSourceBox.width / 2, pageSourceBox.y + pageSourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pageTargetBox.x + pageTargetBox.width * .8, pageTargetBox.y + pageTargetBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    assert.equal(await page.locator('#pageTotal').textContent(), '3');
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    await page.locator('[data-page-menu]').nth(2).click();
    const pageMenu = page.locator('.page-thumb-menu').nth(2);
    assert.equal(await pageMenu.locator('[data-copy-page="2"]').textContent(), 'Duplicar');
    assert.equal(await pageMenu.locator('[data-export-page-png="2"]').textContent(), 'Exportar rápido como PNG');
    const menuPlacement = await pageMenu.evaluate(menu => { const button = menu.parentElement.querySelector('[data-page-menu]').getBoundingClientRect(); const rect = menu.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height, styleTop: menu.style.top, viewport: window.innerHeight, isAbove: rect.bottom <= button.top + 1, isBelow: rect.top >= button.bottom - 1 }; });
    assert.ok(menuPlacement.bottom <= menuPlacement.viewport && (menuPlacement.isAbove || menuPlacement.isBelow), 'page menu stays attached and inside the viewport');
    await page.locator('[data-delete-page-menu="2"]').click();
    assert.equal(await page.locator('#pageTotal').textContent(), '2');
    await page.keyboard.press('Control+Z');
    assert.equal(await page.locator('#pageTotal').textContent(), '3');
    assert.equal(await page.locator('#deletePageConfirmModal').isVisible(), false);
    assert.equal(await page.locator('#deletePageBtn').count(), 0);
    await page.locator('#clearPageBtn').click();
    assert.equal(await page.locator('#clearPageConfirmModal').isVisible(), true);
    await page.locator('#cancelClearPageBtn').click();
    assert.equal(await page.locator('#clearPageConfirmModal').isVisible(), false);
    await page.locator('#clearPageBtn').click();
    await page.locator('#confirmClearPageBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 0);
    await page.keyboard.press('Control+Z');
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    await page.evaluate(() => { project.ratio = 'landscape'; render(); createProjectVersion('portrait'); });
    await page.waitForFunction(() => projectVersions().length === 2);
    assert.equal(await page.locator('#versionSwitcher').count(), 0);
    assert.equal(await page.locator('#saveState').count(), 0);
    const landscapeVersionId = await page.evaluate(() => projects.find(entry => entry.versionGroupId === project.versionGroupId && entry.ratio === 'landscape').id);
    await page.locator('#manageVersionsBtn').click();
    await page.locator(`[data-open-version="${landscapeVersionId}"]`).click();
    await page.waitForFunction(() => project.ratio === 'landscape');
    const portraitVersionId = await page.evaluate(() => projects.find(entry => entry.versionGroupId === project.versionGroupId && entry.ratio === 'portrait').id);
    await page.locator('#manageVersionsBtn').click();
    await page.locator(`[data-open-version="${portraitVersionId}"]`).click();
    await page.waitForFunction(() => project.ratio === 'portrait');
    const portraitWorkspace = await page.evaluate(() => { const carousel = document.querySelector('#pageCarousel').getBoundingClientRect(); const canvas = document.querySelector('#canvasPage').getBoundingClientRect(); const stage = document.querySelector('#canvasStage').getBoundingClientRect(); return { carouselRight: carousel.right, canvasLeft: canvas.left, canvasHeight: canvas.height, stageHeight: stage.height }; });
    assert.ok(portraitWorkspace.carouselRight <= portraitWorkspace.canvasLeft + 1, 'portrait pages stay to the left of the canvas');
    assert.ok(portraitWorkspace.canvasHeight <= portraitWorkspace.stageHeight + 1, 'portrait canvas fits its workspace');
    await page.locator('#manageVersionsBtn').click();
    assert.equal(await page.locator('#versionsModal').isVisible(), true);
    assert.equal(await page.locator('[data-version-row]').count(), 2);
    await page.locator('[data-version-name]').nth(1).fill('Vertical Stories');
    await page.locator('[data-version-name]').nth(1).press('Tab');
    await page.waitForFunction(() => projects.some(entry => entry.versionName === 'Vertical Stories'));
    await page.locator('[data-delete-version]').nth(1).click();
    assert.equal(await page.locator('#deleteVersionModal').isVisible(), true);
    await page.locator('#confirmDeleteVersionBtn').click();
    await page.waitForFunction(() => project.ratio === 'landscape');
    await page.evaluate(() => createProjectVersion('portrait'));
    await page.waitForFunction(() => project.ratio === 'portrait' && projectVersions().length === 2);
    await page.evaluate(() => showDashboard());
    assert.equal(await page.locator('.project-version-chip').count(), 0);
    assert.doesNotMatch(await page.locator('#projectCount').textContent(), /versi[oó]n/i);
    const groupedCardLayout = await page.locator('.project-card').first().evaluate(card => {
      const outer = card.getBoundingClientRect();
      const open = card.querySelector('.project-card-open').getBoundingClientRect();
      const actions = card.querySelector('.project-card-actions').getBoundingClientRect();
      return { outerBottom: outer.bottom, openBottom: open.bottom, actionsBottom: actions.bottom };
    });
    assert.ok(Math.abs(groupedCardLayout.outerBottom - groupedCardLayout.openBottom) <= 1, 'dashboard card fills its grid row');
    assert.ok(groupedCardLayout.actionsBottom <= groupedCardLayout.openBottom, 'dashboard actions remain inside grouped project cards');
    await page.locator('[data-open-project]').first().click();
    const recreatedPortraitId = await page.evaluate(() => projects.find(entry => entry.versionGroupId === project.versionGroupId && entry.ratio === 'portrait').id);
    await page.locator('#manageVersionsBtn').click();
    await page.locator(`[data-open-version="${recreatedPortraitId}"]`).click();
    await page.waitForFunction(() => project.ratio === 'portrait');
    // Check real-browser layout for mixed orientations on vertical and square pages too.
    for (const ratio of ['portrait', 'square']) {
      await page.evaluate(ratio => {
        project.ratio = ratio;
        currentPage().items = createAutoItems(project.assets.slice(6));
        render();
      }, ratio);
      const inside = await page.locator('#canvasPage').evaluate(board => {
        const rect = board.getBoundingClientRect();
        return [...board.querySelectorAll('.design-item')].every(item => {
          const card = item.getBoundingClientRect();
          return card.left > rect.left && card.right < rect.right && card.top > rect.top && card.bottom < rect.bottom;
        });
      });
      assert.ok(inside, ratio);
      const canvasBox = await page.locator('#canvasPage').boundingBox();
      const expectedAspect = ratio === 'portrait' ? 9 / 16 : 1;
      assert.ok(Math.abs(canvasBox.width / canvasBox.height - expectedAspect) < .03, `${ratio} canvas keeps its aspect ratio`);
      await page.locator('#canvasPage').screenshot({ path: path.join(os.tmpdir(), `storyapp-adaptive-${ratio}.png`) });
    }
    assert.equal(await page.locator('#clearLibraryConfirmModal').isVisible(), false);
    const usedAssetId = await page.evaluate(() => currentPage().items[0]?.assetId);
    await page.locator(`[data-delete-asset="${usedAssetId}"]`).click();
    assert.equal(await page.locator('#deleteAssetConfirmModal').isVisible(), true);
    await page.locator('#cancelDeleteAssetBtn').click();
    assert.equal(await page.locator('#deleteAssetConfirmModal').isVisible(), false);
    const beforeAssetCount = await page.locator('[data-delete-asset]').count();
    await page.locator(`[data-delete-asset="${usedAssetId}"]`).click();
    await page.locator('#confirmDeleteAssetBtn').click();
    assert.equal(await page.locator('[data-delete-asset]').count(), beforeAssetCount - 1);
    assert.equal(await page.evaluate(id => project.assets.some(asset => asset.id === id), usedAssetId), false);
    assert.equal(await page.evaluate(id => currentPage().items.some(item => item.assetId === id), usedAssetId), false);
    await page.locator('#clearLibraryBtn').click();
    assert.equal(await page.locator('#clearLibraryConfirmModal').isVisible(), true);
    await page.locator('#cancelClearLibraryBtnSecondary').click();
    assert.equal(await page.locator('#clearLibraryConfirmModal').isVisible(), false);
    await page.locator('#clearLibraryBtn').click();
    await page.locator('#confirmClearLibraryBtn').click();
    assert.equal(await page.locator('[data-delete-asset]').count(), 0);
    assert.equal(await page.locator('#canvasPage .design-item').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: migration, unlimited add, duplicate, delete, drag/reorder, overlay, export, persistence and manual pages.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

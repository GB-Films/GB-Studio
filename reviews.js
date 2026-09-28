/* GB Studio Reviews: local media, time-linked feedback and frame annotations. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const DB_NAME = 'gb-studio-reviews-v1';
  const ACTIVE_KEY = 'gb-studio-reviews-active-v1';
  const state = { records: [], projects: [], projectId: null, versionId: null, active: null, mediaUrl: null, model: null, drawing: false, sketchMode: false, tool: 'pen', draft: [], scratch: [], activeCommentId: null, pointerId: null, saving: false, view: { scale: 1, x: 0, y: 0 }, zHeld: false, zoomPointer: null, shareToken: null, guestName: '', guestUid: null, stopComments: null };
  const video = $('#reviewsVideo');
  const image = $('#reviewsImage');
  const canvas = $('#reviewsCanvas');
  const ctx = canvas.getContext('2d');
  let databasePromise;
  let initialized;
  let hydratedUserUid = null;

  function openDatabase() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }
  async function databaseRequest(storeName, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      let result;
      try { result = action(transaction.objectStore(storeName)); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el archivo'));
    });
  }
  const cloud = () => import('./reviews-cloud.js?v=3');
  const canReview = key => window.STUDIO_ROLE === 'admin' || window.STUDIO_PERMISSIONS?.[key] === true;
  async function saveRecord(record) {
    if (!canReview('reviewsEdit')) throw new Error('No tenés permiso para editar Reviews.');
    const token = state.projects.find(project => project.id === record.projectId)?.versions.find(version => version.id === record.versionId)?.shareToken;
    if (token && record.source === 'dropbox') await (await cloud()).upsertSharedFile(token, record);
    if (window.STUDIO_SIGNED_IN && !isGuestReview()) await (await cloud()).saveStaffFile(record);
    await databaseRequest('items', 'readwrite', store => store.put(record));
  }
  async function saveProject(project) {
    if (!canReview(state.projects.some(entry => entry.id === project.id) ? 'reviewsEdit' : 'reviewsCreate')) throw new Error('No tenés permiso para guardar este proyecto.');
    const shared = project.versions.filter(version => version.shareToken);
    if (shared.length) { const api = await cloud(); for (const version of shared) await api.updateShareMetadata(project, version); }
    if (window.STUDIO_SIGNED_IN && !isGuestReview()) await (await cloud()).saveStaffProject(project);
    await databaseRequest('projects', 'readwrite', store => store.put(project));
  }
  async function getMedia(id) { return databaseRequest('media', 'readonly', store => store.get(id)); }
  function currentProject() { return state.projects.find(project => project.id === state.projectId); }
  function currentVersion() { return currentProject()?.versions.find(version => version.id === state.versionId); }
  function versionRecords() { return state.records.filter(record => record.versionId === state.versionId); }
  function formatTime(seconds) {
    const whole = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
    const hours = Math.floor(whole / 3600);
    const minutes = String(Math.floor(whole / 60) % 60).padStart(2, '0');
    const rest = String(whole % 60).padStart(2, '0');
    return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
  }
  function parseDropboxLink(input) {
    let url;
    try { url = new URL(input.trim()); } catch { throw new Error('Pegá un enlace válido de Dropbox.'); }
    if (url.protocol !== 'https:' || !['dropbox.com', 'www.dropbox.com'].includes(url.hostname) || url.username || url.password || url.port || !/^\/(?:s\/[^/]+|scl\/fi\/[^/]+)(?:\/[^/]+)?\/?$/.test(url.pathname)) {
      throw new Error('Usá un enlace compartido de un archivo de dropbox.com, no una carpeta ni otra página.');
    }
    url.hash = '';
    url.searchParams.delete('dl'); url.searchParams.delete('raw');
    const sourceUrl = url.href;
    url.searchParams.set('raw', '1');
    const pathParts = url.pathname.split('/').filter(Boolean);
    let name = pathParts.length > (pathParts[0] === 's' ? 2 : 3) ? pathParts.at(-1) : 'Archivo de Dropbox';
    if (name) { try { name = decodeURIComponent(name); } catch { /* Keep the safe encoded name. */ } }
    if (!name || name === 'fi' || name === 's') name = 'Archivo de Dropbox';
    return { sourceUrl, streamUrl: url.href, name };
  }
  function sharedReviewFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('review')) return null;
    try { return { ...parseDropboxLink(params.get('review')), kind: params.get('kind') === 'image' ? 'image' : 'video' }; }
    catch { return null; }
  }
  const sharedReview = sharedReviewFromHash();
  const sharedToken = new URLSearchParams(location.hash.slice(1)).get('share');
  if (sharedReview || sharedToken) document.body.classList.add('public-review');
  if (sharedReview) document.body.classList.add('legacy-public-review');
  if (sharedToken) { state.shareToken = sharedToken; state.guestName = sessionStorage.getItem(`gb-review-guest:${sharedToken}`) || ''; }
  let formMode = null;
  let confirmResolve = null;
  let sectionEditId = null;
  let draggedRecordId = null;
  function closeForm() { $('#reviewsFormModal').hidden = true; formMode = null; }
  function askConfirmation(title, copy, label = 'Eliminar') {
    $('#reviewsConfirmTitle').textContent = title;
    $('#reviewsConfirmCopy').textContent = copy;
    $('#reviewsConfirmAccept').textContent = label;
    $('#reviewsConfirmModal').hidden = false;
    $('#reviewsConfirmCancel').focus();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function closeConfirmation(accepted) { $('#reviewsConfirmModal').hidden = true; confirmResolve?.(accepted); confirmResolve = null; }
  function openForm(type, entity = null) {
    if (!canReview(entity ? 'reviewsEdit' : 'reviewsCreate')) return;
    formMode = { type, id: entity?.id || null };
    const project = type === 'project';
    $('#reviewsProjectFields').hidden = !project;
    $('#reviewsVersionFields').hidden = project;
    $('#reviewsEntityClient').required = project;
    $('#reviewsEntityTitle').value = entity?.title || '';
    $('#reviewsEntityClient').value = entity?.client || '';
    $('#reviewsEntityAgency').value = entity?.agency || '';
    $('#reviewsEntityDirector').value = entity?.director || '';
    $('#reviewsEntityCategory').value = entity?.category || 'Montaje';
    $('#reviewsFormTitle').textContent = `${entity ? 'Editar' : project ? 'Nuevo' : 'Nueva'} ${project ? 'proyecto' : 'review'}`;
    $('#reviewsFormCopy').textContent = project ? 'El proyecto reúne distintas instancias de feedback, cada una con sus propios archivos y comentarios.' : 'Una review independiente para montaje, VFX, cliente u otra etapa.';
    $('#reviewsFormSubmit').textContent = entity ? 'Guardar cambios →' : project ? 'Crear proyecto →' : 'Crear review →';
    $('#reviewsFormModal').hidden = false;
    $('#reviewsEntityTitle').focus();
  }
  function cardAction(label, title, handler) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', title); button.addEventListener('click', handler); return button; }
  function renderHome() {
    const project = currentProject();
    const grid = $('#reviewsHomeGrid'); grid.replaceChildren();
    $('#reviewsHomeTitle').textContent = project ? project.title : 'Proyectos de review';
    $('#reviewsHomeCopy').textContent = project ? 'Elegí una review o creá otra para una etapa distinta. Cada review tiene sus archivos y comentarios.' : 'Organizá las revisiones por proyecto y separá el feedback de montaje, VFX y cliente.';
    $('#reviewsCreateProject').hidden = Boolean(project) || !canReview('reviewsCreate');
    $('#reviewsCreateVersion').hidden = !canReview('reviewsCreate');
    $('#reviewsProjectContext').hidden = !project;
    $('#reviewsHomeSectionLabel').textContent = project ? 'REVIEWS DE ESTE PROYECTO' : 'PROYECTOS';
    const entries = project ? [...project.versions] : [...state.projects];
    $('#reviewsHomeCount').textContent = `${entries.length} ${project ? entries.length === 1 ? 'review' : 'reviews' : entries.length === 1 ? 'proyecto' : 'proyectos'}`;
    $('#reviewsHomeEmpty').hidden = entries.length > 0;
    $('#reviewsEmptyCreate').textContent = project ? '＋ Crear review' : '＋ Crear proyecto';
    $('#reviewsHomeEmpty h2').textContent = project ? 'Todavía no hay reviews.' : 'Un lugar para cada devolución.';
    $('#reviewsHomeEmpty p').textContent = project ? 'Creá una review de montaje, VFX o cliente para empezar a cargar material.' : 'Creá un proyecto y después abrí reviews distintas para montaje, VFX o cliente.';
    $('#reviewsEmptyCreate').hidden = !canReview('reviewsCreate');
    if (project) $('#reviewsProjectMeta').textContent = [project.client && `CLIENTE · ${project.client}`, project.agency && `AGENCIA · ${project.agency}`, project.director && `DIRECTOR · ${project.director}`, 'GRAN BERTA FILMS'].filter(Boolean).join('  /  ');
    for (const entry of entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const card = document.createElement('article'); card.className = 'reviews-home-card';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'reviews-home-card-open';
      const mark = document.createElement('span'); mark.className = 'reviews-home-card-mark'; mark.textContent = project ? entry.category.slice(0, 1) : '▣';
      const tag = document.createElement('span'); tag.className = 'reviews-home-card-tag'; tag.textContent = project ? entry.category.toUpperCase() : (entry.client || 'SIN CLIENTE').toUpperCase();
      const title = document.createElement('strong'); title.textContent = entry.title;
      const count = document.createElement('small'); const records = project ? state.records.filter(record => record.versionId === entry.id) : state.records.filter(record => record.projectId === entry.id);
      count.textContent = project ? `${records.length} archivo${records.length === 1 ? '' : 's'} · ${records.reduce((sum, record) => sum + record.comments.length, 0)} comentarios` : `${entry.versions.length} review${entry.versions.length === 1 ? '' : 's'} · ${records.length} archivos`;
      const arrow = document.createElement('span'); arrow.className = 'reviews-home-card-arrow'; arrow.textContent = '↗';
      open.append(mark, tag, title, count, arrow);
      open.addEventListener('click', () => project ? openVersion(entry.id) : showReviewsHome(entry.id));
      const actions = document.createElement('div'); actions.className = 'reviews-home-card-actions';
      if (project && canReview('reviewsShare')) actions.append(cardAction('↗ Compartir', `Compartir ${entry.title}`, () => shareVersion(entry.id)));
      if (canReview('reviewsEdit')) {
        actions.append(cardAction('✎ Editar', `Editar ${entry.title}`, () => openForm(project ? 'version' : 'project', entry)));
        const shared = project ? Boolean(entry.shareToken) : entry.versions.some(version => version.shareToken);
        if (!shared || canReview('reviewsShare')) actions.append(cardAction('⌫ Eliminar', `Eliminar ${entry.title}`, () => project ? deleteVersion(entry.id) : deleteProject(entry.id)));
      }
      card.append(open); if (actions.childElementCount) card.append(actions); grid.append(card);
    }
  }
  function showReviewsHome(projectId = null) {
    if (document.body.classList.contains('public-review')) return;
    if (document.body.classList.contains('auth-locked')) return;
    if (!canReview('reviewsView')) return;
    showDashboard();
    stopMedia(); state.active = null; state.projectId = projectId; state.versionId = null;
    $('#dashboardView').hidden = true; $('#reviewsHome').hidden = false; $('#reviewsView').hidden = true;
    $('#storyboardsNav').classList.remove('is-active'); $('#reviewsNav').classList.add('is-active');
    $('#breadcrumbTitle').textContent = currentProject()?.title || 'Reviews';
    renderHome();
  }
  window.STUDIO_SHOW_REVIEWS = () => showReviewsHome();
  async function openVersion(versionId) {
    const project = currentProject(); const version = project?.versions.find(entry => entry.id === versionId);
    if (!version) return;
    state.versionId = versionId;
    showReviews();
    const records = versionRecords();
    const preferred = records.find(record => record.id === localStorage.getItem(ACTIVE_KEY));
    if (records.length) await selectRecord((preferred || records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]).id);
    else clearViewer();
  }
  async function shareVersion(versionId = state.versionId) {
    if (!canReview('reviewsShare')) return;
    const project = currentProject(), version = project?.versions.find(entry => entry.id === versionId);
    if (!version) return;
    const records = state.records.filter(record => record.versionId === versionId);
    if (!records.length) {
      const message = 'Vinculá al menos un archivo de Dropbox antes de compartir esta review.';
      if ($('#reviewsHome').hidden) showStatus(message); else $('#reviewsHomeCopy').textContent = message;
      return;
    }
    if (records.some(record => record.source !== 'dropbox')) {
      const message = 'Esta review todavía tiene archivos locales antiguos. Quitalos o reemplazalos por enlaces de Dropbox antes de compartir.';
      if ($('#reviewsHome').hidden) showStatus(message); else $('#reviewsHomeCopy').textContent = message;
      return;
    }
    try {
      const token = await (await cloud()).publishReview(project, version, records);
      if (!version.shareToken) {
        const updated = { ...project, versions: project.versions.map(entry => entry.id === version.id ? { ...entry, shareToken: token } : entry) };
        await saveProject(updated);
        state.projects = state.projects.map(entry => entry.id === project.id ? updated : entry);
      }
      const link = new URL(location.href); link.hash = new URLSearchParams({ share: token }).toString();
      $('#reviewsCopyInput').value = link.href;
      $('#reviewsCopyModal').hidden = false;
      $('#reviewsCopyInput').focus(); $('#reviewsCopyInput').select();
      try { await navigator.clipboard.writeText(link.href); $('#reviewsCopyDescription').textContent = 'Enlace copiado. El cliente solo verá esta review; podrá comentar y dibujar luego de escribir su nombre.'; }
      catch { $('#reviewsCopyDescription').textContent = 'Copiá el enlace para enviárselo al cliente. Solo podrá entrar a esta review.'; }
      if (!$('#reviewsHome').hidden) renderHome();
    } catch (error) {
      console.error('Review sharing failed', error);
      const message = 'No se pudo publicar la review. Revisá que Firestore esté activo y que tengas permiso de acceso.';
      if ($('#reviewsHome').hidden) showStatus(message); else $('#reviewsHomeCopy').textContent = message;
    }
  }
  async function deleteProject(id) {
    if (!canReview('reviewsEdit')) return;
    const project = state.projects.find(entry => entry.id === id); if (!project) return;
    if (project.versions.some(version => version.shareToken) && !canReview('reviewsShare')) return;
    if (!await askConfirmation('¿Eliminar este proyecto?', `Se van a quitar “${project.title}”, sus reviews y comentarios. Los enlaces compartidos dejarán de funcionar. Los originales de Dropbox no se borrarán.`)) return;
    try {
      if (project.versions.some(version => version.shareToken)) {
        const api = await cloud();
        for (const version of project.versions) if (version.shareToken) await api.deleteSharedReview(version.shareToken);
      }
      if (window.STUDIO_SIGNED_IN) {
        const api = await cloud();
        for (const record of state.records.filter(entry => entry.projectId === id)) await api.deleteStaffFile(record.id);
        await api.deleteStaffProject(id);
      }
      const db = await openDatabase();
      await new Promise((resolve, reject) => { const tx = db.transaction(['projects', 'items', 'media'], 'readwrite'); tx.objectStore('projects').delete(id); for (const record of state.records.filter(entry => entry.projectId === id)) { tx.objectStore('items').delete(record.id); tx.objectStore('media').delete(record.id); } tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
      state.projects = state.projects.filter(entry => entry.id !== id); state.records = state.records.filter(entry => entry.projectId !== id);
      if (state.projectId === id) state.projectId = null;
      renderHome();
    } catch (error) { console.error(error); $('#reviewsHomeCopy').textContent = 'No se pudo eliminar este proyecto. Revisá el almacenamiento del navegador.'; }
  }
  async function deleteVersion(id) {
    if (!canReview('reviewsEdit')) return;
    const project = currentProject(), version = project?.versions.find(entry => entry.id === id); if (!version) return;
    if (version.shareToken && !canReview('reviewsShare')) return;
    if (!await askConfirmation('¿Eliminar esta review?', `Se van a quitar “${version.title}”, sus archivos y comentarios. Su enlace compartido dejará de funcionar. Las otras reviews se conservan.`)) return;
    const updated = { ...project, versions: project.versions.filter(entry => entry.id !== id), updatedAt: new Date().toISOString() };
    try {
      if (version.shareToken) await (await cloud()).deleteSharedReview(version.shareToken);
      if (window.STUDIO_SIGNED_IN) {
        const api = await cloud();
        for (const record of state.records.filter(entry => entry.versionId === id)) await api.deleteStaffFile(record.id);
        await api.saveStaffProject(updated);
      }
      const db = await openDatabase();
      await new Promise((resolve, reject) => { const tx = db.transaction(['projects', 'items', 'media'], 'readwrite'); tx.objectStore('projects').put(updated); for (const record of state.records.filter(entry => entry.versionId === id)) { tx.objectStore('items').delete(record.id); tx.objectStore('media').delete(record.id); } tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
      state.projects = state.projects.map(entry => entry.id === project.id ? updated : entry); state.records = state.records.filter(entry => entry.versionId !== id); renderHome();
    } catch (error) { console.error(error); $('#reviewsHomeCopy').textContent = 'No se pudo eliminar esta review. Revisá el almacenamiento del navegador.'; }
  }
  function isGuestReview() { return document.body.classList.contains('public-review'); }
  function canComment() { return isGuestReview() ? Boolean(state.shareToken && (state.guestName || window.STUDIO_SIGNED_IN)) : canReview('reviewsEdit'); }
  function applyReviewPermissions() {
    const guest = isGuestReview();
    $('#reviewsGuestPrompt').hidden = !guest || canComment() || !state.shareToken;
    $('#reviewsCommentForm').hidden = !canComment() || !state.active;
    $('#reviewsAnnotationBar').hidden = !canComment() || !state.active;
    $('#reviewsRemoveMedia').hidden = guest || !state.active || !canReview('reviewsEdit');
    $('#reviewsLinkBtn').hidden = guest || !canReview('reviewsEdit');
    $('#reviewsAddSection').hidden = guest || !canReview('reviewsEdit');
    $('#reviewsShareBtn').hidden = guest || state.active?.source !== 'dropbox' || !canReview('reviewsShare');
    $('#reviewsDownloadBtn').hidden = !isMp4();
    $('#reviewsCommentStorageNote').textContent = state.shareToken || currentVersion()?.shareToken ? 'Los comentarios y dibujos de esta review se comparten con quienes tengan el enlace.' : 'Este comentario se guarda solo en este navegador hasta que compartas la review.';
    renderCommentList();
  }
  function isVideo() { return state.active?.kind === 'video'; }
  function currentTime() { return isVideo() ? Math.max(0, video.currentTime || 0) : 0; }
  function showStatus(message) { $('#reviewsCommentContext').textContent = message; }
  function stopMedia() { video.pause(); video.removeAttribute('src'); video.load(); image.removeAttribute('src'); state.model?.dispose(); state.model = null; if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl); state.mediaUrl = null; }
  function clearAnnotation() { state.draft = []; state.scratch = []; state.activeCommentId = null; redraw(); renderCommentList(); }
  function fps() { return Number(state.active?.fps) || 24; }
  function firstFrame() { return Number.isSafeInteger(state.active?.frameStart) ? state.active.frameStart : 1; }
  function frameIndex() { return Math.round(currentTime() * fps()); }
  function lastFrameIndex() { return Number.isFinite(video.duration) ? Math.max(0, Math.ceil(video.duration * fps()) - 1) : 0; }
  function frameNumber() { return firstFrame() + Math.min(frameIndex(), lastFrameIndex()); }
  function frameMode() { return state.active?.timelineMode === 'frames'; }
  function seekFrame(index) { if (!isVideo() || !Number.isFinite(video.duration)) return; video.pause(); video.currentTime = Math.min(video.duration, Math.max(0, Math.min(lastFrameIndex(), Math.round(index))) / fps()); updateClock(); }
  function isMp4() { return isVideo() && /\.mp4$/i.test(state.active?.name || ''); }
  async function saveActiveSettings() { if (!state.active || isGuestReview() || state.active.ephemeral) return; state.active.updatedAt = new Date().toISOString(); try { await saveRecord(state.active); } catch { showStatus('No se pudieron guardar los ajustes.'); } }
  function resetView() { state.view = { scale: 1, x: 0, y: 0 }; applyView(); state.model?.fit(); }
  function applyView() { $('#reviewsMediaSurface').style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`; $('#reviewsZoomValue').textContent = `${Math.round(state.view.scale * 100)}%`; }
  function zoomAt(factor, clientX, clientY) {
    const next = Math.max(.25, Math.min(12, state.view.scale * factor));
    const ratio = next / state.view.scale;
    const stage = $('#reviewsStage').getBoundingClientRect();
    state.view.x += (1 - ratio) * (clientX - (stage.left + stage.width / 2 + state.view.x));
    state.view.y += (1 - ratio) * (clientY - (stage.top + stage.height / 2 + state.view.y));
    state.view.scale = next; applyView();
  }
  function resizeCanvas() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    redraw();
  }
  function fitSurface() {
    const stage = $('#reviewsStage'), surface = $('#reviewsMediaSurface');
    if (surface.hidden || !stage.clientWidth || !stage.clientHeight) return;
    const style = getComputedStyle(stage);
    const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const aspect = Number(surface.style.getPropertyValue('--review-aspect')) || 16 / 9;
    const fittedWidth = Math.max(1, Math.min(width, height * aspect));
    surface.style.width = `${fittedWidth}px`;
    surface.style.height = `${fittedWidth / aspect}px`;
    resizeCanvas();
  }
  function visibleStrokes() {
    if (state.sketchMode) return state.scratch;
    if (state.draft.length) return state.draft;
    return state.active?.comments.find(comment => comment.id === state.activeCommentId)?.strokes || [];
  }
  function redraw() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of visibleStrokes()) {
      if (!stroke.points?.length) continue;
      const tool = stroke.tool || 'pen';
      const [startX, startY] = stroke.points[0];
      const [endX, endY] = stroke.points.at(-1);
      const x0 = startX * width, y0 = startY * height, x1 = endX * width, y1 = endY * height;
      ctx.save();
      ctx.beginPath();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color || '#ff3b30';
      ctx.lineWidth = tool === 'eraser' ? Math.max(14, width * .035) : tool === 'highlighter' ? Math.max(12, width * .025) : Math.max(2, width * .004);
      if (tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
      if (tool === 'highlighter') ctx.globalAlpha = .38;
      if (tool === 'rect' || tool === 'square') ctx.rect(x0, y0, x1 - x0, y1 - y0);
      else if (tool === 'circle' || tool === 'ellipse') {
        const radiusX = Math.abs(x1 - x0) / 2, radiusY = Math.abs(y1 - y0) / 2;
        if (radiusX && radiusY) ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
      } else if (tool === 'line' || tool === 'arrow') {
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        if (tool === 'arrow' && Math.hypot(x1 - x0, y1 - y0) > 2) {
          const angle = Math.atan2(y1 - y0, x1 - x0), head = Math.max(10, Math.min(23, width * .025));
          ctx.moveTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x1, y1);
          ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
        }
      } else {
        stroke.points.forEach(([x, y], index) => index ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height));
        if (stroke.points.length === 1) ctx.lineTo(x0 + .1, y0 + .1);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  }
  function shapePoint(start, point, tool) {
    if (tool !== 'square' && tool !== 'circle') return point;
    const dx = (point[0] - start[0]) * canvas.clientWidth, dy = (point[1] - start[1]) * canvas.clientHeight;
    const side = Math.min(Math.abs(dx), Math.abs(dy));
    return [start[0] + Math.sign(dx) * side / canvas.clientWidth, start[1] + Math.sign(dy) * side / canvas.clientHeight];
  }
  function sectionDefinitions() { return [...(currentVersion()?.sections || []), { id: 'default', title: 'Sin clasificar' }]; }
  function recordSection(record) { return record.sectionId || 'default'; }
  function orderedRecords(sectionId) { return versionRecords().filter(record => recordSection(record) === sectionId).sort((a, b) => (Number.isFinite(a.sortIndex) ? a.sortIndex : -Date.parse(a.createdAt || a.updatedAt)) - (Number.isFinite(b.sortIndex) ? b.sortIndex : -Date.parse(b.createdAt || b.updatedAt))); }
  async function moveRecord(recordId, targetSectionId, beforeId = null) {
    const record = versionRecords().find(entry => entry.id === recordId);
    if (!record || !sectionDefinitions().some(section => section.id === targetSectionId)) return;
    const sourceSectionId = recordSection(record);
    const sourceIds = orderedRecords(sourceSectionId).map(entry => entry.id).filter(id => id !== recordId);
    const targetIds = sourceSectionId === targetSectionId ? sourceIds : orderedRecords(targetSectionId).map(entry => entry.id);
    const index = beforeId && targetIds.includes(beforeId) ? targetIds.indexOf(beforeId) : targetIds.length;
    targetIds.splice(index, 0, recordId);
    const updates = new Map();
    const applyOrder = (ids, sectionId) => ids.forEach((id, sortIndex) => { const original = state.records.find(entry => entry.id === id); updates.set(id, { ...original, sectionId, sortIndex }); });
    if (sourceSectionId !== targetSectionId) applyOrder(sourceIds, sourceSectionId);
    applyOrder(targetIds, targetSectionId);
    try {
      const token = currentVersion()?.shareToken;
      if (token || window.STUDIO_SIGNED_IN) { const api = await cloud(); for (const updated of updates.values()) { if (token) await api.upsertSharedFile(token, updated); if (window.STUDIO_SIGNED_IN) await api.saveStaffFile(updated); } }
      const db = await openDatabase();
      await new Promise((resolve, reject) => { const tx = db.transaction('items', 'readwrite'); for (const updated of updates.values()) tx.objectStore('items').put(updated); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
      state.records = state.records.map(entry => updates.get(entry.id) || entry);
      if (state.active) state.active = state.records.find(entry => entry.id === state.active.id) || state.active;
      renderList();
    } catch (error) { console.error(error); showStatus('No se pudo cambiar el orden en este navegador.'); }
  }
  function openSectionForm(section = null) { sectionEditId = section?.id || null; $('#reviewsSectionName').value = section?.title || ''; $('#reviewsSectionForm').hidden = false; $('#reviewsSectionName').focus(); }
  function closeSectionForm() { sectionEditId = null; $('#reviewsSectionForm').hidden = true; }
  async function deleteSection(id) {
    const version = currentVersion(), section = version?.sections?.find(entry => entry.id === id); if (!section) return;
    if (!await askConfirmation('¿Eliminar esta sección?', `Los archivos de “${section.title}” se moverán a Sin clasificar. No se borrarán los archivos ni sus comentarios.`, 'Eliminar sección')) return;
    const project = currentProject();
    const updatedProject = { ...project, versions: project.versions.map(entry => entry.id === version.id ? { ...entry, sections: entry.sections.filter(item => item.id !== id) } : entry) };
    const moved = orderedRecords(id).map((record, index) => ({ ...record, sectionId: 'default', sortIndex: orderedRecords('default').length + index }));
    try {
      if (version.shareToken) {
        const api = await cloud(); await api.updateShareMetadata(updatedProject, updatedProject.versions.find(entry => entry.id === id));
        for (const record of moved) await api.upsertSharedFile(version.shareToken, record);
      }
      if (window.STUDIO_SIGNED_IN) { const api = await cloud(); await api.saveStaffProject(updatedProject); for (const record of moved) await api.saveStaffFile(record); }
      const db = await openDatabase();
      await new Promise((resolve, reject) => { const tx = db.transaction(['projects', 'items'], 'readwrite'); tx.objectStore('projects').put(updatedProject); moved.forEach(record => tx.objectStore('items').put(record)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
      state.projects = state.projects.map(entry => entry.id === project.id ? updatedProject : entry);
      const changes = new Map(moved.map(record => [record.id, record])); state.records = state.records.map(entry => changes.get(entry.id) || entry);
      if (state.active) state.active = state.records.find(entry => entry.id === state.active.id) || state.active;
      renderList();
    } catch (error) { console.error(error); showStatus('No se pudo eliminar la sección.'); }
  }
  function renderList() {
    const list = $('#reviewsList');
    list.replaceChildren();
    const records = sharedReview ? state.active ? [state.active] : [] : versionRecords();
    $('#reviewsCount').textContent = records.length;
    $('#reviewsAddSection').hidden = !currentVersion() || isGuestReview() || !canReview('reviewsEdit');
    if (!records.length && !currentVersion()) { const empty = document.createElement('p'); empty.className = 'reviews-list-empty'; empty.textContent = 'Todavía no hay archivos.'; list.append(empty); return; }
    const sections = currentVersion() ? sectionDefinitions() : [{ id: 'default', title: 'Archivos' }];
    for (const section of sections) {
      const group = document.createElement('section'); group.className = 'reviews-section'; group.dataset.sectionId = section.id;
      const heading = document.createElement('div'); heading.className = 'reviews-section-heading';
      const title = document.createElement('strong'); title.textContent = section.title;
      const sectionRecords = currentVersion() ? orderedRecords(section.id) : records;
      const count = document.createElement('span'); count.textContent = String(sectionRecords.length);
      heading.append(title, count);
      if (section.id !== 'default' && !isGuestReview()) {
        const edit = cardAction('✎', `Renombrar sección ${section.title}`, () => openSectionForm(section));
        const remove = cardAction('×', `Eliminar sección ${section.title}`, () => deleteSection(section.id));
        heading.append(edit, remove);
      }
      const files = document.createElement('div'); files.className = 'reviews-section-files'; files.dataset.sectionId = section.id;
      if (!sectionRecords.length) { const empty = document.createElement('p'); empty.className = 'reviews-section-empty'; empty.textContent = records.length ? 'Arrastrá acá un archivo de esta review' : 'Vinculá un archivo de Dropbox'; files.append(empty); }
      for (const record of sectionRecords) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `reviews-file${record.id === state.active?.id ? ' is-active' : ''}`; button.dataset.recordId = record.id; button.draggable = Boolean(currentVersion()) && !isGuestReview();
        const icon = document.createElement('span'); icon.className = 'reviews-file-icon'; icon.textContent = record.kind === 'video' ? '▶' : record.kind === 'model' ? '◇' : '▧';
        const copy = document.createElement('span'); copy.className = 'reviews-file-copy';
        const name = document.createElement('strong'); name.textContent = record.name;
        const details = document.createElement('small'); details.textContent = `${record.source === 'dropbox' ? 'DROPBOX · ' : 'LOCAL ANTERIOR · '}${record.kind === 'video' ? 'VIDEO' : record.kind === 'model' ? 'FBX 3D' : 'FOTO'} · ${record.comments.length} comentario${record.comments.length === 1 ? '' : 's'}`;
        copy.append(name, details); button.append(icon, copy); button.addEventListener('click', () => selectRecord(record.id)); files.append(button);
      }
      group.append(heading, files); list.append(group);
    }
  }
  function renderMarkers() {
    const wrapper = $('#reviewsMarkers'); wrapper.replaceChildren();
    if (!isVideo() || !Number.isFinite(video.duration) || !video.duration) return;
    for (const comment of state.active.comments) {
      const marker = document.createElement('button'); marker.type = 'button'; marker.className = `reviews-marker${comment.resolved ? ' is-resolved' : ''}`;
      marker.style.left = `${Math.max(0, Math.min(100, comment.time / video.duration * 100))}%`;
      marker.title = `${formatTime(comment.time)} · ${comment.text || 'Anotación'}`;
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => selectComment(comment.id)); wrapper.append(marker);
    }
  }
  function renderCommentList() {
    const list = $('#reviewsCommentList'); list.replaceChildren();
    if (sharedReview) { $('#reviewsCommentCount').textContent = '0'; const empty = document.createElement('p'); empty.className = 'reviews-comment-empty'; empty.textContent = 'Este enlace antiguo muestra un archivo individual. Pedí el enlace nuevo de la review para compartir comentarios.'; list.append(empty); return; }
    const comments = state.active?.comments || [];
    $('#reviewsCommentCount').textContent = comments.length;
    if (!state.active) return;
    if (!comments.length) {
      const empty = document.createElement('p'); empty.className = 'reviews-comment-empty'; empty.textContent = state.active.kind === 'model' ? 'Aún no hay comentarios sobre este modelo.' : 'Aún no hay comentarios. Pausá el video o elegí un punto de la foto para dejar la primera corrección.'; list.append(empty); return;
    }
    for (const comment of [...comments].sort((a, b) => a.time - b.time || a.createdAt.localeCompare(b.createdAt))) {
      const card = document.createElement('article'); card.className = `reviews-comment${comment.id === state.activeCommentId ? ' is-selected' : ''}${comment.resolved ? ' is-resolved' : ''}`;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'reviews-comment-open';
      const meta = document.createElement('span'); meta.className = 'reviews-comment-meta'; meta.textContent = `${comment.authorName ? `${comment.authorName} · ` : ''}${isVideo() ? formatTime(comment.time) : 'FOTO'}${comment.strokes?.length ? ' · ✎ Anotación' : ''}`;
      const text = document.createElement('span'); text.className = 'reviews-comment-text'; text.textContent = comment.text || 'Anotación visual';
      open.append(meta, text); open.addEventListener('click', () => selectComment(comment.id));
      card.append(open);
      if (canReview('reviewsEdit') || (isGuestReview() && comment.authorUid && comment.authorUid === state.guestUid)) {
        const actions = document.createElement('div'); actions.className = 'reviews-comment-actions';
        const resolve = document.createElement('button'); resolve.type = 'button'; resolve.textContent = comment.resolved ? 'Reabrir' : 'Resolver'; resolve.addEventListener('click', () => updateComment(comment.id, entry => { entry.resolved = !entry.resolved; }));
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => updateComment(comment.id, null));
        actions.append(resolve, remove); card.append(actions);
      }
      list.append(card);
    }
  }
  function updateClock() {
    const inFrames = frameMode(), seek = $('#reviewsSeek');
    $('#reviewsCurrentTime').textContent = inFrames ? String(frameNumber()) : formatTime(currentTime());
    $('#reviewsDuration').textContent = inFrames ? String(firstFrame() + lastFrameIndex()) : formatTime(video.duration);
    $('#reviewsCommentTime').textContent = isVideo() ? formatTime(currentTime()) : 'Foto';
    seek.max = String(inFrames ? Math.max(1, lastFrameIndex()) : 1000);
    seek.step = '1';
    seek.value = video.duration ? String(inFrames ? Math.min(frameIndex(), lastFrameIndex()) : Math.round(currentTime() / video.duration * 1000)) : '0';
    seek.setAttribute('aria-label', inFrames ? `Fotograma ${frameNumber()}; usar flechas para avanzar de a uno` : 'Posición del video en el tiempo');
    $('#reviewsFrameJumpLabel').hidden = !inFrames;
    if (document.activeElement !== $('#reviewsFrameJump')) $('#reviewsFrameJump').value = String(frameNumber());
    $('#reviewsPlayBtn').textContent = video.paused ? '▶' : '❚❚';
    $('#reviewsPlayBtn').setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
    $('#reviewsMuteBtn').textContent = video.muted ? '×' : '♪';
    $('#reviewsMuteBtn').setAttribute('aria-label', video.muted ? 'Activar sonido' : 'Silenciar');
    $('#reviewsFrameNumber').textContent = `Fotograma ${frameNumber()}`;
  }
  function renderPlaybackSettings() {
    const record = state.active;
    $('#reviewsFps').value = String(record?.fps || 24);
    $('#reviewsTimelineMode').value = frameMode() ? 'frames' : 'time';
    $('#reviewsFrameStart').value = String(firstFrame());
    $('#reviewsInValue').textContent = Number.isFinite(record?.inPoint) ? formatTime(record.inPoint) : '—';
    $('#reviewsOutValue').textContent = Number.isFinite(record?.outPoint) ? formatTime(record.outPoint) : '—';
    for (const [id, point] of [['#reviewsInMarker', record?.inPoint], ['#reviewsOutMarker', record?.outPoint]]) {
      const marker = $(id); marker.hidden = !Number.isFinite(point) || !Number.isFinite(video.duration) || !video.duration;
      if (!marker.hidden) marker.style.left = `${Math.max(0, Math.min(100, point / video.duration * 100))}%`;
    }
    updateClock();
  }
  async function selectRecord(id) {
    const record = state.records.find(entry => entry.id === id); if (!record) return;
    state.stopComments?.(); state.stopComments = null;
    stopMedia(); state.active = record; state.draft = []; state.scratch = []; state.sketchMode = false; state.activeCommentId = null; state.drawing = false; resetView();
    localStorage.setItem(ACTIVE_KEY, id);
    renderList(); renderCommentList();
    $('#reviewsMediaTitle').textContent = record.name;
    $('#reviewsMediaTitle').title = record.name;
    $('#reviewsMediaSurface').style.setProperty('--review-aspect', String(16 / 9));
    $('#reviewsMediaError').hidden = true;
    $('#reviewsShareBtn').hidden = record.source !== 'dropbox' || isGuestReview() || !canReview('reviewsShare');
    $('#reviewsEmpty').hidden = true; $('#reviewsMediaSurface').hidden = false;
    $('#reviewsAnnotationBar').hidden = false; $('#reviewsCommentForm').hidden = false; $('#reviewsRemoveMedia').hidden = false;
    $('#reviewsViewTools').hidden = false; $('#reviewsPlaybackTools').hidden = record.kind !== 'video'; $('#reviewsDownloadBtn').hidden = !isMp4();
    $('#reviewsTimeline').hidden = record.kind !== 'video';
    $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false');
    canvas.classList.remove('is-drawing');
    showStatus(record.kind === 'video' ? 'Los comentarios se guardan en el segundo actual.' : record.kind === 'model' ? 'Arrastrá para orbitar el modelo. Los comentarios no cambian el FBX.' : 'Los comentarios se guardan sobre esta foto.');
    image.hidden = record.kind !== 'image'; video.hidden = record.kind !== 'video'; $('#reviewsModel').hidden = record.kind !== 'model'; canvas.hidden = record.kind === 'model';
    renderPlaybackSettings(); requestAnimationFrame(fitSurface);
    applyReviewPermissions();
    const token = state.shareToken || currentVersion()?.shareToken;
    if (token) {
      state.stopComments = (await cloud()).watchComments(token, id, comments => {
        if (state.active?.id !== id) return;
        state.active.comments = comments;
        renderCommentList(); renderMarkers(); renderList(); redraw();
      }, error => { console.error('Could not load shared comments', error); showStatus('No se pudieron cargar los comentarios compartidos.'); });
    }
    try {
      if (record.source === 'dropbox') {
        const link = parseDropboxLink(record.sourceUrl);
        if (record.kind === 'model') {
          const response = await fetch(link.streamUrl);
          if (!response.ok) throw new Error('Dropbox no permitió abrir este FBX. Revisá el enlace compartido.');
          const { mountFbx } = await import('./reviews-3d.js?v=1');
          if (state.active?.id !== id) return;
          const viewer = await mountFbx($('#reviewsModel'), await response.blob());
          if (state.active?.id !== id) { viewer.dispose(); return; }
          state.model = viewer; return;
        }
        if (record.kind === 'video') video.src = link.streamUrl; else image.src = link.streamUrl;
        updateClock(); renderMarkers(); requestAnimationFrame(resizeCanvas);
        return;
      }
      const blob = await getMedia(id);
      if (state.active?.id !== id) return;
      if (!blob) throw new Error('El archivo ya no está disponible en este navegador');
      if (record.kind === 'model') {
        const { mountFbx } = await import('./reviews-3d.js?v=1');
        if (state.active?.id !== id) return;
        const viewer = await mountFbx($('#reviewsModel'), blob);
        if (state.active?.id !== id) { viewer.dispose(); return; }
        state.model = viewer;
        return;
      }
      state.mediaUrl = URL.createObjectURL(blob);
      if (record.kind === 'video') video.src = state.mediaUrl; else image.src = state.mediaUrl;
      updateClock(); renderMarkers(); requestAnimationFrame(resizeCanvas);
    } catch (error) { showStatus(error.message || 'No se pudo abrir el archivo'); $('#reviewsMediaError').hidden = false; console.error(error); }
  }
  function selectComment(id) {
    const comment = state.active?.comments.find(entry => entry.id === id); if (!comment) return;
    video.pause();
    if (isVideo()) video.currentTime = Math.min(comment.time, Number.isFinite(video.duration) ? video.duration : comment.time);
    state.activeCommentId = id; state.draft = []; state.scratch = []; state.sketchMode = false; state.drawing = false;
    canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false');
    renderCommentList(); redraw(); updateClock();
  }
  async function updateComment(id, mutate) {
    if (!state.active || !canComment()) return;
    const previous = structuredClone(state.active.comments);
    if (mutate) { const entry = state.active.comments.find(comment => comment.id === id); if (!entry) return; mutate(entry); }
    else state.active.comments = state.active.comments.filter(comment => comment.id !== id);
    if (state.activeCommentId === id && !mutate) state.activeCommentId = null;
    state.active.updatedAt = new Date().toISOString();
    try {
      const token = state.shareToken || currentVersion()?.shareToken;
      if (token) {
        const api = await cloud();
        if (mutate) await api.changeSharedComment(token, state.active.id, state.active.comments.find(comment => comment.id === id));
        else await api.deleteSharedComment(token, state.active.id, id);
      } else await saveRecord(state.active);
    } catch (error) { state.active.comments = previous; showStatus('No se pudo guardar el cambio.'); console.error(error); }
    renderCommentList(); renderList(); renderMarkers(); redraw();
  }
  async function addDropboxLink(event) {
    event.preventDefault();
    if (isGuestReview() || !currentVersion() || !canReview('reviewsEdit')) return;
    const message = $('#reviewsLinkMessage'); message.classList.remove('is-error');
    let link;
    try { link = parseDropboxLink($('#reviewsLinkUrl').value); }
    catch (error) { message.textContent = error.message; message.classList.add('is-error'); return; }
    const existing = state.records.find(record => record.versionId === state.versionId && record.source === 'dropbox' && record.sourceUrl === link.sourceUrl);
    if (existing) { await selectRecord(existing.id); message.textContent = 'Este archivo ya estaba vinculado; lo abrimos en el visor.'; return; }
    const now = new Date().toISOString();
    const record = { id: crypto.randomUUID(), projectId: state.projectId, versionId: state.versionId, sectionId: 'default', sortIndex: -Date.now(), name: link.name, kind: $('#reviewsLinkKind').value, source: 'dropbox', sourceUrl: link.sourceUrl, size: 0, createdAt: now, updatedAt: now, comments: [] };
    try {
      await saveRecord(record);
      state.records.unshift(record); await selectRecord(record.id);
      $('#reviewsLinkUrl').value = ''; setLinkFormOpen(false);
      message.textContent = 'En Dropbox: Compartir → Copiar enlace del archivo. Para verlo acá, debe permitir acceso a cualquiera con el enlace.';
    } catch (error) { message.textContent = 'No se pudo guardar el enlace en este navegador.'; message.classList.add('is-error'); console.error(error); }
  }
  function clearViewer() {
    state.stopComments?.(); state.stopComments = null;
    stopMedia(); state.active = null; localStorage.removeItem(ACTIVE_KEY);
    $('#reviewsMediaTitle').textContent = 'Elegí un archivo'; $('#reviewsMediaTitle').removeAttribute('title');
    $('#reviewsEmpty').hidden = false; $('#reviewsMediaSurface').hidden = true; $('#reviewsTimeline').hidden = true;
    $('#reviewsAnnotationBar').hidden = true; $('#reviewsCommentForm').hidden = true; $('#reviewsRemoveMedia').hidden = true; $('#reviewsShareBtn').hidden = true; $('#reviewsDownloadBtn').hidden = true; $('#reviewsMediaError').hidden = true; $('#reviewsViewTools').hidden = true; $('#reviewsPlaybackTools').hidden = true;
    showStatus('Elegí un archivo para ver sus comentarios.'); renderList(); renderCommentList();
  }
  async function removeActive() {
    if (!canReview('reviewsEdit')) return;
    const record = state.active; if (!record || !await askConfirmation('¿Quitar este archivo?', `Se van a quitar “${record.name}” y sus comentarios de este navegador.${record.source === 'dropbox' ? ' El archivo original de Dropbox se conserva.' : ''}`, 'Quitar archivo')) return;
    try {
      const token = currentVersion()?.shareToken;
      if (token) await (await cloud()).removeSharedFile(token, record.id);
      if (window.STUDIO_SIGNED_IN) await (await cloud()).deleteStaffFile(record.id);
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['items', 'media'], 'readwrite');
        tx.objectStore('items').delete(record.id); tx.objectStore('media').delete(record.id);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      stopMedia(); state.records = state.records.filter(entry => entry.id !== record.id); state.active = null; localStorage.removeItem(ACTIVE_KEY);
      const next = versionRecords()[0]; if (next) await selectRecord(next.id); else clearViewer();
    } catch (error) { showStatus('No se pudo eliminar el archivo.'); console.error(error); }
  }
  function showReviews() {
    const publicView = document.body.classList.contains('public-review');
    if (document.body.classList.contains('auth-locked') && !publicView) return;
    if (!publicView && !canReview('reviewsView')) return;
    showDashboard();
    if (publicView) document.body.classList.add('public-review');
    $('#dashboardView').hidden = true; $('#reviewsHome').hidden = true; $('#reviewsView').hidden = false; document.body.classList.add('reviews-open');
    $('#reviewsHudRestore').hidden = true;
    $('#storyboardsNav').classList.remove('is-active'); $('#reviewsNav').classList.add('is-active');
    $('#breadcrumbTitle').textContent = currentVersion()?.title || 'Reviews';
    $('#reviewsLibraryEyebrow').textContent = currentProject()?.title?.toUpperCase() || 'REVISIÓN DE MATERIAL';
    $('#reviewsLibraryTitle').firstChild.textContent = currentVersion()?.title || 'Reviews';
    applyReviewPermissions();
    requestAnimationFrame(fitSurface);
  }
  async function initialize() {
    if (sharedToken) {
      try {
        const share = await (await cloud()).getSharedReview(sharedToken);
        const project = { id: share.projectId, title: share.projectTitle, client: share.client, agency: share.agency, director: share.director,
          versions: [{ id: share.versionId, title: share.versionTitle, category: share.category, sections: share.sections || [], shareToken: sharedToken }] };
        state.projects = [project]; state.projectId = project.id; state.versionId = share.versionId;
        state.records = share.files;
        showReviews();
        const first = share.files.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))[0];
        if (first) await selectRecord(first.id); else clearViewer();
        if (state.guestName) (await cloud()).guestIdentity().then(user => { state.guestUid = user.uid; renderCommentList(); }).catch(error => console.error('Guest session could not resume', error));
      } catch (error) {
        console.error('Could not load shared review', error);
        showReviews(); clearViewer();
        $('#reviewsMediaTitle').textContent = 'Review no disponible';
        $('#reviewsEmpty p').textContent = 'El enlace puede estar vencido o la review fue retirada. Pedí un enlace nuevo al equipo de GB Studio.';
      }
      return;
    }
    try {
      state.records = await databaseRequest('items', 'readonly', store => store.getAll()) || [];
      state.projects = await databaseRequest('projects', 'readonly', store => store.getAll()) || [];
      const legacy = state.records.filter(record => !record.projectId || !record.versionId);
      if (legacy.length) {
        let project = state.projects.find(entry => entry.legacy);
        if (!project) {
          const now = new Date().toISOString();
          project = { id: crypto.randomUUID(), title: 'Reviews anteriores', client: 'Sin asignar', agency: '', director: '', legacy: true, createdAt: now, updatedAt: now, versions: [{ id: crypto.randomUUID(), title: 'Review original', category: 'General', createdAt: now, updatedAt: now }] };
        }
        const db = await openDatabase();
        await new Promise((resolve, reject) => { const tx = db.transaction(['projects', 'items'], 'readwrite'); tx.objectStore('projects').put(project); for (const record of legacy) { record.projectId = project.id; record.versionId = project.versions[0].id; tx.objectStore('items').put(record); } tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
        if (!state.projects.some(entry => entry.id === project.id)) state.projects.push(project);
      }
      renderList();
    } catch (error) { showStatus('Reviews necesita almacenamiento local del navegador para guardar archivos y comentarios.'); console.error(error); }
    if (sharedReview) {
      const record = { id: crypto.randomUUID(), name: sharedReview.name, kind: sharedReview.kind, source: 'dropbox', sourceUrl: sharedReview.sourceUrl, size: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [], ephemeral: true };
      state.records.unshift(record);
      await selectRecord(record.id);
      showReviews();
      return;
    }
    renderHome();
  }

  function setRangePoint(which) {
    if (!isVideo() || !Number.isFinite(video.duration)) return;
    const point = Math.max(0, Math.min(video.duration, currentTime()));
    if (which === 'in') { state.active.inPoint = point; if (Number.isFinite(state.active.outPoint) && state.active.outPoint <= point) state.active.outPoint = null; }
    else { state.active.outPoint = point; if (Number.isFinite(state.active.inPoint) && state.active.inPoint >= point) state.active.inPoint = null; }
    renderPlaybackSettings(); saveActiveSettings();
  }
  function stepFrame(direction) { seekFrame(frameIndex() + direction); }
  function jumpNote(direction) {
    if (!isVideo()) return;
    const times = [...new Set(state.active.comments.map(comment => comment.time))].sort((a, b) => a - b);
    const target = direction > 0 ? times.find(time => time > currentTime() + .02) : times.reverse().find(time => time < currentTime() - .02);
    if (target === undefined) return;
    video.pause(); video.currentTime = target;
    const comment = state.active.comments.find(entry => Math.abs(entry.time - target) < .001);
    if (comment) selectComment(comment.id);
  }
  async function screenshot() {
    if (!state.active) return;
    const source = state.active.kind === 'model' ? state.model?.canvas : isVideo() ? video : image;
    const width = source?.videoWidth || source?.naturalWidth || source?.width;
    const height = source?.videoHeight || source?.naturalHeight || source?.height;
    if (!width || !height) { showStatus('Esperá a que el archivo termine de cargar para capturar el cuadro.'); return; }
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    const outputContext = output.getContext('2d');
    try {
      outputContext.drawImage(source, 0, 0, width, height);
      if (!canvas.hidden) outputContext.drawImage(canvas, 0, 0, width, height);
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('El navegador bloqueó la captura del archivo externo.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${state.active.name.replace(/\.[^.]+$/, '')}-${isVideo() ? `fotograma-${frameNumber()}` : 'captura'}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showStatus('Captura PNG descargada.');
    } catch (error) { showStatus('No se pudo capturar este archivo externo: Dropbox no habilita la lectura de sus píxeles desde esta página.'); console.error(error); }
  }
  function downloadMp4() {
    if (!isMp4()) return;
    const anchor = document.createElement('a');
    if (state.active.source === 'dropbox') { const url = new URL(state.active.sourceUrl); url.searchParams.set('dl', '1'); anchor.href = url.href; }
    else anchor.href = state.mediaUrl;
    anchor.download = state.active.name; anchor.rel = 'noopener'; anchor.click();
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#reviewsView').requestFullscreen(); }
    catch { showStatus('El navegador no permitió activar pantalla completa.'); }
  }
  function toggleHud() { const hidden = document.body.classList.toggle('reviews-hud-hidden'); $('#reviewsHudRestore').hidden = !hidden; requestAnimationFrame(fitSurface); }
  function isEditingText(target) { return target?.closest?.('input,textarea,select,[contenteditable="true"]'); }

  const permissionLabels = [
    ['storyboards', 'Storyboards · usar y crear'],
    ['reviewsView', 'Reviews · ver proyectos'],
    ['reviewsCreate', 'Reviews · crear proyectos y reviews'],
    ['reviewsEdit', 'Reviews · editar y comentar'],
    ['reviewsShare', 'Reviews · compartir enlaces'],
  ];
  function permissionControls(container, values = {}) {
    for (const [key, label] of permissionLabels) {
      const wrapper = document.createElement('label'); wrapper.className = 'reviews-staff-permission';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.permission = key; checkbox.checked = values[key] === true;
      const caption = document.createElement('span'); caption.textContent = label;
      wrapper.append(checkbox, caption); container.append(wrapper);
      checkbox.addEventListener('change', () => {
        if (key.startsWith('reviews') && key !== 'reviewsView' && checkbox.checked) container.querySelector('[data-permission="reviewsView"]').checked = true;
        if ((key === 'reviewsCreate' || key === 'reviewsShare') && checkbox.checked) container.querySelector('[data-permission="reviewsEdit"]').checked = true;
        if (key === 'reviewsEdit' && !checkbox.checked) for (const dependent of ['reviewsCreate', 'reviewsShare']) container.querySelector(`[data-permission="${dependent}"]`).checked = false;
        if (key === 'reviewsView' && !checkbox.checked) container.querySelectorAll('[data-permission^="reviews"]:not([data-permission="reviewsView"])').forEach(input => { input.checked = false; });
      });
    }
  }
  function selectedPermissions(container) {
    return Object.fromEntries([...container.querySelectorAll('[data-permission]')].map(input => [input.dataset.permission, input.checked]));
  }
  async function refreshStaffList() {
    const list = $('#reviewsStaffList'); list.replaceChildren();
    const api = await cloud();
    const [staff, requests] = await Promise.all([api.staffList(), api.accessRequests()]);
    const staffByEmail = new Map(staff.map(person => [person.email, person]));
    const people = [...staff, ...requests.filter(person => !staffByEmail.has(person.email))]
      .map(person => ({ ...person, pending: !staffByEmail.has(person.email) }))
      .sort((a, b) => Number(b.pending) - Number(a.pending) || (a.name || a.email).localeCompare(b.name || b.email));
    const pendingCount = people.filter(person => person.pending).length;
    $('#reviewsStaffCount').textContent = `${staff.length} activas · ${pendingCount} pendientes`;
    if (!people.length) { const empty = document.createElement('p'); empty.textContent = 'Todavía no hay cuentas registradas.'; list.append(empty); }
    for (const person of people) {
      const row = document.createElement('div'); row.className = 'reviews-staff-row'; row.dataset.search = `${person.name || ''} ${person.email}`.toLowerCase();
      const head = document.createElement('div'); head.className = 'reviews-staff-head';
      const identity = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = person.name || person.email;
      const email = document.createElement('small'); email.textContent = person.email;
      identity.append(name, email);
      const status = document.createElement('span'); status.className = `reviews-staff-state${person.pending ? ' is-pending' : ''}`; status.textContent = person.pending ? 'Pendiente' : 'Activo';
      head.append(identity, status);
      const options = document.createElement('div'); options.className = 'reviews-staff-permissions';
      permissionControls(options, person.permissions || (person.pending ? {} : api.ALL_PERMISSIONS));
      const actions = document.createElement('div'); actions.className = 'reviews-staff-actions';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'button button-primary'; save.textContent = person.pending ? 'Habilitar cuenta' : 'Guardar permisos';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try { await api.saveStaff(person.email, selectedPermissions(options), person.name || ''); $('#reviewsStaffStatus').textContent = `Permisos de ${person.email} guardados.`; await refreshStaffList(); }
        catch (error) { $('#reviewsStaffStatus').textContent = error.message || 'No se pudieron guardar los permisos.'; console.error(error); }
        finally { save.disabled = false; }
      });
      actions.append(save);
      if (!person.pending) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'reviews-staff-remove'; remove.textContent = 'Quitar acceso';
        remove.addEventListener('click', async () => {
          if (!await askConfirmation('¿Quitar el acceso?', `${person.email} dejará de poder entrar a GB Studio con Google.`)) return;
          try { await api.removeStaff(person.email); $('#reviewsStaffStatus').textContent = 'Acceso quitado.'; await refreshStaffList(); }
          catch (error) { console.error(error); $('#reviewsStaffStatus').textContent = 'No se pudo quitar el acceso.'; }
        });
        actions.append(remove);
      }
      row.append(head, options, actions); list.append(row);
    }
    filterStaffList();
  }
  function filterStaffList() {
    const term = $('#reviewsStaffSearch').value.trim().toLowerCase();
    $('#reviewsStaffList').querySelectorAll('.reviews-staff-row').forEach(row => { row.hidden = Boolean(term && !row.dataset.search.includes(term)); });
  }
  permissionControls($('#reviewsStaffNewPermissions'));
  $('#reviewsStaffSearch').addEventListener('input', filterStaffList);
  $('#reviewsAdminBtn').addEventListener('click', async () => {
    if (window.STUDIO_ROLE !== 'admin') return;
    $('#reviewsAdminModal').hidden = false; $('#reviewsStaffStatus').textContent = '';
    try { await refreshStaffList(); } catch (error) { console.error(error); $('#reviewsStaffStatus').textContent = 'No se pudieron cargar los accesos. Revisá Firestore.'; }
  });
  $('#reviewsAdminClose').addEventListener('click', () => { $('#reviewsAdminModal').hidden = true; });
  $('#reviewsAdminModal').addEventListener('click', event => { if (event.target === $('#reviewsAdminModal')) $('#reviewsAdminModal').hidden = true; });
  $('#reviewsStaffForm').addEventListener('submit', async event => {
    event.preventDefault(); if (window.STUDIO_ROLE !== 'admin') return;
    const input = $('#reviewsStaffEmail'), submit = $('#reviewsStaffForm button[type=submit]'); submit.disabled = true;
    try { await (await cloud()).saveStaff(input.value, selectedPermissions($('#reviewsStaffNewPermissions'))); input.value = ''; $('#reviewsStaffNewPermissions').querySelectorAll('input').forEach(item => { item.checked = false; }); $('#reviewsStaffStatus').textContent = 'Cuenta autorizada. Ya puede iniciar sesión con Google.'; await refreshStaffList(); }
    catch (error) { console.error(error); $('#reviewsStaffStatus').textContent = error.message || 'No se pudo dar acceso.'; }
    finally { submit.disabled = false; }
  });

  $('#reviewsNav').addEventListener('click', () => isGuestReview() ? showReviews() : showReviewsHome());
  $('#dashboardReviewsBtn').addEventListener('click', () => showReviewsHome());
  $('#reviewsBackVersions').addEventListener('click', () => showReviewsHome(state.projectId));
  $('#reviewsBackProjects').addEventListener('click', () => showReviewsHome());
  $('#reviewsCreateProject').addEventListener('click', () => openForm('project'));
  $('#reviewsCreateVersion').addEventListener('click', () => openForm('version'));
  $('#reviewsEmptyCreate').addEventListener('click', () => openForm(currentProject() ? 'version' : 'project'));
  $('#reviewsFormClose').addEventListener('click', closeForm);
  $('#reviewsFormCancel').addEventListener('click', closeForm);
  $('#reviewsEntityForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!formMode) return;
    const title = $('#reviewsEntityTitle').value.trim(), client = $('#reviewsEntityClient').value.trim();
    if (!title || (formMode.type === 'project' && !client)) return;
    const now = new Date().toISOString();
    try {
      if (formMode.type === 'project') {
        const old = state.projects.find(entry => entry.id === formMode.id);
        const project = { id: old?.id || crypto.randomUUID(), title, client, agency: $('#reviewsEntityAgency').value.trim(), director: $('#reviewsEntityDirector').value.trim(), createdAt: old?.createdAt || now, updatedAt: now, versions: old?.versions || [{ id: crypto.randomUUID(), title: 'Montaje · V1', category: 'Montaje', createdAt: now, updatedAt: now }] };
        if (old?.legacy) project.legacy = true;
        await saveProject(project);
        state.projects = old ? state.projects.map(entry => entry.id === old.id ? project : entry) : [...state.projects, project];
        closeForm(); if (old) renderHome(); else showReviewsHome(project.id);
      } else {
        const project = currentProject(); if (!project) return;
        const old = project.versions.find(entry => entry.id === formMode.id);
        const version = { ...old, id: old?.id || crypto.randomUUID(), title, category: $('#reviewsEntityCategory').value, createdAt: old?.createdAt || now, updatedAt: now };
        const updated = { ...project, updatedAt: now, versions: old ? project.versions.map(entry => entry.id === old.id ? version : entry) : [...project.versions, version] };
        await saveProject(updated);
        state.projects = state.projects.map(entry => entry.id === updated.id ? updated : entry);
        closeForm(); renderHome();
      }
    } catch (error) { console.error(error); $('#reviewsFormCopy').textContent = 'No se pudo guardar. Revisá el espacio disponible en este navegador.'; }
  });
  $('#reviewsConfirmClose').addEventListener('click', () => closeConfirmation(false));
  $('#reviewsConfirmCancel').addEventListener('click', () => closeConfirmation(false));
  $('#reviewsConfirmAccept').addEventListener('click', () => closeConfirmation(true));
  $('#reviewsCopyClose').addEventListener('click', () => { $('#reviewsCopyModal').hidden = true; });
  $('#reviewsCopyDone').addEventListener('click', () => { $('#reviewsCopyModal').hidden = true; });
  $('#reviewsCopyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#reviewsCopyInput').value); $('#reviewsCopyDescription').textContent = 'Enlace copiado. El cliente solo verá esta review.'; }
    catch { $('#reviewsCopyInput').focus(); $('#reviewsCopyInput').select(); $('#reviewsCopyDescription').textContent = 'Seleccioná el enlace y copialo con Ctrl+C.'; }
  });
  for (const id of ['#reviewsFormModal', '#reviewsConfirmModal', '#reviewsCopyModal']) $(id).addEventListener('click', event => { if (event.target !== $(id)) return; if (id === '#reviewsFormModal') closeForm(); else if (id === '#reviewsConfirmModal') closeConfirmation(false); else $(id).hidden = true; });
  document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (!$('#reviewsConfirmModal').hidden) closeConfirmation(false); else if (!$('#reviewsFormModal').hidden) closeForm(); else $('#reviewsCopyModal').hidden = true; });
  $('#storyboardsNav').addEventListener('click', () => video.pause());
  document.querySelector('.brand').addEventListener('click', () => video.pause());
  function setLinkFormOpen(open) { $('#reviewsLinkForm').hidden = !open; $('#reviewsLinkBtn').setAttribute('aria-expanded', String(open)); $('#reviewsView .reviews-library').classList.toggle('is-linking', open); if (open) $('#reviewsLinkUrl').focus(); }
  $('#reviewsLinkBtn').addEventListener('click', () => setLinkFormOpen($('#reviewsLinkForm').hidden));
  $('#reviewsEmptyUpload').addEventListener('click', () => setLinkFormOpen(true));
  $('#reviewsLinkCancel').addEventListener('click', () => setLinkFormOpen(false));
  $('#reviewsLinkForm').addEventListener('submit', addDropboxLink);
  $('#reviewsLinkUrl').addEventListener('input', () => { const message = $('#reviewsLinkMessage'); message.classList.remove('is-error'); message.textContent = 'En Dropbox: Compartir → Copiar enlace del archivo. Para verlo acá, debe permitir acceso a cualquiera con el enlace.'; const value = $('#reviewsLinkUrl').value.toLowerCase().split('?')[0]; if (/\.fbx$/.test(value)) $('#reviewsLinkKind').value = 'model'; else if (/\.(?:jpg|jpeg|png|webp|gif|avif|heic|bmp)$/.test(value)) $('#reviewsLinkKind').value = 'image'; else if (/\.(?:mp4|mov|m4v|webm|mkv)$/.test(value)) $('#reviewsLinkKind').value = 'video'; });
  $('#reviewsAddSection').addEventListener('click', () => openSectionForm());
  $('#reviewsSectionCancel').addEventListener('click', closeSectionForm);
  $('#reviewsSectionForm').addEventListener('submit', async event => {
    event.preventDefault(); const version = currentVersion(), project = currentProject(), title = $('#reviewsSectionName').value.trim();
    if (!version || !project || !title) return;
    const sections = [...(version.sections || [])];
    if (sectionEditId) { const item = sections.find(section => section.id === sectionEditId); if (!item) return; item.title = title; }
    else sections.push({ id: crypto.randomUUID(), title });
    const updated = { ...project, updatedAt: new Date().toISOString(), versions: project.versions.map(entry => entry.id === version.id ? { ...entry, sections } : entry) };
    try { await saveProject(updated); state.projects = state.projects.map(entry => entry.id === project.id ? updated : entry); closeSectionForm(); renderList(); }
    catch (error) { console.error(error); showStatus('No se pudo guardar la sección.'); }
  });
  $('#reviewsList').addEventListener('dragstart', event => { const file = event.target.closest('.reviews-file[data-record-id]'); if (!file || !currentVersion()) return; draggedRecordId = file.dataset.recordId; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggedRecordId); file.classList.add('is-dragging'); });
  $('#reviewsList').addEventListener('dragend', () => { draggedRecordId = null; $('#reviewsList').querySelectorAll('.is-dragging,.is-drop-target').forEach(element => element.classList.remove('is-dragging', 'is-drop-target')); });
  $('#reviewsList').addEventListener('dragover', event => { if (!draggedRecordId) return; const section = event.target.closest('[data-section-id]'); if (!section) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; $('#reviewsList').querySelectorAll('.is-drop-target').forEach(element => element.classList.remove('is-drop-target')); section.classList.add('is-drop-target'); });
  $('#reviewsList').addEventListener('drop', event => { if (!draggedRecordId) return; const target = event.target.closest('[data-section-id]'); if (!target) return; event.preventDefault(); const sectionId = target.dataset.sectionId; const beforeId = event.target.closest('[data-record-id]')?.dataset.recordId || null; const recordId = draggedRecordId; draggedRecordId = null; moveRecord(recordId, sectionId, beforeId); });
  $('#reviewsRemoveMedia').addEventListener('click', removeActive);
  $('#reviewsGuestNameForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.shareToken) return;
    const name = $('#reviewsGuestName').value.trim(); if (!name) return;
    $('#reviewsGuestLogin').disabled = true; $('#reviewsGuestNameError').textContent = '';
    try {
      const user = await (await cloud()).guestIdentity();
      state.guestUid = user.uid; state.guestName = name;
      sessionStorage.setItem(`gb-review-guest:${state.shareToken}`, name);
      applyReviewPermissions();
    } catch (error) {
      console.error('Guest sign-in failed', error);
      $('#reviewsGuestNameError').textContent = 'No se pudo habilitar el comentario. Verificá que el acceso de invitado esté activo e intentá de nuevo.';
    } finally { $('#reviewsGuestLogin').disabled = false; }
  });
  window.addEventListener('studio-auth-change', () => {
    $('#reviewsAdminBtn').hidden = window.STUDIO_ROLE !== 'admin';
    $('#reviewsNav').hidden = !canReview('reviewsView');
    $('#dashboardReviewsBtn').hidden = !canReview('reviewsView');
    if (!window.STUDIO_SIGNED_IN) $('#reviewsAdminModal').hidden = true;
    if (sharedReview && window.STUDIO_SIGNED_IN) {
      const existing = state.records.find(record => !record.ephemeral && record.source === 'dropbox' && record.sourceUrl === sharedReview.sourceUrl);
      if (existing && state.active?.id !== existing.id) selectRecord(existing.id);
    }
    if (window.STUDIO_SIGNED_IN && window.STUDIO_ROLE !== 'admin' && !isGuestReview() && window.STUDIO_USER?.uid !== hydratedUserUid) {
      state.projects = []; state.records = []; state.projectId = null; state.versionId = null; state.active = null;
    }
    applyReviewPermissions();
    if (!$('#reviewsHome').hidden && canReview('reviewsView')) renderHome();
    if (window.STUDIO_SIGNED_IN && canReview('reviewsView') && !isGuestReview() && window.STUDIO_USER?.uid !== hydratedUserUid) {
      hydratedUserUid = window.STUDIO_USER.uid;
      Promise.resolve(initialized).then(async () => {
        if (window.STUDIO_USER?.uid !== hydratedUserUid || !canReview('reviewsView')) return;
        if (window.STUDIO_ROLE !== 'admin') { state.projects = []; state.records = []; state.projectId = null; state.versionId = null; state.active = null; }
        const api = await cloud();
        const [remoteProjects, remoteFiles] = await Promise.all([api.listStaffProjects(), api.listStaffFiles()]);
        if (window.STUDIO_USER?.uid !== hydratedUserUid || !canReview('reviewsView')) return;
        const remoteProjectIds = new Set(remoteProjects.map(project => project.id));
        const remoteFileIds = new Set(remoteFiles.map(record => record.id));
        // Only the administrator imports pre-cloud browser data; other accounts see the shared library.
        const importedProjects = window.STUDIO_ROLE === 'admin' ? state.projects.filter(project => !remoteProjectIds.has(project.id)) : [];
        for (const project of importedProjects) await api.saveStaffProject(project);
        const knownProjects = new Set([...remoteProjects, ...importedProjects].map(project => project.id));
        const importedFiles = window.STUDIO_ROLE === 'admin' ? state.records.filter(record => record.source === 'dropbox' && knownProjects.has(record.projectId) && !remoteFileIds.has(record.id)) : [];
        for (const record of importedFiles) await api.saveStaffFile(record);
        state.projects = [...remoteProjects, ...importedProjects];
        state.records = [...remoteFiles, ...importedFiles];
        const shares = await api.listSharedReviews();
        if (window.STUDIO_USER?.uid !== hydratedUserUid || !canReview('reviewsView')) return;
        for (const share of shares) {
          let project = state.projects.find(entry => entry.id === share.projectId);
          const version = { id: share.versionId, title: share.versionTitle, category: share.category,
            sections: share.sections || [], shareToken: share.token, createdAt: share.updatedAt, updatedAt: share.updatedAt };
          if (project) {
            project = { ...project, title: share.projectTitle, client: share.client, agency: share.agency, director: share.director,
              versions: project.versions.some(entry => entry.id === version.id) ? project.versions.map(entry => entry.id === version.id ? { ...entry, ...version } : entry) : [...project.versions, version] };
            state.projects = state.projects.map(entry => entry.id === project.id ? project : entry);
          } else state.projects.push({ id: share.projectId, title: share.projectTitle, client: share.client, agency: share.agency,
            director: share.director, createdAt: share.updatedAt, updatedAt: share.updatedAt, versions: [version] });
          for (const file of share.files) {
            const index = state.records.findIndex(record => record.id === file.id);
            if (index >= 0) state.records[index] = { ...state.records[index], ...file, comments: state.records[index].comments || [], projectId: share.projectId, versionId: share.versionId };
            else state.records.push({ ...file, projectId: share.projectId, versionId: share.versionId });
          }
        }
        if (state.active) state.active = state.records.find(record => record.id === state.active.id) || state.active;
        if (!$('#reviewsHome').hidden) renderHome();
      }).catch(error => { hydratedUserUid = null; console.error('Could not load shared reviews', error); });
    } else if (!window.STUDIO_SIGNED_IN || !canReview('reviewsView')) hydratedUserUid = null;
  });
  $('#reviewsShareBtn').addEventListener('click', () => shareVersion());
  $('#reviewsInBtn').addEventListener('click', () => setRangePoint('in'));
  $('#reviewsOutBtn').addEventListener('click', () => setRangePoint('out'));
  $('#reviewsClearRange').addEventListener('click', () => { if (!isVideo()) return; state.active.inPoint = null; state.active.outPoint = null; renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsTimelineMode').addEventListener('change', event => { if (!isVideo()) return; state.active.timelineMode = event.target.value === 'frames' ? 'frames' : 'time'; renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsPrevFrame').addEventListener('click', () => stepFrame(-1));
  $('#reviewsNextFrame').addEventListener('click', () => stepFrame(1));
  $('#reviewsFrameJump').addEventListener('change', event => { if (!isVideo()) return; seekFrame(Number(event.target.value) - firstFrame()); });
  $('#reviewsFps').addEventListener('change', event => { if (!isVideo()) return; state.active.fps = Number(event.target.value); renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsFrameStart').addEventListener('change', event => { if (!isVideo()) return; state.active.frameStart = Math.max(0, Math.min(9999999, Math.round(Number(event.target.value) || 0))); renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsFitBtn').addEventListener('click', resetView);
  $('#reviewsScreenshotBtn').addEventListener('click', screenshot);
  $('#reviewsDownloadBtn').addEventListener('click', downloadMp4);
  $('#reviewsFullscreenBtn').addEventListener('click', toggleFullscreen);
  $('#reviewsHudBtn').addEventListener('click', toggleHud);
  $('#reviewsHudRestore').addEventListener('click', toggleHud);
  document.addEventListener('fullscreenchange', () => { $('#reviewsFullscreenBtn').textContent = document.fullscreenElement ? 'F · Salir de pantalla completa' : 'F · Pantalla completa'; requestAnimationFrame(fitSurface); });
  document.addEventListener('dragover', event => { if (!$('#reviewsView').hidden && event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => { if (!$('#reviewsView').hidden && event.dataTransfer?.files?.length) { event.preventDefault(); showStatus('En Reviews solo podés vincular archivos ya compartidos desde Dropbox.'); } });
  $('#reviewsStage').addEventListener('wheel', event => { if (!state.active || state.active.kind === 'model') return; event.preventDefault(); zoomAt(Math.exp(-event.deltaY * .002), event.clientX, event.clientY); }, { passive: false });
  $('#reviewsStage').addEventListener('pointerdown', event => { if (!state.zHeld || !state.active || event.button !== 0) return; event.preventDefault(); state.zoomPointer = { id: event.pointerId, y: event.clientY, scale: state.view.scale, moved: false }; $('#reviewsStage').setPointerCapture(event.pointerId); });
  $('#reviewsStage').addEventListener('pointermove', event => { const drag = state.zoomPointer; if (!drag || drag.id !== event.pointerId) return; if (Math.abs(event.clientY - drag.y) > 3) drag.moved = true; if (drag.moved) zoomAt(Math.exp((drag.y - event.clientY) * .012) * drag.scale / state.view.scale, event.clientX, event.clientY); });
  const endZoom = event => { const drag = state.zoomPointer; if (!drag || drag.id !== event.pointerId) return; if (!drag.moved && event.type === 'pointerup') zoomAt(1.5, event.clientX, event.clientY); state.zoomPointer = null; if ($('#reviewsStage').hasPointerCapture(event.pointerId)) $('#reviewsStage').releasePointerCapture(event.pointerId); };
  $('#reviewsStage').addEventListener('pointerup', endZoom); $('#reviewsStage').addEventListener('pointercancel', endZoom);
  document.addEventListener('keydown', event => {
    if ($('#reviewsView').hidden || isEditingText(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() === 'z') { state.zHeld = true; $('#reviewsStage').classList.add('is-zooming'); event.preventDefault(); return; }
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'i', 'o', 'f', 'q', 'h'].includes(key)) event.preventDefault(); else return;
    if (key === 'arrowleft') stepFrame(-1);
    else if (key === 'arrowright') stepFrame(1);
    else if (key === 'arrowup') jumpNote(-1);
    else if (key === 'arrowdown') jumpNote(1);
    else if (key === 'home' && isVideo()) video.currentTime = 0;
    else if (key === 'end' && isVideo() && Number.isFinite(video.duration)) video.currentTime = video.duration;
    else if (key === 'i') setRangePoint('in');
    else if (key === 'o') setRangePoint('out');
    else if (key === 'f') toggleFullscreen();
    else if (key === 'q') toggleHud();
    else if (key === 'h') resetView();
  });
  document.addEventListener('keyup', event => { if (event.key.toLowerCase() === 'z') { state.zHeld = false; $('#reviewsStage').classList.remove('is-zooming'); } });
  window.addEventListener('blur', () => { state.zHeld = false; $('#reviewsStage').classList.remove('is-zooming'); });
  function togglePlayback() { if (!video.paused) { video.pause(); return; } if (Number.isFinite(state.active?.inPoint) && (currentTime() < state.active.inPoint || (Number.isFinite(state.active.outPoint) && currentTime() >= state.active.outPoint))) video.currentTime = state.active.inPoint; video.play().catch(() => showStatus('Este navegador no puede reproducir el formato del video.')); }
  $('#reviewsPlayBtn').addEventListener('click', togglePlayback);
  $('#reviewsMuteBtn').addEventListener('click', () => { video.muted = !video.muted; updateClock(); });
  video.addEventListener('click', () => { if (state.drawing || state.zHeld) return; togglePlayback(); });
  $('#reviewsSeek').addEventListener('input', event => { if (!Number.isFinite(video.duration)) return; if (frameMode()) seekFrame(Number(event.target.value)); else video.currentTime = video.duration * Number(event.target.value) / 1000; state.activeCommentId = null; redraw(); updateClock(); renderCommentList(); });
  $('#reviewsSeek').addEventListener('change', event => { if (frameMode() && Number.isFinite(video.duration)) seekFrame(Number(event.target.value)); });
  video.addEventListener('loadedmetadata', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((video.videoWidth || 16) / (video.videoHeight || 9))); renderPlaybackSettings(); renderMarkers(); fitSurface(); });
  image.addEventListener('load', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((image.naturalWidth || 16) / (image.naturalHeight || 9))); fitSurface(); });
  video.addEventListener('timeupdate', () => { if (!video.paused && Number.isFinite(state.active?.outPoint) && currentTime() >= state.active.outPoint) { video.pause(); video.currentTime = state.active.outPoint; } updateClock(); });
  video.addEventListener('play', () => { state.activeCommentId = null; state.scratch = []; state.sketchMode = false; state.drawing = false; canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false'); redraw(); renderCommentList(); updateClock(); });
  video.addEventListener('pause', updateClock);
  const mediaError = () => { if (state.active?.source === 'dropbox') { $('#reviewsMediaError').hidden = false; showStatus('No se pudo abrir el enlace de Dropbox. Revisá el acceso y el formato del archivo.'); } else showStatus('El formato no se puede reproducir en este navegador. Probá con MP4 (H.264), WebM o una foto compatible.'); };
  video.addEventListener('error', mediaError);
  image.addEventListener('error', mediaError);
  function syncDrawingControls() {
    canvas.classList.toggle('is-drawing', state.drawing);
    $('#reviewsDrawBtn').classList.toggle('is-active', state.drawing && !state.sketchMode);
    $('#reviewsDrawBtn').setAttribute('aria-pressed', String(state.drawing && !state.sketchMode));
    $('#reviewsSketchBtn').classList.toggle('is-active', state.sketchMode);
    $('#reviewsSketchBtn').setAttribute('aria-pressed', String(state.sketchMode));
  }
  function closeToolMenu() { $('#reviewsToolMenu').hidden = true; $('#reviewsToolPicker').setAttribute('aria-expanded', 'false'); }
  function positionToolMenu() {
    const menu = $('#reviewsToolMenu');
    if (menu.hidden) return;
    menu.style.transform = '';
    const rect = menu.getBoundingClientRect();
    const shift = rect.left < 12 ? 12 - rect.left : rect.right > window.innerWidth - 12 ? window.innerWidth - 12 - rect.right : 0;
    menu.style.transform = `translateX(${shift}px)`;
  }
  $('#reviewsToolPicker').addEventListener('click', () => {
    const menu = $('#reviewsToolMenu'); menu.hidden = !menu.hidden;
    $('#reviewsToolPicker').setAttribute('aria-expanded', String(!menu.hidden));
    positionToolMenu();
  });
  window.addEventListener('resize', positionToolMenu);
  $('#reviewsToolMenu').addEventListener('click', event => {
    const button = event.target.closest('[data-review-tool]');
    if (!button || !state.active) return;
    state.tool = button.dataset.reviewTool;
    const label = button.lastChild.textContent.trim();
    $('#reviewsToolPicker').firstChild.textContent = `${button.querySelector('span').textContent} ${label} `;
    $('#reviewsToolPicker').setAttribute('aria-label', `Herramienta: ${label}`);
    document.querySelectorAll('[data-review-tool]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    closeToolMenu(); video.pause(); state.activeCommentId = null;
    state.drawing = true; syncDrawingControls(); redraw();
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.reviews-tool-picker')) closeToolMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeToolMenu(); });
  $('#reviewsDrawBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.drawing = state.sketchMode || !state.drawing; state.sketchMode = false; syncDrawingControls(); redraw(); });
  $('#reviewsSketchBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.sketchMode = !state.sketchMode; state.drawing = state.sketchMode; syncDrawingControls(); redraw(); });
  $('#reviewsUndoBtn').addEventListener('click', () => { (state.sketchMode ? state.scratch : state.draft).pop(); redraw(); });
  $('#reviewsClearBtn').addEventListener('click', clearAnnotation);
  canvas.addEventListener('pointerdown', event => { if (!state.drawing || !state.active || state.zHeld || event.button !== 0) return; event.preventDefault(); state.activeCommentId = null; state.pointerId = event.pointerId; canvas.setPointerCapture(event.pointerId); (state.sketchMode ? state.scratch : state.draft).push({ tool: state.tool, color: $('#reviewsColor').value, points: [pointerPoint(event)] }); redraw(); });
  canvas.addEventListener('pointermove', event => {
    const strokes = state.sketchMode ? state.scratch : state.draft;
    if (state.pointerId !== event.pointerId || !strokes.length) return;
    const stroke = strokes.at(-1), point = shapePoint(stroke.points[0], pointerPoint(event), stroke.tool);
    if (['line', 'arrow', 'rect', 'square', 'circle', 'ellipse'].includes(stroke.tool)) { stroke.points[1] = point; redraw(); return; }
    const last = stroke.points.at(-1);
    if (Math.hypot((point[0] - last[0]) * canvas.clientWidth, (point[1] - last[1]) * canvas.clientHeight) > 2) { stroke.points.push(point); redraw(); }
  });
  const endStroke = event => { if (state.pointerId !== event.pointerId) return; state.pointerId = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);
  $('#reviewsCommentForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.active || state.saving || !canComment()) return;
    const text = $('#reviewsCommentText').value.trim(); if (!text && (!state.draft.length || state.sketchMode)) { $('#reviewsCommentText').focus(); return; }
    const comment = { id: crypto.randomUUID(), text, time: currentTime(), strokes: state.sketchMode ? [] : structuredClone(state.draft), resolved: false, createdAt: new Date().toISOString() };
    const token = state.shareToken || currentVersion()?.shareToken;
    state.saving = true; $('#reviewsCommentForm button[type=submit]').disabled = true;
    const wasEphemeral = Boolean(state.active.ephemeral);
    if (wasEphemeral) delete state.active.ephemeral;
    state.active.comments.push(comment); state.active.updatedAt = comment.createdAt;
    try {
      if (token) {
        const author = isGuestReview() ? state.guestName || window.STUDIO_USER?.displayName || 'Invitado' : window.STUDIO_USER?.displayName || window.STUDIO_USER?.email || 'Equipo';
        await (await cloud()).addSharedComment(token, state.active.id, comment, author);
      } else await saveRecord(state.active);
      $('#reviewsCommentText').value = ''; state.draft = []; if (!state.sketchMode) { state.activeCommentId = comment.id; state.drawing = false; canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); }
      renderCommentList(); renderMarkers(); renderList(); redraw();
    } catch (error) { state.active.comments.pop(); if (wasEphemeral) state.active.ephemeral = true; showStatus(token ? 'No se pudo compartir el comentario. Revisá tu conexión o los permisos de la review.' : 'No se pudo guardar el comentario. Revisá el espacio disponible.'); console.error(error); }
    finally { state.saving = false; $('#reviewsCommentForm button[type=submit]').disabled = false; }
  });
  new ResizeObserver(resizeCanvas).observe($('#reviewsMediaSurface'));
  new ResizeObserver(fitSurface).observe($('#reviewsStage'));
  initialized = initialize();
})();

/* GB Studio Reviews: local media, time-linked feedback and frame annotations. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const DB_NAME = 'gb-studio-reviews-v1';
  const ACTIVE_KEY = 'gb-studio-reviews-active-v1';
  const DEFAULT_COVER_COLOR = '#ff6b2b';
  const HOME_VIEW_KEY = 'gb-studio-reviews-home-view';
  const HOME_SORT_KEY = 'gb-studio-reviews-home-sort';
  let homeView = localStorage.getItem(HOME_VIEW_KEY) === 'list' ? 'list' : 'grid';
  let homeSort = ['recent', 'name', 'client'].includes(localStorage.getItem(HOME_SORT_KEY)) ? localStorage.getItem(HOME_SORT_KEY) : 'recent';
  let homeClientFilter = 'all';
  const state = { records: [], projects: [], projectId: null, versionId: null, active: null, mediaUrl: null, mediaCorsFallback: false, model: null, drawing: false, sketchMode: false, tool: 'pen', draft: [], scratch: [], undoHistory: [], activeCommentId: null, editingCommentId: null, editingText: '', editingSaving: false, pointerId: null, shapeRawPoint: null, saving: false, view: { scale: 1, x: 0, y: 0 }, zHeld: false, zoomPointer: null, panPointer: null, shareToken: null, guestName: '', guestUid: null, stopComments: null };
  const video = $('#reviewsVideo');
  const image = $('#reviewsImage');
  const canvas = $('#reviewsCanvas');
  const ctx = canvas.getContext('2d');
  let databasePromise;
  let initialized;
  let hydratedUserUid = null;
  let reviewsLibraryReady = false;
  let reviewsLibraryError = '';
  let videoProbe = null;

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
  const cloud = () => import('./reviews-cloud.js?v=11');
  const isClient = () => window.STUDIO_ROLE !== 'admin' && (window.STUDIO_MIRA_ROLE === 'client' || window.STUDIO_PERMISSIONS?.reviewsClient === true);
  const canReview = key => window.STUDIO_ROLE === 'admin' || (!(isClient() && ['reviewsView', 'reviewsCreate', 'reviewsEdit', 'reviewsShare'].includes(key)) && window.STUDIO_PERMISSIONS?.[key] === true);
  const canEnterReviews = () => canReview('reviewsView') || canReview('reviewsClient');
  async function saveRecord(record) {
    if (!canReview('reviewsEdit')) throw new Error('No tenés permiso para editar Mira.');
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
    url.hostname = 'dl.dropboxusercontent.com';
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
  const sharedAlias = new URLSearchParams(location.search).get('link');
  const sharedParams = new URLSearchParams(location.hash.slice(1));
  const sharedToken = sharedParams.get('share');
  const sharedFileId = sharedParams.get('file');
  if (sharedReview || sharedToken || sharedAlias !== null) document.body.classList.add('public-review');
  if (sharedReview) document.body.classList.add('legacy-public-review');
  if (sharedToken) { state.shareToken = sharedToken; state.guestName = sessionStorage.getItem(`gb-review-guest:${sharedToken}`) || ''; }
  let formMode = null;
  let coverDraft = { image: '', color: DEFAULT_COVER_COLOR };
  let coverRequestId = 0;
  let confirmResolve = null;
  let sectionEditId = null;
  let draggedRecordId = null;
  function closeForm() { $('#reviewsFormModal').hidden = true; formMode = null; coverRequestId += 1; $('#reviewsFormSubmit').disabled = false; }
  function selectedCoverType() { return document.querySelector('input[name="reviewsCoverType"]:checked')?.value || 'color'; }
  function updateCoverPreview() {
    const type = selectedCoverType();
    const preview = $('#reviewsCoverPreview');
    const image = $('#reviewsCoverPreviewImage');
    preview.className = `reviews-cover-preview is-${type}`;
    preview.style.backgroundColor = type === 'color' ? coverDraft.color : '';
    image.hidden = type !== 'image' || !coverDraft.image;
    if (!image.hidden) image.src = coverDraft.image;
    else image.removeAttribute('src');
    $('#reviewsCoverImageRow').hidden = type !== 'image';
    $('#reviewsCoverColorRow').hidden = type !== 'color';
    let preset = false;
    document.querySelectorAll('[data-cover-color]').forEach(button => {
      const selected = button.dataset.coverColor === coverDraft.color.toLowerCase();
      button.setAttribute('aria-pressed', String(selected));
      if (selected) preset = true;
    });
    $('#reviewsCoverColor').value = coverDraft.color;
    $('.reviews-cover-custom').classList.toggle('is-selected', type === 'color' && !preset);
  }
  async function prepareCoverImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Elegí un archivo de imagen.');
    if (file.size > 12 * 1024 * 1024) throw new Error('La imagen debe pesar menos de 12 MB.');
    if (typeof createImageBitmap !== 'function') throw new Error('Este navegador no puede preparar imágenes. Probá con Chrome o Edge.');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width > 12000 || bitmap.height > 12000) throw new Error('La imagen es demasiado grande. Elegí otra portada.');
      for (const [width, quality] of [[1000, .8], [800, .68], [640, .58]]) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * .6);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo preparar la imagen en este navegador.');
        const cropWidth = Math.min(bitmap.width, bitmap.height / .6);
        const cropHeight = cropWidth * .6;
        context.drawImage(bitmap, (bitmap.width - cropWidth) / 2, (bitmap.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/jpeg', quality);
        if (result.length <= 280000) return result;
      }
      throw new Error('No se pudo reducir la imagen. Elegí una más liviana.');
    } finally { bitmap.close(); }
  }
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
    if (project) {
      coverDraft = { image: /^data:image\/jpeg;base64,/.test(entity?.coverImage || '') ? entity.coverImage : '', color: /^#[0-9a-f]{6}$/i.test(entity?.coverColor || '') ? entity.coverColor : DEFAULT_COVER_COLOR };
      const coverType = ['image', 'color'].includes(entity?.coverType) ? entity.coverType : 'color';
      document.querySelector(`input[name="reviewsCoverType"][value="${coverType}"]`).checked = true;
      $('#reviewsCoverColor').value = coverDraft.color;
      $('#reviewsCoverFile').value = '';
      $('#reviewsCoverMessage').textContent = '';
      updateCoverPreview();
    }
    $('#reviewsFormTitle').textContent = `${entity ? 'Editar' : project ? 'Nuevo' : 'Nueva'} ${project ? 'proyecto' : 'review'}`;
    $('#reviewsFormCopy').textContent = project ? 'El proyecto reúne distintas instancias de feedback, cada una con sus propios archivos y comentarios.' : 'Una review independiente para montaje, VFX, cliente u otra etapa.';
    $('#reviewsFormSubmit').textContent = entity ? 'Guardar cambios →' : project ? 'Crear proyecto →' : 'Crear review →';
    $('#reviewsFormModal').hidden = false;
    $('#reviewsEntityTitle').focus();
  }
  function cardAction(label, title, handler) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', title); button.addEventListener('click', handler); return button; }
  function renderHome() {
    const waitingForProjects = !reviewsLibraryReady && !isGuestReview();
    $('#reviewsHome').classList.toggle('is-loading', waitingForProjects);
    $('#reviewsHomeLoading').hidden = !waitingForProjects;
    if (waitingForProjects) {
      $('#reviewsHomeLoading').textContent = reviewsLibraryError || (isClient() ? 'Cargando tus reviews…' : 'Cargando proyectos de Mira…');
      $('#reviewsHomeEmpty').hidden = true;
      $('#reviewsHomeGrid').replaceChildren();
      $('#reviewsCreateProject').hidden = true;
      $('#reviewsCreateVersion').hidden = true;
      $('#reviewsEmptyCreate').hidden = true;
      $('#reviewsHomeControls').hidden = true;
      $('#reviewsProjectContext').hidden = true;
      $('#reviewsHomeTitle').textContent = isClient() ? 'Tus reviews' : 'Mira tus proyectos';
      return;
    }
    const clientOnly = isClient();
    const project = clientOnly ? null : currentProject();
    const grid = $('#reviewsHomeGrid'); grid.replaceChildren();
    $('#reviewsHomeTitle').textContent = clientOnly ? 'Tus reviews' : project ? project.title : 'Mira tus proyectos';
    $('#reviewsHomeCopy').textContent = clientOnly ? 'Estas son las reviews que el equipo compartió con vos.' : project ? 'Elegí una review o creá otra para una etapa distinta. Cada review tiene sus archivos y comentarios.' : 'Organizá las revisiones por proyecto y separá el feedback de montaje, VFX y cliente.';
    $('#reviewsCreateProject').hidden = Boolean(project) || !canReview('reviewsCreate');
    $('#reviewsCreateVersion').hidden = !canReview('reviewsCreate');
    $('#reviewsProjectContext').hidden = !project;
    $('#reviewsHomeSectionLabel').textContent = clientOnly ? 'REVIEWS COMPARTIDAS' : project ? 'REVISIONES DE ESTE PROYECTO' : 'PROYECTOS';
    const entries = clientOnly ? state.projects.flatMap(item => item.versions.map(version => ({ ...version, projectId: item.id, projectTitle: item.title }))) : project ? [...project.versions] : [...state.projects];
    const organizingProjects = !clientOnly && !project;
    $('#reviewsHomeControls').hidden = !organizingProjects;
    grid.classList.toggle('is-list-view', organizingProjects && homeView === 'list');
    $('#reviewsHomeGridView').setAttribute('aria-pressed', String(homeView === 'grid'));
    $('#reviewsHomeListView').setAttribute('aria-pressed', String(homeView === 'list'));
    $('#reviewsHomeSort').value = homeSort;
    if (organizingProjects) {
      const clients = [...new Set(entries.map(entry => entry.client?.trim() || ''))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
      const filter = $('#reviewsHomeClientFilter'); filter.replaceChildren(new Option('Todos', 'all'));
      for (const client of clients) filter.add(new Option(client || 'Sin cliente', client || '__none__'));
      if (homeClientFilter !== 'all' && !clients.some(client => (client || '__none__') === homeClientFilter)) homeClientFilter = 'all';
      filter.value = homeClientFilter;
    }
    const visibleEntries = organizingProjects && homeClientFilter !== 'all' ? entries.filter(entry => (entry.client?.trim() || '__none__') === homeClientFilter) : entries;
    const compareName = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
    visibleEntries.sort((a, b) => organizingProjects && homeSort === 'name' ? compareName(a.title, b.title)
      : organizingProjects && homeSort === 'client' ? compareName(a.client?.trim() || '', b.client?.trim() || '') || compareName(a.title, b.title)
        : (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#reviewsHomeCount').textContent = organizingProjects && homeClientFilter !== 'all' ? `${visibleEntries.length} de ${entries.length} proyectos`
      : `${visibleEntries.length} ${clientOnly || project ? visibleEntries.length === 1 ? 'review' : 'reviews' : visibleEntries.length === 1 ? 'proyecto' : 'proyectos'}`;
    $('#reviewsHomeEmpty').hidden = visibleEntries.length > 0;
    $('#reviewsEmptyCreate').textContent = project ? '＋ Crear review' : '＋ Crear proyecto';
    $('#reviewsHomeEmpty h2').textContent = organizingProjects && homeClientFilter !== 'all' ? 'No hay proyectos de este cliente.' : clientOnly ? 'Todavía no hay reviews asignadas.' : project ? 'Todavía no hay reviews.' : 'Un lugar para cada devolución.';
    $('#reviewsHomeEmpty p').textContent = organizingProjects && homeClientFilter !== 'all' ? 'Elegí otro cliente o volvé a mostrar todos los proyectos.' : clientOnly ? 'Cuando el equipo te asigne una review, la vas a encontrar acá.' : project ? 'Creá una review de montaje, VFX o cliente para empezar a cargar material.' : 'Creá un proyecto y después abrí reviews distintas para montaje, VFX o cliente.';
    $('#reviewsEmptyCreate').hidden = !canReview('reviewsCreate') || organizingProjects && homeClientFilter !== 'all';
    if (project) $('#reviewsProjectMeta').textContent = [project.client && `CLIENTE · ${project.client}`, project.agency && `AGENCIA · ${project.agency}`, project.director && `DIRECTOR · ${project.director}`, 'GRAN BERTA FILMS'].filter(Boolean).join('  /  ');
    for (const entry of visibleEntries) {
      const card = document.createElement('article'); card.className = 'reviews-home-card';
      const open = document.createElement('button'); open.type = 'button'; open.className = `reviews-home-card-open ${clientOnly || project ? 'is-review-card' : 'is-project-card'}`;
      if (!project && !clientOnly) {
        const cover = document.createElement('span'); cover.className = 'reviews-home-card-cover'; cover.setAttribute('aria-hidden', 'true');
        if (entry.coverType === 'image' && /^data:image\/jpeg;base64,/.test(entry.coverImage || '')) {
          cover.classList.add('is-image');
          const coverImage = document.createElement('img'); coverImage.src = entry.coverImage; coverImage.alt = '';
          cover.append(coverImage);
        } else {
          cover.classList.add('is-color'); cover.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(entry.coverColor || '') ? entry.coverColor : DEFAULT_COVER_COLOR;
        }
        open.append(cover);
      }
      const content = document.createElement('span'); content.className = 'reviews-home-card-content';
      const tag = document.createElement('span'); tag.className = 'reviews-home-card-tag'; tag.textContent = clientOnly ? entry.projectTitle : project ? entry.category.toUpperCase() : (entry.client || 'SIN CLIENTE').toUpperCase();
      const title = document.createElement('strong'); title.textContent = entry.title;
      const count = document.createElement('small'); const records = clientOnly || project ? state.records.filter(record => record.versionId === entry.id) : state.records.filter(record => record.projectId === entry.id);
      count.textContent = clientOnly || project ? `${records.length} archivo${records.length === 1 ? '' : 's'} · ${records.reduce((sum, record) => sum + record.comments.length, 0)} comentarios` : `${entry.versions.length} review${entry.versions.length === 1 ? '' : 's'} · ${records.length} archivos`;
      content.append(tag, title, count); open.append(content);
      open.addEventListener('click', () => { if (clientOnly) { state.projectId = entry.projectId; openVersion(entry.id); } else if (project) openVersion(entry.id); else showReviewsHome(entry.id); });
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
    if (document.documentElement.dataset.studioApp !== 'reviews') return;
    if (document.body.classList.contains('public-review')) return;
    if (document.body.classList.contains('auth-locked')) return;
    if (!canEnterReviews()) return;
    showDashboard();
    stopMedia(); state.active = null; state.projectId = isClient() ? null : projectId; state.versionId = null;
    $('#dashboardView').hidden = true; $('#reviewsHome').hidden = false; $('#reviewsView').hidden = true;
    $('#storyboardsNav').classList.remove('is-active'); $('#reviewsNav').classList.add('is-active');
    $('#breadcrumbTitle').textContent = currentProject()?.title || 'Mira';
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
      const selected = records.find(record => record.id === state.active?.id) || records.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))[0];
      const alias = await (await cloud()).publishReviewAlias(project, version, token, selected, records.length > 1);
      const { buildNamedShareUrl } = await import('./reviews-links.js?v=3');
      const link = buildNamedShareUrl(location.href, alias);
      $('#reviewsCopyInput').value = link;
      $('#reviewsCopyModal').hidden = false;
      $('#reviewsCopyInput').focus(); $('#reviewsCopyInput').select();
      try { await navigator.clipboard.writeText(link); $('#reviewsCopyDescription').textContent = `Enlace copiado. Abre este archivo directamente; el cliente puede ${selected.kind === 'video' ? 'ver y descargar el video' : 'ver la foto'} sin cuenta, o comentar con su nombre o Google.`; }
      catch { $('#reviewsCopyDescription').textContent = 'Copiá el enlace para enviárselo al cliente. Abrirá este archivo directamente, sin entrar al resto de Mira.'; }
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
  function canComment() { return isGuestReview() ? Boolean(state.shareToken && (state.guestName || window.STUDIO_ROLE === 'review_guest')) : canReview('reviewsEdit') || (canReview('reviewsClient') && Boolean(currentVersion()?.shareToken)); }
  function canDeleteComment(comment) {
    if (!isGuestReview() && canReview('reviewsEdit')) return true;
    const uid = window.STUDIO_USER?.uid || state.guestUid;
    return Boolean(canComment() && uid && comment.authorUid === uid);
  }
  function canEditOwnComment(comment) {
    const uid = window.STUDIO_USER?.uid || state.guestUid;
    const shared = state.shareToken || currentVersion()?.shareToken;
    return Boolean(uid && comment.authorUid === uid && (shared ? isGuestReview() || canEnterReviews() : canReview('reviewsEdit')));
  }
  function applyReviewPermissions() {
    const guest = isGuestReview();
    const commenting = canComment();
    $('#reviewsGuestPrompt').hidden = !guest || commenting || !state.shareToken;
    $('#reviewsGuestPromptCopy').textContent = isVideo() ? 'Podés mirar y descargar el video sin iniciar sesión. Para comentar, elegí una opción:' : 'Podés mirar la foto sin iniciar sesión. Para comentar, elegí una opción:';
    const identity = guest ? window.STUDIO_ROLE === 'review_guest' ? window.STUDIO_USER?.displayName || window.STUDIO_USER?.email || 'Google' : state.guestName : '';
    const identityNote = $('#reviewsCommentIdentity');
    identityNote.hidden = !identity;
    identityNote.replaceChildren();
    if (identity) { identityNote.append('Comentando como '); const name = document.createElement('strong'); name.textContent = identity; identityNote.append(name); }
    $('#reviewsCommentForm').hidden = !commenting || !state.active;
    $('#reviewsAnnotationBar').hidden = !state.active;
    $('#reviewsAnnotationBar').classList.toggle('is-readonly', !commenting);
    $('#reviewsZoomValue').hidden = !state.active;
    $('#reviewsRemoveMedia').hidden = guest || !state.active || !canReview('reviewsEdit');
    $('#reviewsLinkBtn').hidden = guest || !canReview('reviewsEdit');
    $('#reviewsAddSection').hidden = guest || !canReview('reviewsEdit');
    $('#reviewsShareBtn').hidden = guest || state.active?.source !== 'dropbox' || !canReview('reviewsShare');
    $('#reviewsScreenshotBtn').hidden = !state.active || state.active.kind === 'model';
    $('#reviewsScreenshotBtn').title = 'Descargar captura PNG';
    $('#reviewsDownloadBtn').hidden = !isVideo();
    $('#reviewsCommentStorageNote').textContent = state.shareToken || currentVersion()?.shareToken ? 'Los comentarios y dibujos de esta review se comparten con quienes tengan el enlace.' : 'Este comentario se guarda solo en este navegador hasta que compartas la review.';
    renderCommentList();
  }
  function isVideo() { return state.active?.kind === 'video'; }
  function currentTime() { return isVideo() ? Math.max(0, video.currentTime || 0) : 0; }
  function showStatus(message) { $('#reviewsCommentContext').textContent = message; }
  function stopMedia() { videoProbe?.controller.abort(); videoProbe = null; video.pause(); video.removeAttribute('src'); video.load(); image.removeAttribute('src'); state.model?.dispose(); state.model = null; if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl); state.mediaUrl = null; }
  function rememberAnnotation(action) { state.undoHistory.push(action); if (state.undoHistory.length > 50) state.undoHistory.shift(); }
  function clearAnnotation() {
    if (state.draft.length || state.scratch.length || visibleStrokes().length) {
      rememberAnnotation({ type: 'clear', draft: structuredClone(state.draft), scratch: structuredClone(state.scratch), activeCommentId: state.activeCommentId, sketchMode: state.sketchMode });
    }
    state.draft = []; state.scratch = []; state.activeCommentId = null; redraw(); renderCommentList();
  }
  function undoAnnotation() {
    const action = state.undoHistory.pop();
    if (action?.type === 'clear') {
      state.draft = action.draft; state.scratch = action.scratch;
      state.activeCommentId = action.activeCommentId; state.sketchMode = action.sketchMode;
      syncDrawingControls(); renderCommentList();
    } else if (action?.type === 'stroke') state[action.mode].pop();
    else (state.sketchMode ? state.scratch : state.draft).pop();
    redraw();
  }
  function fps() { const record = state.active; return record?.fpsSource === 'metadata' && record.fpsMode === 'constant' && Number.isFinite(record.fps) && record.fps > 0 ? record.fps : null; }
  function firstFrame() { return Number.isSafeInteger(state.active?.frameStart) ? state.active.frameStart : 1; }
  function frameIndex() { return fps() ? Math.round(currentTime() * fps()) : 0; }
  function lastFrameIndex() { if (!fps()) return 0; const count = state.active?.videoFrameCount; return Number.isSafeInteger(count) && count > 0 ? count - 1 : Number.isFinite(video.duration) ? Math.max(0, Math.ceil(video.duration * fps()) - 1) : 0; }
  function frameNumber() { return fps() ? firstFrame() + Math.min(frameIndex(), lastFrameIndex()) : null; }
  function frameMode() { return Boolean(fps()) && state.active?.timelineMode === 'frames'; }
  function seekFrame(index) { if (!isVideo() || !fps() || !Number.isFinite(index) || !Number.isFinite(video.duration)) return; video.pause(); video.currentTime = Math.min(video.duration, Math.max(0, Math.min(lastFrameIndex(), Math.round(index))) / fps()); updateClock(); }
  async function detectVideoMetadata(record, source) {
    const probe = videoProbe;
    if (!probe || state.active !== record || probe.controller.signal.aborted) return;
    try {
      const { inspectVideo } = await import('./reviews-video-metadata.js?v=1');
      const metadata = await inspectVideo(source, { signal: probe.controller.signal });
      if (videoProbe !== probe || state.active !== record) return;
      Object.assign(record, metadata);
      probe.status = metadata.fps ? 'ready' : 'unavailable';
      renderPlaybackSettings();
      if (!isGuestReview() && !record.ephemeral && canReview('reviewsEdit')) {
        record.updatedAt = new Date().toISOString();
        await saveRecord(record);
      }
    } catch (error) {
      if (videoProbe !== probe || state.active !== record || error.name === 'AbortError') return;
      if (probe.status === 'ready') { console.warn('Could not save video metadata', error); return; }
      probe.status = 'unavailable'; probe.error = error.message;
      renderPlaybackSettings();
    }
  }
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
  function stopPan() {
    const pointer = state.panPointer;
    if (!pointer) return;
    state.panPointer = null;
    const stage = $('#reviewsStage');
    stage.classList.remove('is-panning');
    if (stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
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
  function shapePoint(start, point, tool, shiftKey = false) {
    if (!['rect', 'ellipse', 'square', 'circle'].includes(tool) || (!shiftKey && tool !== 'square' && tool !== 'circle')) return point;
    const dx = (point[0] - start[0]) * canvas.clientWidth, dy = (point[1] - start[1]) * canvas.clientHeight;
    const side = Math.min(Math.abs(dx), Math.abs(dy));
    return [start[0] + Math.sign(dx) * side / canvas.clientWidth, start[1] + Math.sign(dy) * side / canvas.clientHeight];
  }
  function primarySectionId() {
    const sections = currentVersion()?.sections || [];
    if (sections.some(section => section.id === 'default' && section.isDefault)) return 'default';
    const existing = sections.find(section => section.isDefault && section.id !== 'default')
      || sections.find(section => section.id !== 'default' && section.title?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'ultima version');
    return existing?.id || 'default';
  }
  function sectionDefinitions() {
    const sections = currentVersion()?.sections || [];
    const primary = primarySectionId();
    if (primary !== 'default') return [sections.find(section => section.id === primary), ...sections.filter(section => section.id !== primary && section.id !== 'default')];
    return [{ id: 'default', title: sections.find(section => section.id === 'default')?.title || 'Última versión' }, ...sections.filter(section => section.id !== 'default')];
  }
  function recordSection(record) { return !record.sectionId || record.sectionId === 'default' ? primarySectionId() : record.sectionId; }
  function orderedRecords(sectionId) { return versionRecords().filter(record => recordSection(record) === sectionId).sort((a, b) => (Number.isFinite(a.sortIndex) ? a.sortIndex : -Date.parse(a.createdAt || a.updatedAt)) - (Number.isFinite(b.sortIndex) ? b.sortIndex : -Date.parse(b.createdAt || b.updatedAt))); }
  async function moveRecord(recordId, targetSectionId, beforeId = null) {
    if (isGuestReview() || !canReview('reviewsEdit')) return;
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
    if (id === primarySectionId()) return;
    const destination = sectionDefinitions().find(entry => entry.id === primarySectionId())?.title || 'Última versión';
    if (!await askConfirmation('¿Eliminar esta sección?', `Los archivos de “${section.title}” se moverán a “${destination}”. No se borrarán los archivos ni sus comentarios.`, 'Eliminar sección')) return;
    const project = currentProject();
    const updatedProject = { ...project, versions: project.versions.map(entry => entry.id === version.id ? { ...entry, sections: entry.sections.filter(item => item.id !== id) } : entry) };
    const moved = orderedRecords(id).map((record, index) => ({ ...record, sectionId: primarySectionId(), sortIndex: orderedRecords(primarySectionId()).length + index }));
    try {
      if (version.shareToken) {
        const api = await cloud(); await api.updateShareMetadata(updatedProject, updatedProject.versions.find(entry => entry.id === version.id));
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
      if (!isGuestReview() && canReview('reviewsEdit')) {
        const edit = cardAction('✎', `Renombrar sección ${section.title}`, () => openSectionForm(section));
        heading.append(edit);
        if (section.id !== primarySectionId()) heading.append(cardAction('×', `Eliminar sección ${section.title}`, () => deleteSection(section.id)));
      }
      const files = document.createElement('div'); files.className = 'reviews-section-files'; files.dataset.sectionId = section.id;
      if (!sectionRecords.length) { const empty = document.createElement('p'); empty.className = 'reviews-section-empty'; empty.textContent = records.length ? 'Arrastrá acá un archivo de esta review' : 'Vinculá un archivo de Dropbox'; files.append(empty); }
      for (const record of sectionRecords) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `reviews-file${record.id === state.active?.id ? ' is-active' : ''}`; button.dataset.recordId = record.id; button.draggable = Boolean(currentVersion()) && !isGuestReview() && canReview('reviewsEdit');
        const icon = document.createElement('span'); icon.className = 'reviews-file-icon'; icon.textContent = record.kind === 'video' ? '▶' : record.kind === 'model' ? '◇' : '▧';
        const copy = document.createElement('span'); copy.className = 'reviews-file-copy';
        const name = document.createElement('strong'); name.textContent = record.name;
        copy.append(name);
        if (record.comments.length) { const details = document.createElement('small'); details.textContent = `${record.comments.length} comentario${record.comments.length === 1 ? '' : 's'}`; copy.append(details); }
        button.append(icon, copy); button.addEventListener('click', () => selectRecord(record.id)); files.append(button);
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
      if (canEditOwnComment(comment) || canDeleteComment(comment)) {
        const actions = document.createElement('div'); actions.className = 'reviews-comment-actions';
        if (canEditOwnComment(comment)) {
          const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar'; edit.setAttribute('aria-label', `Editar comentario de ${comment.authorName || 'usuario'}`);
          edit.addEventListener('click', () => startCommentEdit(comment.id)); actions.append(edit);
        }
        if (!isGuestReview() && canReview('reviewsEdit')) {
          const resolve = document.createElement('button'); resolve.type = 'button'; resolve.textContent = comment.resolved ? 'Reabrir' : 'Resolver'; resolve.addEventListener('click', () => updateComment(comment.id, entry => { entry.resolved = !entry.resolved; }));
          actions.append(resolve);
        }
        if (canDeleteComment(comment)) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => updateComment(comment.id, null));
          actions.append(remove);
        }
        card.append(actions);
      }
      if (state.editingCommentId === comment.id && canEditOwnComment(comment)) {
        const form = document.createElement('form'); form.className = 'reviews-comment-edit';
        const field = document.createElement('textarea'); field.maxLength = 5000; field.setAttribute('aria-label', 'Editar tu comentario'); field.value = state.editingText; field.disabled = state.editingSaving;
        field.addEventListener('input', () => { state.editingText = field.value; });
        const buttons = document.createElement('div'); buttons.className = 'reviews-comment-edit-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar'; cancel.disabled = state.editingSaving;
        cancel.addEventListener('click', () => { state.editingCommentId = null; state.editingText = ''; renderCommentList(); });
        const save = document.createElement('button'); save.type = 'submit'; save.textContent = state.editingSaving ? 'Guardando…' : 'Guardar cambios'; save.disabled = state.editingSaving;
        buttons.append(cancel, save); form.append(field, buttons);
        form.addEventListener('submit', event => { event.preventDefault(); void saveOwnComment(comment.id); });
        card.append(form);
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
    if (document.activeElement !== $('#reviewsFrameJump')) $('#reviewsFrameJump').value = fps() ? String(frameNumber()) : '';
    $('#reviewsPlayBtn').textContent = video.paused ? '▶' : '❚❚';
    $('#reviewsPlayBtn').setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
    $('#reviewsMuteBtn').textContent = video.muted ? '×' : '♪';
    $('#reviewsMuteBtn').setAttribute('aria-label', video.muted ? 'Activar sonido' : 'Silenciar');
    $('#reviewsFrameNumber').textContent = fps() ? `Fotograma ${frameNumber()}` : state.active?.fpsMode === 'variable' ? 'FPS variable · regla en tiempo' : 'Fotograma —';
  }
  function renderPlaybackSettings() {
    const record = state.active;
    const rate = Number(record?.fps), hasRate = Number.isFinite(rate) && rate > 0;
    const label = hasRate ? String(Number(rate.toFixed(3))) : 'Sin detectar';
    const output = $('#reviewsFps');
    output.textContent = videoProbe?.status === 'loading' ? 'Detectando…' : record?.fpsMode === 'variable' ? `Variable${hasRate ? ` · ${label} promedio` : ''}` : hasRate ? `${label}${record.fpsMode === 'unknown' ? ' · modo sin confirmar' : ''}` : label;
    output.dataset.status = videoProbe?.status || 'unavailable';
    output.title = videoProbe?.error || (record?.fpsMode === 'variable' ? 'El video tiene FPS variable. Un promedio no permite numerar cada fotograma; usá la regla en tiempo.' : hasRate ? `FPS leídos del archivo${record.fpsNumerator && record.fpsDenominator ? `: ${record.fpsNumerator}/${record.fpsDenominator}` : ''}.` : 'No se pudieron leer los FPS del archivo. La reproducción y los comentarios por tiempo siguen disponibles.');
    const hasFrames = Boolean(fps());
    $('#reviewsTimelineMode').querySelector('option[value="frames"]').disabled = !hasFrames;
    for (const id of ['#reviewsPrevFrame', '#reviewsNextFrame', '#reviewsFrameJump', '#reviewsFrameStart']) $(id).disabled = !hasFrames;
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
    stopPan();
    state.stopComments?.(); state.stopComments = null;
    stopMedia(); state.active = record; state.mediaCorsFallback = false; state.draft = []; state.scratch = []; state.undoHistory = []; state.sketchMode = false; state.activeCommentId = null; state.editingCommentId = null; state.editingText = ''; state.drawing = false; state.pointerId = null; state.shapeRawPoint = null; resetView();
    if (record.kind === 'video') {
      // Re-read the original: older versions stored an invented 24, and a Dropbox
      // file can be replaced while keeping its URL. Never trust a stale default.
      Object.assign(record, { fps: null, fpsSource: null, fpsMode: 'unknown', fpsNumerator: null, fpsDenominator: null, videoFrameCount: null, videoDuration: null, fpsMetadataVersion: null });
      videoProbe = { controller: new AbortController(), status: 'loading' };
    }
    localStorage.setItem(ACTIVE_KEY, id);
    renderList(); renderCommentList();
    $('#reviewsMediaTitle').textContent = record.name;
    $('#reviewsMediaTitle').title = record.name;
    $('#reviewsMediaSurface').style.setProperty('--review-aspect', String(16 / 9));
    $('#reviewsMediaError').hidden = true;
    $('#reviewsShareBtn').hidden = record.source !== 'dropbox' || isGuestReview() || !canReview('reviewsShare');
    $('#reviewsEmpty').hidden = true; $('#reviewsMediaSurface').hidden = false;
    $('#reviewsAnnotationBar').hidden = false; $('#reviewsCommentForm').hidden = false; $('#reviewsRemoveMedia').hidden = false;
    $('#reviewsZoomValue').hidden = false; $('#reviewsPlaybackTools').hidden = record.kind !== 'video'; $('#reviewsScreenshotBtn').hidden = record.kind === 'model'; $('#reviewsDownloadBtn').hidden = !isVideo();
    $('#reviewsTimeline').hidden = record.kind !== 'video';
    $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false');
    canvas.classList.remove('is-drawing');
    showStatus(record.kind === 'video' ? 'Los comentarios se guardan en el segundo actual.' : record.kind === 'model' ? 'Arrastrá para orbitar el modelo. Los comentarios no cambian el FBX.' : 'Los comentarios se guardan sobre esta foto.');
    image.hidden = record.kind !== 'image'; video.hidden = record.kind !== 'video'; $('#reviewsModel').hidden = record.kind !== 'model'; canvas.hidden = record.kind === 'model';
    image.crossOrigin = 'anonymous'; video.crossOrigin = 'anonymous';
    renderPlaybackSettings(); requestAnimationFrame(fitSurface);
    applyReviewPermissions();
    const token = state.shareToken || currentVersion()?.shareToken;
    if (token) {
      const api = await cloud();
      if (state.active !== record) return;
      state.stopComments = api.watchComments(token, id, comments => {
        if (state.active?.id !== id) return;
        state.active.comments = comments;
        if (state.activeCommentId && !comments.some(comment => comment.id === state.activeCommentId)) state.activeCommentId = null;
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
        if (record.kind === 'video') {
          video.src = link.streamUrl;
          const fallback = new URL(link.streamUrl); fallback.hostname = 'www.dropbox.com';
          void detectVideoMetadata(record, { urls: [link.streamUrl, fallback.href] });
        } else image.src = link.streamUrl;
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
      if (record.kind === 'video') { video.src = state.mediaUrl; void detectVideoMetadata(record, { blob }); } else image.src = state.mediaUrl;
      updateClock(); renderMarkers(); requestAnimationFrame(resizeCanvas);
    } catch (error) { showStatus(error.message || 'No se pudo abrir el archivo'); $('#reviewsMediaError').hidden = false; console.error(error); }
  }
  function selectComment(id) {
    const comment = state.active?.comments.find(entry => entry.id === id); if (!comment) return;
    video.pause();
    if (isVideo()) video.currentTime = Math.min(comment.time, Number.isFinite(video.duration) ? video.duration : comment.time);
    state.activeCommentId = id; state.draft = []; state.scratch = []; state.undoHistory = []; state.pointerId = null; state.shapeRawPoint = null;
    syncDrawingControls();
    renderCommentList(); redraw(); updateClock();
  }
  function startCommentEdit(id) {
    const comment = state.active?.comments.find(entry => entry.id === id);
    if (!comment || !canEditOwnComment(comment) || state.editingSaving) return;
    state.editingCommentId = id; state.editingText = comment.text || '';
    renderCommentList(); $('#reviewsCommentList .reviews-comment-edit textarea')?.focus();
  }
  async function saveOwnComment(id) {
    const record = state.active;
    const comment = record?.comments.find(entry => entry.id === id);
    if (!comment || !canEditOwnComment(comment) || state.editingSaving || state.editingCommentId !== id) return;
    const text = state.editingText.trim();
    if (!text && !comment.strokes?.length) { showStatus('Escribí un comentario antes de guardarlo.'); return; }
    if (text === comment.text) { state.editingCommentId = null; state.editingText = ''; renderCommentList(); return; }
    const token = state.shareToken || currentVersion()?.shareToken;
    state.editingSaving = true; renderCommentList();
    try {
      if (token) await (await cloud()).editOwnSharedComment(token, record.id, id, text);
      else await saveRecord({ ...record, comments: record.comments.map(entry => entry.id === id ? { ...entry, text } : entry), updatedAt: new Date().toISOString() });
      const latest = record.comments.find(entry => entry.id === id); if (latest) latest.text = text;
      record.updatedAt = new Date().toISOString();
      state.editingCommentId = null; state.editingText = '';
      if (state.active === record) showStatus('Comentario actualizado.');
    } catch (error) { if (state.active === record) showStatus('No se pudo editar el comentario. Tu texto sigue acá para reintentar.'); console.error(error); }
    finally { state.editingSaving = false; if (state.active === record) { renderCommentList(); renderMarkers(); } }
  }
  async function updateComment(id, mutate) {
    const record = state.active;
    const entry = record?.comments.find(comment => comment.id === id);
    if (!entry || (mutate ? isGuestReview() || !canReview('reviewsEdit') : !canDeleteComment(entry))) return;
    if (!mutate && !await askConfirmation('¿Eliminar este comentario?', 'Se va a borrar el comentario y su anotación de esta review.', 'Eliminar comentario')) return;
    if (state.active !== record || !record.comments.some(comment => comment.id === id)) return;
    const token = state.shareToken || currentVersion()?.shareToken;
    const updated = mutate ? structuredClone(entry) : null;
    if (mutate) mutate(updated);
    try {
      if (token) {
        const api = await cloud();
        if (mutate) await api.changeSharedComment(token, record.id, updated);
        else await api.deleteSharedComment(token, record.id, id);
      } else {
        await saveRecord({ ...record, comments: mutate ? record.comments.map(comment => comment.id === id ? updated : comment) : record.comments.filter(comment => comment.id !== id), updatedAt: new Date().toISOString() });
      }
      record.comments = mutate ? record.comments.map(comment => comment.id === id ? updated : comment) : record.comments.filter(comment => comment.id !== id);
      if (!mutate && state.active === record && state.activeCommentId === id) state.activeCommentId = null;
      if (state.active === record) showStatus(mutate ? 'Comentario actualizado.' : 'Comentario eliminado.');
    } catch (error) { if (state.active === record) showStatus('No se pudo guardar el cambio. El comentario se conserva.'); console.error(error); }
    if (state.active !== record) return;
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
    const record = { id: crypto.randomUUID(), projectId: state.projectId, versionId: state.versionId, sectionId: primarySectionId(), sortIndex: -Date.now(), name: link.name, kind: $('#reviewsLinkKind').value, source: 'dropbox', sourceUrl: link.sourceUrl, size: 0, createdAt: now, updatedAt: now, comments: [] };
    try {
      await saveRecord(record);
      state.records.unshift(record); await selectRecord(record.id);
      $('#reviewsLinkUrl').value = ''; setLinkFormOpen(false);
      message.textContent = 'En Dropbox: Compartir → Copiar enlace del archivo. Para verlo acá, debe permitir acceso a cualquiera con el enlace.';
    } catch (error) { message.textContent = 'No se pudo guardar el enlace en este navegador.'; message.classList.add('is-error'); console.error(error); }
  }
  function clearViewer() {
    stopPan();
    state.stopComments?.(); state.stopComments = null;
    stopMedia(); state.active = null; state.undoHistory = []; localStorage.removeItem(ACTIVE_KEY);
    $('#reviewsMediaTitle').textContent = 'Elegí un archivo'; $('#reviewsMediaTitle').removeAttribute('title');
    $('#reviewsEmpty').hidden = false; $('#reviewsMediaSurface').hidden = true; $('#reviewsTimeline').hidden = true;
    closeShortcuts();
    $('#reviewsAnnotationBar').hidden = true; $('#reviewsCommentForm').hidden = true; $('#reviewsRemoveMedia').hidden = true; $('#reviewsShareBtn').hidden = true; $('#reviewsScreenshotBtn').hidden = true; $('#reviewsDownloadBtn').hidden = true; $('#reviewsZoomValue').hidden = true; $('#reviewsMediaError').hidden = true; $('#reviewsPlaybackTools').hidden = true;
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
    if (!publicView && !canEnterReviews()) return;
    showDashboard();
    if (publicView) document.body.classList.add('public-review');
    $('#dashboardView').hidden = true; $('#reviewsHome').hidden = true; $('#reviewsView').hidden = false; document.body.classList.add('reviews-open');
    $('#reviewsHudRestore').hidden = true;
    $('#storyboardsNav').classList.remove('is-active'); $('#reviewsNav').classList.add('is-active');
    $('#breadcrumbTitle').textContent = currentVersion()?.title || 'Mira';
    $('#reviewsLibraryEyebrow').textContent = currentProject()?.title?.toUpperCase() || 'REVISIÓN DE MATERIAL';
    $('#reviewsLibraryTitle').firstChild.textContent = currentVersion()?.title || 'Mira';
    applyReviewPermissions();
    requestAnimationFrame(fitSurface);
  }
  async function initialize() {
    if (sharedToken || sharedAlias !== null) {
      try {
        const api = await cloud();
        let token = sharedToken;
        let fileId = sharedFileId;
        if (sharedAlias !== null) {
          const { isShareAlias, isShareToken } = await import('./reviews-links.js?v=3');
          if (!isShareAlias(sharedAlias)) throw new Error('El nombre del enlace no es válido.');
          const target = await api.getReviewAlias(sharedAlias);
          if (!isShareToken(target?.token) || typeof target?.fileId !== 'string' || !target.fileId) throw new Error('Esta review ya no está disponible.');
          token = target.token;
          fileId = target.fileId;
        }
        state.shareToken = token;
        state.guestName = sessionStorage.getItem(`gb-review-guest:${token}`) || '';
        const share = await api.getSharedReview(token);
        const project = { id: share.projectId, title: share.projectTitle, client: share.client, agency: share.agency, director: share.director,
          versions: [{ id: share.versionId, title: share.versionTitle, category: share.category, sections: share.sections || [], shareToken: token }] };
        state.projects = [project]; state.projectId = project.id; state.versionId = share.versionId;
        state.records = share.files;
        showReviews();
        const first = share.files.find(file => file.id === fileId) || share.files.sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))[0];
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
    } catch (error) { showStatus('Mira necesita almacenamiento local del navegador para guardar archivos y comentarios.'); console.error(error); }
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
  function pngBlob(output) {
    return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG.')), 'image/png'));
  }
  async function screenshot() {
    if (!state.active) return;
    const record = state.active;
    const source = isVideo() ? video : image;
    const width = source?.videoWidth || source?.naturalWidth || source?.width;
    const height = source?.videoHeight || source?.naturalHeight || source?.height;
    if (!width || !height) { showStatus('Esperá a que el archivo termine de cargar para capturar el cuadro.'); return; }
    try {
      const output = document.createElement('canvas'); output.width = width; output.height = height;
      const context = output.getContext('2d');
      context.drawImage(source, 0, 0, width, height);
      if (!canvas.hidden) context.drawImage(canvas, 0, 0, width, height);
      const blob = await pngBlob(output);
      if (state.active?.id !== record.id) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${record.name.replace(/\.[^.]+$/, '')}-${record.kind === 'video' ? fps() ? `fotograma-${frameNumber()}` : `tiempo-${Math.round(currentTime() * 1000)}ms` : 'captura'}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showStatus('Captura PNG descargada.');
    } catch (error) {
      showStatus(error.name === 'SecurityError' ? 'Dropbox no permite exportar este archivo como PNG. Revisá que el enlace sea público.' : error.message || 'No se pudo guardar la captura.');
      console.error(error);
    }
  }
  function downloadVideo() {
    if (!isVideo()) return;
    const anchor = document.createElement('a');
    if (state.active.source === 'dropbox') { const url = new URL(state.active.sourceUrl); url.searchParams.set('dl', '1'); anchor.href = url.href; }
    else anchor.href = state.mediaUrl;
    anchor.download = state.active.name; anchor.rel = 'noopener'; anchor.click();
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#reviewsView').requestFullscreen(); }
    catch { showStatus('El navegador no permitió activar pantalla completa.'); }
  }
  function closeShortcuts() { $('#reviewsShortcutsMenu').hidden = true; $('#reviewsShortcutsBtn').setAttribute('aria-expanded', 'false'); }
  function toggleHud() { closeShortcuts(); const hidden = document.body.classList.toggle('reviews-hud-hidden'); $('#reviewsHudRestore').hidden = !hidden; requestAnimationFrame(fitSurface); }
  function isEditingText(target) { return target?.closest?.('input,textarea,select,[contenteditable="true"]'); }

  const reviewPermissionLabels = [
    ['reviewsView', 'Ver toda la biblioteca'], ['reviewsCreate', 'Crear proyectos y reviews'],
    ['reviewsEdit', 'Editar material y comentarios'], ['reviewsShare', 'Compartir enlaces'],
  ];
  const reviewRolePermissions = {
    none: {}, client: { reviewsClient: true }, viewer: { reviewsView: true },
    collaborator: { reviewsView: true, reviewsEdit: true },
    manager: { reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true },
  };
  const reviewRoleLabels = { none: 'Sin acceso', client: 'Cliente', viewer: 'Lectura', collaborator: 'Colaborador/a', manager: 'Ejecutiva / Gerencia', custom: 'Personalizado' };
  let staffPeople = [];
  let shareChoices = [];
  let selectedPerson = null;

  function reviewRoleFor(permissions = {}) {
    if (permissions.reviewsClient && !permissions.reviewsView) return 'client';
    const keys = ['reviewsView', 'reviewsCreate', 'reviewsEdit', 'reviewsShare'];
    for (const role of ['none', 'viewer', 'collaborator', 'manager']) {
      if (keys.every(key => Boolean(permissions[key]) === Boolean(reviewRolePermissions[role][key]))) return role;
    }
    return 'custom';
  }
  function customPermissions(values = {}) {
    const container = $('#reviewsCustomPermissions'); container.replaceChildren();
    for (const [key, label] of reviewPermissionLabels) {
      const row = document.createElement('label');
      const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.permission = key; box.checked = values[key] === true;
      const caption = document.createElement('span'); caption.textContent = label;
      row.append(box, caption); container.append(row);
      box.addEventListener('change', () => {
        const input = permission => container.querySelector(`[data-permission="${permission}"]`);
        if (box.checked && key !== 'reviewsView') input('reviewsView').checked = true;
        if (box.checked && (key === 'reviewsCreate' || key === 'reviewsShare')) input('reviewsEdit').checked = true;
        if (!box.checked && key === 'reviewsEdit') for (const dependent of ['reviewsCreate', 'reviewsShare']) input(dependent).checked = false;
        if (!box.checked && key === 'reviewsView') for (const dependent of ['reviewsCreate', 'reviewsEdit', 'reviewsShare']) input(dependent).checked = false;
      });
    }
  }
  function renderShareChoices(selectedTokens = []) {
    const container = $('#reviewsPersonShareList'); container.replaceChildren();
    if (!shareChoices.length) { const empty = document.createElement('p'); empty.textContent = 'Todavía no hay reviews compartidas. Compartí una review primero para asignarla.'; container.append(empty); return; }
    for (const share of shareChoices.sort((a, b) => (a.projectTitle || '').localeCompare(b.projectTitle || ''))) {
      const row = document.createElement('label');
      const box = document.createElement('input'); box.type = 'checkbox'; box.value = share.token; box.checked = selectedTokens.includes(share.token);
      const label = document.createElement('span'); label.textContent = `${share.projectTitle || 'Proyecto'} · ${share.versionTitle || 'Review'}`;
      row.append(box, label); container.append(row);
    }
  }
  function updatePersonRoleFields() {
    const role = $('#reviewsPersonReviewsRole').value;
    $('#reviewsCustomPermissions').hidden = role !== 'custom';
    $('#reviewsPersonShares').hidden = role !== 'client';
    $('#reviewsPersonRoleHelp').textContent = role === 'client' ? 'En su cuenta solo verá y comentará las reviews asignadas. Los enlaces públicos siguen funcionando para quien los tenga.'
      : role === 'viewer' ? 'Lectura permite ver todos los proyectos de Mira.'
      : role === 'collaborator' ? 'Puede ver y editar toda la biblioteca de Mira.'
      : role === 'manager' ? 'Puede ver, crear, editar y compartir toda la biblioteca de Mira.'
      : $('#reviewsPersonStoryboardsRole').value === 'viewer' ? 'En Visto puede abrir y recorrer los proyectos, sin editarlos.' : 'Elegí qué puede hacer en Visto y Mira.';
  }
  function personPermissions() {
    const permissions = { storyboards: $('#reviewsPersonStoryboardsRole').value === 'editor', storyboardsView: $('#reviewsPersonStoryboardsRole').value !== 'none',
      pdr: $('#reviewsPersonPdrRole').value === 'editor', pdrView: $('#reviewsPersonPdrRole').value !== 'none', reviewsClient: false,
      reviewsView: false, reviewsCreate: false, reviewsEdit: false, reviewsShare: false };
    const role = $('#reviewsPersonReviewsRole').value;
    const selected = role === 'custom'
      ? Object.fromEntries([...$('#reviewsCustomPermissions').querySelectorAll('[data-permission]')].map(input => [input.dataset.permission, input.checked]))
      : reviewRolePermissions[role];
    Object.assign(permissions, selected);
    return permissions;
  }
  function personState(person) {
    return person.pending ? 'Pendiente' : person.active === false ? 'Desactivado' : 'Activo';
  }
  function closePerson() { $('#reviewsPersonModal').hidden = true; selectedPerson = null; }
  function openPerson(person = null) {
    selectedPerson = person;
    const permissions = person?.permissions || (person?.pending ? {} : person ? { storyboards: true, reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true } : {});
    $('#reviewsPersonTitle').textContent = person?.name || person?.email || 'Nueva persona';
    $('#reviewsPersonSummary').textContent = person ? person.email : 'Agregá una cuenta Google y elegí su acceso.';
    $('#reviewsPersonState').textContent = person ? personState(person) : 'Nuevo';
    $('#reviewsPersonName').value = person?.name || '';
    $('#reviewsPersonEmail').value = person?.email || '';
    $('#reviewsPersonEmail').readOnly = Boolean(person);
    $('#reviewsPersonActive').checked = person?.active !== false;
    $('#reviewsPersonStoryboardsRole').value = permissions.storyboards ? 'editor' : permissions.storyboardsView ? 'viewer' : 'none';
    $('#reviewsPersonPdrRole').value = permissions.pdr ? 'editor' : permissions.pdrView ? 'viewer' : 'none';
    $('#reviewsPersonReviewsRole').value = reviewRoleFor(permissions);
    customPermissions(permissions);
    renderShareChoices(person?.reviewTokens || []);
    $('#reviewsPersonRemove').hidden = !person || person.pending;
    $('#reviewsPersonStatus').textContent = '';
    updatePersonRoleFields();
    $('#reviewsPersonModal').hidden = false;
    (person ? $('#reviewsPersonName') : $('#reviewsPersonEmail')).focus();
  }
  function createStaffRow(person, owner = false) {
    const row = document.createElement(owner ? 'div' : 'button');
    row.className = `reviews-staff-row${owner ? ' is-owner' : ''}`;
    if (!owner) { row.type = 'button'; row.addEventListener('click', () => openPerson(person)); }
    row.dataset.search = `${person.name || ''} ${person.email || ''}`.toLowerCase();
    const identity = document.createElement('div'); identity.className = 'reviews-staff-person';
    const name = document.createElement('strong'); name.textContent = person.name || person.email;
    const email = document.createElement('small'); email.textContent = person.email;
    identity.append(name, email);
    const role = document.createElement('span');
    const personPermissions = person.permissions || (person.pending ? {} : { storyboards: true, reviewsView: true, reviewsCreate: true, reviewsEdit: true, reviewsShare: true });
    const miraRole = reviewRoleFor(personPermissions);
    role.textContent = owner ? 'Administrador' : person.pending ? 'Sin asignar' : miraRole !== 'none' ? reviewRoleLabels[miraRole] : personPermissions.pdr ? 'PDR · acceso completo' : personPermissions.pdrView ? 'PDR · solo lectura' : personPermissions.storyboards ? 'Visto · acceso completo' : personPermissions.storyboardsView ? 'Visto · solo lectura' : 'Sin acceso';
    const apps = document.createElement('span');
    const permissions = person.permissions || (person.pending ? {} : { storyboards: true, reviewsView: true });
    apps.textContent = owner ? 'Visto · PDR · Mira' : [(permissions.storyboards || permissions.storyboardsView) && 'Visto', (permissions.pdr || permissions.pdrView) && 'PDR', (permissions.reviewsView || permissions.reviewsClient) && 'Mira'].filter(Boolean).join(' · ') || 'Sin aplicaciones';
    const status = document.createElement('span'); status.className = `reviews-staff-state${person.pending ? ' is-pending' : person.active === false ? ' is-disabled' : ''}`; status.textContent = owner ? 'Activo' : personState(person);
    const arrow = document.createElement('span'); arrow.textContent = owner ? '' : '›'; arrow.setAttribute('aria-hidden', 'true');
    row.append(identity, role, apps, status, arrow);
    return row;
  }
  function filterStaffList() {
    const term = $('#reviewsStaffSearch').value.trim().toLowerCase();
    let visible = 0;
    $('#reviewsStaffList').querySelectorAll('.reviews-staff-row').forEach(row => {
      row.hidden = Boolean(term && !row.dataset.search.includes(term));
      if (!row.hidden) visible += 1;
    });
    $('#reviewsStaffCount').textContent = `${visible} de ${staffPeople.length + 1} personas`;
  }
  async function refreshStaffList() {
    const api = await cloud();
    const [staff, requests, shares] = await Promise.all([api.staffList(), api.accessRequests(), api.listReviewShares()]);
    shareChoices = shares;
    const people = new Map(staff.map(person => [person.email.toLowerCase(), { ...person, pending: false }]));
    for (const request of requests) {
      const email = request.email?.toLowerCase(); if (!email || email === 'info@granbertafilms.com') continue;
      const existing = people.get(email);
      if (existing) { if (!existing.name && request.name) existing.name = request.name; }
      else people.set(email, { ...request, email, pending: true });
    }
    staffPeople = [...people.values()].sort((a, b) => Number(b.pending) - Number(a.pending) || (a.name || a.email).localeCompare(b.name || b.email));
    const list = $('#reviewsStaffList'); list.replaceChildren();
    list.append(createStaffRow({ name: 'GB Films', email: 'info@granbertafilms.com', active: true }, true));
    for (const person of staffPeople) list.append(createStaffRow(person));
    filterStaffList();
  }
  $('#reviewsStaffSearch').addEventListener('input', filterStaffList);
  $('#reviewsPersonReviewsRole').addEventListener('change', updatePersonRoleFields);
  $('#reviewsPersonStoryboardsRole').addEventListener('change', updatePersonRoleFields);
  $('#reviewsPersonPdrRole').addEventListener('change', updatePersonRoleFields);
  $('#reviewsAddPerson').addEventListener('click', () => openPerson());
  $('#reviewsAdminBtn').addEventListener('click', async () => {
    if (window.STUDIO_ROLE !== 'admin') return;
    $('#reviewsAdminModal').hidden = false; $('#reviewsStaffStatus').textContent = '';
    try { await refreshStaffList(); } catch (error) { console.error(error); $('#reviewsStaffStatus').textContent = 'No se pudieron cargar los accesos. Revisá Firestore.'; }
  });
  $('#reviewsAdminClose').addEventListener('click', () => { $('#reviewsAdminModal').hidden = true; });
  $('#reviewsAdminModal').addEventListener('click', event => { if (event.target === $('#reviewsAdminModal')) $('#reviewsAdminModal').hidden = true; });
  $('#reviewsPersonClose').addEventListener('click', closePerson);
  $('#reviewsPersonCancel').addEventListener('click', closePerson);
  $('#reviewsPersonModal').addEventListener('click', event => { if (event.target === $('#reviewsPersonModal')) closePerson(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!$('#reviewsPersonModal').hidden) closePerson();
    else if (!$('#reviewsAdminModal').hidden) $('#reviewsAdminModal').hidden = true;
  });
  $('#reviewsPersonForm').addEventListener('submit', async event => {
    event.preventDefault(); if (window.STUDIO_ROLE !== 'admin') return;
    const save = $('#reviewsPersonSave'); save.disabled = true;
    try {
      const email = $('#reviewsPersonEmail').value.trim().toLowerCase();
      if (!selectedPerson && staffPeople.some(person => person.email === email)) throw new Error('Esta persona ya figura en la lista. Abrí su perfil para editarla.');
      const permissions = personPermissions();
      const role = $('#reviewsPersonReviewsRole').value;
      const reviewTokens = role === 'client' ? [...$('#reviewsPersonShareList').querySelectorAll('input:checked')].map(input => input.value) : [];
      await (await cloud()).saveStaff(email, permissions, $('#reviewsPersonName').value,
        { active: $('#reviewsPersonActive').checked, roles: { reviews: role }, reviewTokens });
      $('#reviewsStaffStatus').textContent = `Acceso de ${$('#reviewsPersonEmail').value.trim()} guardado.`;
      closePerson(); await refreshStaffList();
    } catch (error) { console.error(error); $('#reviewsPersonStatus').textContent = error.message || 'No se pudo guardar el acceso.'; }
    finally { save.disabled = false; }
  });
  $('#reviewsPersonRemove').addEventListener('click', async () => {
    if (!selectedPerson || window.STUDIO_ROLE !== 'admin') return;
    const email = selectedPerson.email;
    if (!await askConfirmation('¿Eliminar usuario?', `${email} dejará de tener acceso a GB Studio.`)) return;
    try { await (await cloud()).removeStaff(email); closePerson(); await refreshStaffList(); $('#reviewsStaffStatus').textContent = 'Acceso eliminado.'; }
    catch (error) { console.error(error); $('#reviewsPersonStatus').textContent = 'No se pudo eliminar el acceso.'; }
  });

  $('#reviewsNav').addEventListener('click', () => {
    if (!canEnterReviews()) return;
    if (document.documentElement.dataset.studioApp === 'reviews') {
      if (isGuestReview()) showReviews();
      else showReviewsHome();
    } else window.location.assign('?app=reviews');
  });
  $('#reviewsBackVersions').addEventListener('click', () => showReviewsHome(state.projectId));
  $('#reviewsBackProjects').addEventListener('click', () => showReviewsHome());
  for (const [id, view] of [['#reviewsHomeGridView', 'grid'], ['#reviewsHomeListView', 'list']]) $(id).addEventListener('click', () => {
    homeView = view; localStorage.setItem(HOME_VIEW_KEY, view); renderHome();
  });
  $('#reviewsHomeSort').addEventListener('change', event => { homeSort = event.target.value; localStorage.setItem(HOME_SORT_KEY, homeSort); renderHome(); });
  $('#reviewsHomeClientFilter').addEventListener('change', event => { homeClientFilter = event.target.value; renderHome(); });
  $('#reviewsCreateProject').addEventListener('click', () => openForm('project'));
  $('#reviewsCreateVersion').addEventListener('click', () => openForm('version'));
  $('#reviewsEmptyCreate').addEventListener('click', () => openForm(currentProject() ? 'version' : 'project'));
  $('#reviewsFormClose').addEventListener('click', closeForm);
  $('#reviewsFormCancel').addEventListener('click', closeForm);
  document.querySelectorAll('input[name="reviewsCoverType"]').forEach(input => input.addEventListener('change', () => {
    $('#reviewsCoverMessage').textContent = '';
    updateCoverPreview();
  }));
  $('#reviewsCoverColor').addEventListener('input', event => {
    coverDraft.color = event.target.value;
    document.querySelector('input[name="reviewsCoverType"][value="color"]').checked = true;
    updateCoverPreview();
  });
  document.querySelectorAll('[data-cover-color]').forEach(button => button.addEventListener('click', () => {
    coverDraft.color = button.dataset.coverColor;
    document.querySelector('input[name="reviewsCoverType"][value="color"]').checked = true;
    updateCoverPreview();
  }));
  $('#reviewsCoverFile').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    const requestId = ++coverRequestId;
    $('#reviewsFormSubmit').disabled = true;
    $('#reviewsCoverMessage').textContent = 'Preparando portada…';
    try {
      const imageData = await prepareCoverImage(file);
      if (requestId !== coverRequestId || formMode?.type !== 'project') return;
      coverDraft.image = imageData;
      document.querySelector('input[name="reviewsCoverType"][value="image"]').checked = true;
      $('#reviewsCoverMessage').textContent = 'Imagen lista para guardar.';
      updateCoverPreview();
    } catch (error) {
      if (requestId === coverRequestId) {
        $('#reviewsCoverMessage').textContent = error.message || 'No se pudo cargar la imagen.';
        event.target.value = '';
      }
    } finally { if (requestId === coverRequestId) $('#reviewsFormSubmit').disabled = false; }
  });
  $('#reviewsEntityForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!formMode) return;
    const title = $('#reviewsEntityTitle').value.trim(), client = $('#reviewsEntityClient').value.trim();
    if (!title || (formMode.type === 'project' && !client)) return;
    const coverType = formMode.type === 'project' ? selectedCoverType() : 'default';
    if (coverType === 'image' && !coverDraft.image) {
      $('#reviewsCoverMessage').textContent = 'Elegí una imagen antes de guardar.';
      $('#reviewsCoverFile').focus();
      return;
    }
    const now = new Date().toISOString();
    const submitButton = $('#reviewsFormSubmit'); submitButton.disabled = true;
    try {
      if (formMode.type === 'project') {
        const old = state.projects.find(entry => entry.id === formMode.id);
        const project = { id: old?.id || crypto.randomUUID(), title, client, agency: $('#reviewsEntityAgency').value.trim(), director: $('#reviewsEntityDirector').value.trim(), coverType,
          coverImage: coverType === 'image' ? coverDraft.image : '', coverColor: coverType === 'color' ? coverDraft.color : '',
          createdAt: old?.createdAt || now, updatedAt: now, versions: old?.versions || [{ id: crypto.randomUUID(), title: 'Montaje · V1', category: 'Montaje', sections: [{ id: 'default', title: 'Última versión', isDefault: true }], createdAt: now, updatedAt: now }] };
        if (old?.legacy) project.legacy = true;
        await saveProject(project);
        state.projects = old ? state.projects.map(entry => entry.id === old.id ? project : entry) : [...state.projects, project];
        closeForm(); if (old) renderHome(); else showReviewsHome(project.id);
      } else {
        const project = currentProject(); if (!project) return;
        const old = project.versions.find(entry => entry.id === formMode.id);
        const version = { ...old, id: old?.id || crypto.randomUUID(), title, category: $('#reviewsEntityCategory').value, sections: old?.sections || [{ id: 'default', title: 'Última versión', isDefault: true }], createdAt: old?.createdAt || now, updatedAt: now };
        const updated = { ...project, updatedAt: now, versions: old ? project.versions.map(entry => entry.id === old.id ? version : entry) : [...project.versions, version] };
        await saveProject(updated);
        state.projects = state.projects.map(entry => entry.id === updated.id ? updated : entry);
        closeForm(); renderHome();
      }
    } catch (error) { console.error(error); $('#reviewsFormCopy').textContent = 'No se pudo guardar. Revisá tu conexión y el espacio disponible.'; }
    finally { submitButton.disabled = false; }
  });
  $('#reviewsConfirmClose').addEventListener('click', () => closeConfirmation(false));
  $('#reviewsConfirmCancel').addEventListener('click', () => closeConfirmation(false));
  $('#reviewsConfirmAccept').addEventListener('click', () => closeConfirmation(true));
  $('#reviewsCopyClose').addEventListener('click', () => { $('#reviewsCopyModal').hidden = true; });
  $('#reviewsCopyDone').addEventListener('click', () => { $('#reviewsCopyModal').hidden = true; });
  $('#reviewsCopyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#reviewsCopyInput').value); $('#reviewsCopyDescription').textContent = 'Enlace copiado. El cliente abrirá este archivo directamente, sin entrar al resto de Mira.'; }
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
    if (sectionEditId) {
      const item = sections.find(section => section.id === sectionEditId);
      if (item) { item.title = title; if (sectionEditId === primarySectionId()) item.isDefault = true; }
      else if (sectionEditId === 'default') sections.unshift({ id: 'default', title, isDefault: true });
      else return;
    }
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
      applyReviewPermissions(); renderCommentList();
    } catch (error) {
      console.error('Guest sign-in failed', error);
      $('#reviewsGuestNameError').textContent = 'No se pudo habilitar el comentario. Verificá que el acceso de invitado esté activo e intentá de nuevo.';
    } finally { $('#reviewsGuestLogin').disabled = false; }
  });
  window.addEventListener('studio-auth-change', () => {
    if (isGuestReview() && window.STUDIO_ROLE === 'review_guest' && state.guestName) {
      state.guestName = ''; state.guestUid = null;
      sessionStorage.removeItem(`gb-review-guest:${state.shareToken}`);
    }
    $('#reviewsAdminBtn').hidden = window.STUDIO_ROLE !== 'admin';
    $('#reviewsNav').hidden = !canEnterReviews();
    if (!window.STUDIO_SIGNED_IN) { $('#reviewsAdminModal').hidden = true; $('#reviewsPersonModal').hidden = true; }
    const accessKey = `${window.STUDIO_USER?.uid || ''}:${JSON.stringify(window.STUDIO_PERMISSIONS || {})}:${JSON.stringify(window.STUDIO_REVIEW_TOKENS || [])}`;
    const needsHydration = window.STUDIO_SIGNED_IN && canEnterReviews() && !isGuestReview() && accessKey !== hydratedUserUid;
    if (needsHydration) {
      reviewsLibraryReady = false; reviewsLibraryError = '';
      // A role change must not leave a previously opened staff file on screen.
      if (isClient()) { clearViewer(); showReviewsHome(); }
    }
    if (sharedReview && window.STUDIO_SIGNED_IN) {
      const existing = state.records.find(record => !record.ephemeral && record.source === 'dropbox' && record.sourceUrl === sharedReview.sourceUrl);
      if (existing && state.active?.id !== existing.id) selectRecord(existing.id);
    }
    if (window.STUDIO_SIGNED_IN && window.STUDIO_ROLE !== 'admin' && !isGuestReview() && accessKey !== hydratedUserUid) {
      state.projects = []; state.records = []; state.projectId = null; state.versionId = null; state.active = null;
    }
    applyReviewPermissions();
    if (!$('#reviewsHome').hidden && canEnterReviews()) renderHome();
    if (needsHydration) {
      hydratedUserUid = accessKey;
      Promise.resolve(initialized).then(async () => {
        if (accessKey !== hydratedUserUid || !canEnterReviews()) return;
        if (window.STUDIO_ROLE !== 'admin') { state.projects = []; state.records = []; state.projectId = null; state.versionId = null; state.active = null; }
        const api = await cloud();
        const clientOnly = isClient();
        const [remoteProjects, remoteFiles] = clientOnly ? [[], []] : await Promise.all([api.listStaffProjects(), api.listStaffFiles()]);
        if (accessKey !== hydratedUserUid || !canEnterReviews()) return;
        const remoteProjectIds = new Set(remoteProjects.map(project => project.id));
        const remoteFileIds = new Set(remoteFiles.map(record => record.id));
        // Only the administrator imports pre-cloud browser data; other accounts see the shared library.
        const importedProjects = window.STUDIO_ROLE === 'admin' ? state.projects.filter(project => !remoteProjectIds.has(project.id)) : [];
        for (const project of importedProjects) await api.saveStaffProject(project);
        const knownProjects = new Set([...remoteProjects, ...importedProjects].map(project => project.id));
        const importedFiles = window.STUDIO_ROLE === 'admin' ? state.records.filter(record => record.source === 'dropbox' && knownProjects.has(record.projectId) && !remoteFileIds.has(record.id)) : [];
        for (const record of importedFiles) await api.saveStaffFile(record);
        const localFiles = window.STUDIO_ROLE === 'admin' ? state.records.filter(record => record.source !== 'dropbox' && knownProjects.has(record.projectId)) : [];
        state.projects = [...remoteProjects, ...importedProjects];
        state.records = [...remoteFiles, ...importedFiles, ...localFiles];
        const shares = await api.listSharedReviews(clientOnly ? window.STUDIO_REVIEW_TOKENS || [] : null);
        if (accessKey !== hydratedUserUid || !canEnterReviews()) return;
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
        reviewsLibraryReady = true;
        reviewsLibraryError = '';
        const assigned = clientOnly ? state.projects.flatMap(project => project.versions.map(version => ({ projectId: project.id, versionId: version.id }))) : [];
        if (clientOnly && assigned.length === 1 && !$('#reviewsHome').hidden) {
          state.projectId = assigned[0].projectId;
          await openVersion(assigned[0].versionId);
        } else if (!$('#reviewsHome').hidden) renderHome();
      }).catch(error => {
        if (accessKey !== hydratedUserUid) return;
        hydratedUserUid = null;
        reviewsLibraryError = 'No se pudieron cargar los proyectos. Recargá la página para intentar de nuevo.';
        console.error('Could not load shared reviews', error);
        if (!$('#reviewsHome').hidden) renderHome();
      });
    } else if (!window.STUDIO_SIGNED_IN || !canEnterReviews()) { hydratedUserUid = null; reviewsLibraryReady = false; }
  });
  $('#reviewsShareBtn').addEventListener('click', () => shareVersion());
  $('#reviewsInBtn').addEventListener('click', () => setRangePoint('in'));
  $('#reviewsOutBtn').addEventListener('click', () => setRangePoint('out'));
  $('#reviewsClearRange').addEventListener('click', () => { if (!isVideo()) return; state.active.inPoint = null; state.active.outPoint = null; renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsTimelineMode').addEventListener('change', event => { if (!isVideo()) return; state.active.timelineMode = event.target.value === 'frames' && fps() ? 'frames' : 'time'; renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsPrevFrame').addEventListener('click', () => stepFrame(-1));
  $('#reviewsNextFrame').addEventListener('click', () => stepFrame(1));
  $('#reviewsFrameJump').addEventListener('change', event => { if (!isVideo()) return; seekFrame(Number(event.target.value) - firstFrame()); });
  $('#reviewsFrameStart').addEventListener('change', event => { if (!isVideo()) return; state.active.frameStart = Math.max(0, Math.min(9999999, Math.round(Number(event.target.value) || 0))); renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsFitBtn').addEventListener('click', resetView);
  $('#reviewsScreenshotBtn').addEventListener('click', screenshot);
  $('#reviewsDownloadBtn').addEventListener('click', downloadVideo);
  $('#reviewsFullscreenBtn').addEventListener('click', toggleFullscreen);
  $('#reviewsHudBtn').addEventListener('click', toggleHud);
  $('#reviewsHudRestore').addEventListener('click', toggleHud);
  $('#reviewsShortcutsBtn').addEventListener('click', () => {
    const menu = $('#reviewsShortcutsMenu'); menu.hidden = !menu.hidden;
    $('#reviewsShortcutsBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  $('#reviewsShortcutsMenu').addEventListener('click', event => { if (event.target.closest('button')) closeShortcuts(); });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.reviews-shortcuts')) closeShortcuts(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeShortcuts(); });
  document.addEventListener('fullscreenchange', () => { $('#reviewsFullscreenBtn span').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa'; requestAnimationFrame(fitSurface); });
  document.addEventListener('dragover', event => { if (!$('#reviewsView').hidden && event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => { if (!$('#reviewsView').hidden && event.dataTransfer?.files?.length) { event.preventDefault(); showStatus('En Mira solo podés vincular archivos ya compartidos desde Dropbox.'); } });
  $('#reviewsStage').addEventListener('wheel', event => { if (!state.active || state.active.kind === 'model') return; event.preventDefault(); zoomAt(Math.exp(-event.deltaY * .002), event.clientX, event.clientY); }, { passive: false });
  $('#reviewsStage').addEventListener('pointerdown', event => {
    if (!state.active || state.active.kind === 'model' || event.button !== 1 || state.panPointer) return;
    event.preventDefault();
    state.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    $('#reviewsStage').classList.add('is-panning');
    $('#reviewsStage').setPointerCapture(event.pointerId);
  });
  $('#reviewsStage').addEventListener('pointermove', event => {
    const pan = state.panPointer;
    if (!pan || pan.id !== event.pointerId) return;
    event.preventDefault();
    state.view.x += event.clientX - pan.x;
    state.view.y += event.clientY - pan.y;
    pan.x = event.clientX; pan.y = event.clientY;
    applyView();
  });
  const endPan = event => { if (state.panPointer?.id === event.pointerId) stopPan(); };
  $('#reviewsStage').addEventListener('pointerup', endPan);
  $('#reviewsStage').addEventListener('pointercancel', endPan);
  $('#reviewsStage').addEventListener('lostpointercapture', endPan);
  $('#reviewsStage').addEventListener('auxclick', event => { if (event.button === 1 && state.active?.kind !== 'model') event.preventDefault(); });
  $('#reviewsStage').addEventListener('pointerdown', event => { if (!state.zHeld || !state.active || event.button !== 0) return; event.preventDefault(); state.zoomPointer = { id: event.pointerId, y: event.clientY, scale: state.view.scale, moved: false }; $('#reviewsStage').setPointerCapture(event.pointerId); });
  $('#reviewsStage').addEventListener('pointermove', event => { const drag = state.zoomPointer; if (!drag || drag.id !== event.pointerId) return; if (Math.abs(event.clientY - drag.y) > 3) drag.moved = true; if (drag.moved) zoomAt(Math.exp((drag.y - event.clientY) * .012) * drag.scale / state.view.scale, event.clientX, event.clientY); });
  const endZoom = event => { const drag = state.zoomPointer; if (!drag || drag.id !== event.pointerId) return; if (!drag.moved && event.type === 'pointerup') zoomAt(1.5, event.clientX, event.clientY); state.zoomPointer = null; if ($('#reviewsStage').hasPointerCapture(event.pointerId)) $('#reviewsStage').releasePointerCapture(event.pointerId); };
  $('#reviewsStage').addEventListener('pointerup', endZoom); $('#reviewsStage').addEventListener('pointercancel', endZoom);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && !$('#reviewsView').hidden && state.active && !isEditingText(event.target) && !state.saving) {
      event.preventDefault(); undoAnnotation(); return;
    }
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
  window.addEventListener('blur', () => { state.zHeld = false; $('#reviewsStage').classList.remove('is-zooming'); stopPan(); });
  function togglePlayback() { if (!video.paused) { video.pause(); return; } if (Number.isFinite(state.active?.inPoint) && (currentTime() < state.active.inPoint || (Number.isFinite(state.active.outPoint) && currentTime() >= state.active.outPoint))) video.currentTime = state.active.inPoint; video.play().catch(() => showStatus('Este navegador no puede reproducir el formato del video.')); }
  $('#reviewsPlayBtn').addEventListener('click', togglePlayback);
  $('#reviewsMuteBtn').addEventListener('click', () => { video.muted = !video.muted; updateClock(); });
  video.addEventListener('click', () => { if ((state.drawing && video.paused) || state.zHeld) return; togglePlayback(); });
  $('#reviewsSeek').addEventListener('input', event => { if (!Number.isFinite(video.duration)) return; if (frameMode()) seekFrame(Number(event.target.value)); else video.currentTime = video.duration * Number(event.target.value) / 1000; state.activeCommentId = null; redraw(); updateClock(); renderCommentList(); });
  $('#reviewsSeek').addEventListener('change', event => { if (frameMode() && Number.isFinite(video.duration)) seekFrame(Number(event.target.value)); });
  video.addEventListener('loadedmetadata', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((video.videoWidth || 16) / (video.videoHeight || 9))); renderPlaybackSettings(); renderMarkers(); fitSurface(); });
  image.addEventListener('load', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((image.naturalWidth || 16) / (image.naturalHeight || 9))); fitSurface(); });
  video.addEventListener('timeupdate', () => { if (!video.paused && Number.isFinite(state.active?.outPoint) && currentTime() >= state.active.outPoint) { video.pause(); video.currentTime = state.active.outPoint; } updateClock(); });
  video.addEventListener('play', () => { state.activeCommentId = null; state.scratch = []; state.undoHistory = []; state.pointerId = null; state.shapeRawPoint = null; syncDrawingControls(); redraw(); renderCommentList(); updateClock(); });
  video.addEventListener('pause', () => { syncDrawingControls(); updateClock(); });
  const mediaError = event => {
    const media = event.target;
    if (state.active?.source === 'dropbox' && !state.mediaCorsFallback && !media.hidden) {
      state.mediaCorsFallback = true;
      const url = new URL(state.active.sourceUrl); url.searchParams.set('raw', '1');
      media.removeAttribute('crossorigin'); media.src = url.href;
      return;
    }
    if (state.active?.source === 'dropbox') { $('#reviewsMediaError').hidden = false; showStatus('No se pudo abrir el enlace de Dropbox. Revisá el acceso y el formato del archivo.'); }
    else showStatus('El formato no se puede reproducir en este navegador. Probá con MP4 (H.264), WebM o una foto compatible.');
  };
  video.addEventListener('error', mediaError);
  image.addEventListener('error', mediaError);
  function syncDrawingControls() {
    canvas.classList.toggle('is-drawing', state.drawing && (!isVideo() || video.paused));
    $('#reviewsDrawBtn').classList.toggle('is-active', state.drawing && !state.sketchMode);
    $('#reviewsDrawBtn').setAttribute('aria-pressed', String(state.drawing && !state.sketchMode));
    $('#reviewsSketchBtn').classList.toggle('is-active', state.sketchMode);
    $('#reviewsSketchBtn').setAttribute('aria-pressed', String(state.sketchMode));
  }
  function closeToolMenus() {
    document.querySelectorAll('.reviews-tool-picker').forEach(group => {
      group.querySelector('.reviews-tool-menu').hidden = true;
      group.querySelector('.reviews-tool-picker-button').setAttribute('aria-expanded', 'false');
    });
  }
  function positionToolMenus() {
    document.querySelectorAll('.reviews-tool-menu:not([hidden])').forEach(menu => {
      menu.style.transform = '';
      const rect = menu.getBoundingClientRect();
      const shift = rect.left < 12 ? 12 - rect.left : rect.right > innerWidth - 12 ? innerWidth - 12 - rect.right : 0;
      menu.style.transform = `translateX(${shift}px)`;
    });
  }
  document.querySelectorAll('.reviews-tool-picker-button').forEach(picker => picker.addEventListener('click', () => {
    const menu = picker.parentElement.querySelector('.reviews-tool-menu'), opening = menu.hidden;
    closeToolMenus(); menu.hidden = !opening; picker.setAttribute('aria-expanded', String(opening));
    positionToolMenus();
  }));
  window.addEventListener('resize', positionToolMenus);
  document.querySelectorAll('.reviews-tool-menu').forEach(menu => menu.addEventListener('click', event => {
    const button = event.target.closest('[data-review-tool]');
    if (!button || !state.active) return;
    state.tool = button.dataset.reviewTool;
    const label = button.querySelector('.reviews-tool-name').textContent;
    const group = button.closest('.reviews-tool-picker');
    const picker = group.querySelector('.reviews-tool-picker-button');
    picker.querySelector('.reviews-picker-label').textContent = `${button.querySelector('span').textContent} ${label}`;
    picker.setAttribute('aria-label', `${group.dataset.toolGroup === 'brush' ? 'Pincel' : 'Forma'}: ${label}`);
    document.querySelectorAll('[data-review-tool]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    document.querySelectorAll('.reviews-tool-picker').forEach(entry => {
      const active = entry === group;
      entry.querySelector('.reviews-tool-picker-button').classList.toggle('is-active', active);
      entry.querySelector('.reviews-tool-picker-button').setAttribute('aria-pressed', String(active));
    });
    closeToolMenus(); video.pause(); state.activeCommentId = null;
    state.drawing = true; syncDrawingControls(); redraw();
  }));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.reviews-tool-picker')) closeToolMenus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeToolMenus(); });
  $('#reviewsDrawBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.drawing = state.sketchMode || !state.drawing; state.sketchMode = false; syncDrawingControls(); redraw(); });
  $('#reviewsSketchBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.sketchMode = !state.sketchMode; state.drawing = state.sketchMode; syncDrawingControls(); redraw(); });
  $('#reviewsUndoBtn').addEventListener('click', undoAnnotation);
  $('#reviewsClearBtn').addEventListener('click', clearAnnotation);
  canvas.addEventListener('pointerdown', event => { if (!state.drawing || !state.active || state.zHeld || event.button !== 0) return; event.preventDefault(); state.activeCommentId = null; state.pointerId = event.pointerId; state.shapeRawPoint = pointerPoint(event); canvas.setPointerCapture(event.pointerId); const mode = state.sketchMode ? 'scratch' : 'draft'; rememberAnnotation({ type: 'stroke', mode }); state[mode].push({ tool: state.tool, color: $('#reviewsColor').value, points: [state.shapeRawPoint] }); redraw(); });
  function updateActiveShape(point, shiftKey) {
    const stroke = (state.sketchMode ? state.scratch : state.draft).at(-1);
    if (!stroke || !['line', 'arrow', 'rect', 'ellipse', 'square', 'circle'].includes(stroke.tool)) return false;
    state.shapeRawPoint = point;
    stroke.points[1] = shapePoint(stroke.points[0], point, stroke.tool, shiftKey);
    redraw();
    return true;
  }
  canvas.addEventListener('pointermove', event => {
    const strokes = state.sketchMode ? state.scratch : state.draft;
    if (state.pointerId !== event.pointerId || !strokes.length) return;
    const stroke = strokes.at(-1), point = pointerPoint(event);
    if (updateActiveShape(point, event.shiftKey)) return;
    const last = stroke.points.at(-1);
    if (Math.hypot((point[0] - last[0]) * canvas.clientWidth, (point[1] - last[1]) * canvas.clientHeight) > 2) { stroke.points.push(point); redraw(); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Shift' && state.pointerId !== null && state.shapeRawPoint) updateActiveShape(state.shapeRawPoint, true); });
  document.addEventListener('keyup', event => { if (event.key === 'Shift' && state.pointerId !== null && state.shapeRawPoint) updateActiveShape(state.shapeRawPoint, false); });
  const endStroke = event => { if (state.pointerId !== event.pointerId) return; if (event.type === 'pointerup') updateActiveShape(pointerPoint(event), event.shiftKey); state.pointerId = null; state.shapeRawPoint = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);
  $('#reviewsCommentForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.active || state.saving || !canComment()) return;
    const text = $('#reviewsCommentText').value.trim(); if (!text && (!state.draft.length || state.sketchMode)) { $('#reviewsCommentText').focus(); return; }
    const authorName = isGuestReview() ? window.STUDIO_ROLE === 'review_guest' ? window.STUDIO_USER?.displayName || window.STUDIO_USER?.email || 'Google' : state.guestName || 'Invitado' : window.STUDIO_USER?.displayName || window.STUDIO_USER?.email || 'Equipo';
    const comment = { id: crypto.randomUUID(), text, time: currentTime(), strokes: state.sketchMode ? [] : structuredClone(state.draft), resolved: false, createdAt: new Date().toISOString(), authorUid: window.STUDIO_USER?.uid || state.guestUid || '', authorName };
    const token = state.shareToken || currentVersion()?.shareToken;
    state.saving = true; $('#reviewsCommentForm button[type=submit]').disabled = true;
    const wasEphemeral = Boolean(state.active.ephemeral);
    if (wasEphemeral) delete state.active.ephemeral;
    state.active.comments.push(comment); state.active.updatedAt = comment.createdAt;
    try {
      if (token) {
        await (await cloud()).addSharedComment(token, state.active.id, comment, authorName);
      } else await saveRecord(state.active);
      $('#reviewsCommentText').value = ''; state.draft = []; state.undoHistory = []; if (!state.sketchMode) { state.activeCommentId = comment.id; state.drawing = false; canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); }
      renderCommentList(); renderMarkers(); renderList(); redraw();
    } catch (error) { state.active.comments.pop(); if (wasEphemeral) state.active.ephemeral = true; showStatus(token ? 'No se pudo compartir el comentario. Revisá tu conexión o los permisos de la review.' : 'No se pudo guardar el comentario. Revisá el espacio disponible.'); console.error(error); }
    finally { state.saving = false; $('#reviewsCommentForm button[type=submit]').disabled = false; }
  });
  new ResizeObserver(resizeCanvas).observe($('#reviewsMediaSurface'));
  new ResizeObserver(fitSurface).observe($('#reviewsStage'));
  initialized = initialize();
})();

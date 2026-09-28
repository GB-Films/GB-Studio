const STORAGE_KEY = 'storyboard-studio-workspace-v2';
const LEGACY_KEY = 'storyboard-studio-project-v1';
const PROJECTS_KEY = 'storyboard-studio-projects-v1';
const CURRENT_PROJECT_KEY = 'storyboard-studio-current-project-v1';
const PROJECT_SORT_KEY = 'storyboard-studio-project-sort-v1';
const INDEXED_DB_NAME = 'gb-studio-workspace-v1';
const MIN_CANVAS_PADDING = 6;
const PHOTO_INFO_OVERLAY_HEIGHT = 18;

const SHOT_TYPES = [
  { value: 'PG', label: 'Plano general' },
  { value: 'PE', label: 'Plano entero' },
  { value: 'PA', label: 'Plano americano' },
  { value: 'PM', label: 'Plano medio' },
  { value: 'PP', label: 'Primer plano' },
  { value: 'PD', label: 'Plano detalle' },
  { value: 'POV', label: 'Plano subjetivo / POV' },
  { value: 'OTS', label: 'Sobre hombro' },
  { value: 'CEN', label: 'Cenital' },
  { value: 'NAD', label: 'Nadir' },
  { value: 'TRK', label: 'Seguimiento' }
];

const CAMERA_MOVES = [
  { value: 'none', label: 'Sin movimiento', tag: '' },
  { value: 'zoom-in', label: 'Zoom in', tag: 'ZOOM IN' },
  { value: 'zoom-out', label: 'Zoom out', tag: 'ZOOM OUT' },
  { value: 'pan-left', label: 'Pan a izquierda', tag: 'PAN ←' },
  { value: 'pan-right', label: 'Pan a derecha', tag: 'PAN →' },
  { value: 'tilt-up', label: 'Tilt hacia arriba', tag: 'TILT ↑' },
  { value: 'tilt-down', label: 'Tilt hacia abajo', tag: 'TILT ↓' },
  { value: 'dolly-in', label: 'Dolly in / Push in', tag: 'DOLLY IN' },
  { value: 'dolly-out', label: 'Dolly out / Pull out', tag: 'DOLLY OUT' },
  { value: 'track-left', label: 'Travelling a izquierda', tag: 'TRACK ←' },
  { value: 'track-right', label: 'Travelling a derecha', tag: 'TRACK →' }
];
const CAMERA_MOVE_VALUES = new Set(CAMERA_MOVES.map(move => move.value));

const BACKGROUND_PATTERNS = new Set(['none', 'grid', 'dots', 'diagonal', 'blueprint']);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
function validHexColor(value, fallback) { return HEX_COLOR_PATTERN.test(value || '') ? value : fallback; }
function colorWithAlpha(value, alpha) {
  const hex = validHexColor(value, '#000000').slice(1);
  return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${alpha})`;
}

function backgroundPatternCss(pattern, color = '#c7c7c7') {
  const gridLine = colorWithAlpha(color, .42);
  const fineLine = colorWithAlpha(color, .24);
  const dotColor = colorWithAlpha(color, .62);
  const diagonalLine = colorWithAlpha(color, .32);
  const patterns = {
    grid: {
      image: `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px)`,
      size: '24px 24px'
    },
    dots: {
      image: `radial-gradient(${dotColor} 1px, transparent 1.5px)`,
      size: '18px 18px'
    },
    diagonal: {
      image: `repeating-linear-gradient(135deg, ${diagonalLine} 0 1px, transparent 1px 13px)`,
      size: 'auto'
    },
    blueprint: {
      image: `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px), linear-gradient(${fineLine} 1px, transparent 1px), linear-gradient(90deg, ${fineLine} 1px, transparent 1px)`,
      size: '72px 72px, 72px 72px, 18px 18px, 18px 18px'
    }
  };
  return patterns[pattern] || { image: 'none', size: 'auto' };
}

function applyArtboardBackground(element) {
  if (!element) return;
  const image = project?.backgroundImage || '';
  const pattern = backgroundPatternCss(project?.backgroundPattern, project?.backgroundPatternColor);
  element.style.backgroundColor = project?.background || '#ffffff';
  element.style.backgroundImage = pattern.image;
  element.style.backgroundSize = pattern.size;
  element.style.backgroundPosition = 'center';
  element.style.backgroundRepeat = 'repeat';
  let layer = [...element.children].find(child => child.classList?.contains('artboard-background-photo'));
  if (!image) { layer?.remove(); return; }
  if (!layer) {
    layer = document.createElement('img');
    layer.className = 'artboard-background-photo';
    layer.alt = '';
    element.prepend(layer);
  }
  if (layer._backgroundSource !== image) {
    layer.src = resolveMediaSource(image);
    layer._backgroundSource = image;
  }
  layer.style.opacity = String(Math.max(0, Math.min(100, Number(project?.backgroundImageOpacity ?? 100))) / 100);
  const blur = Math.max(0, Math.min(24, Number(project?.backgroundImageBlur ?? 0)));
  const shortSide = Math.max(1, Math.min(element.clientWidth || Number.parseFloat(element.style.width) || 800, element.clientHeight || Number.parseFloat(element.style.height) || 450));
  layer.style.filter = blur ? `blur(${blur}px)` : 'none';
  layer.style.transform = blur ? `scale(${1 + blur * 2 / shortSide})` : 'none';
}

function drawBackgroundPattern(ctx, width, height, pattern, color = '#c7c7c7') {
  ctx.save();
  ctx.strokeStyle = colorWithAlpha(color, .42);
  ctx.fillStyle = colorWithAlpha(color, .62);
  ctx.lineWidth = Math.max(1, width / 1600);
  if (pattern === 'grid' || pattern === 'blueprint') {
    const step = pattern === 'blueprint' ? 72 : 24;
    for (let x = 0; x <= width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y <= height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (pattern === 'blueprint') {
      ctx.strokeStyle = colorWithAlpha(color, .24);
      for (let x = 0; x <= width; x += 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 0; y <= height; y += 18) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    }
  } else if (pattern === 'dots') {
    for (let x = 9; x <= width; x += 18) for (let y = 9; y <= height; y += 18) { ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill(); }
  } else if (pattern === 'diagonal') {
    ctx.strokeStyle = colorWithAlpha(color, .32);
    const step = 13;
    for (let offset = -height; offset < width + height; offset += step) { ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset + height, height); ctx.stroke(); }
  }
  ctx.restore();
}

async function drawArtboardBackground(ctx, width, height) {
  ctx.fillStyle = project?.background || '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (project?.backgroundImage) {
    const image = await loadImageSource(project.backgroundImage);
    if (image) {
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      ctx.save();
      const liveWidth = $('#canvasPage')?.clientWidth || width;
      const blur = Math.max(0, Math.min(24, Number(project.backgroundImageBlur ?? 0))) * width / liveWidth;
      ctx.globalAlpha = Math.max(0, Math.min(100, Number(project.backgroundImageOpacity ?? 100))) / 100;
      ctx.filter = `blur(${blur}px)`;
      ctx.translate(width / 2, height / 2);
      ctx.scale(1 + blur * 2 / Math.min(width, height), 1 + blur * 2 / Math.min(width, height));
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    }
  }
  drawBackgroundPattern(ctx, width, height, project?.backgroundPattern, project?.backgroundPatternColor);
}

let currentPageIndex = 0;
let selectedItemId = null;
let selectedItemIds = new Set();
let selectionAnchorId = null;
let suppressCanvasClick = false;
let activeInspector = 'page';
let draggedAssetId = null;
let slotMode = false;
let hoverSlotIndex = null;
let slotDrag = null;
let annotationToolMode = 'none';
let zoom = 1;
let toastTimer;
let saveTimer;
let pendingDeleteProjectId = null;
let pendingDeleteVersionId = null;
let pendingDeletePageIndex = null;
let lastUndoState = null;
let pendingNewProject = false;
let projectSort = localStorage.getItem(PROJECT_SORT_KEY) || 'updated';
let indexedDbHydrationStarted = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const createId = (prefix = 'id') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const DEFAULT_PRODUCER_NAME = 'GRAN BERTA FILMS';
const DEFAULT_PRODUCER_LOGO = 'assets/gb-films-logo-white.png';
function resolveMediaSource(source) {
  if (!source || /^(data:|blob:|https?:|\/)/i.test(source)) return source;
  try { return new URL(source, document.baseURI).href; } catch { return source; }
}
function shotTypeInfo(value) { return SHOT_TYPES.find(type => type.value === value) || SHOT_TYPES[0]; }
function cameraMoveInfo(value) { return CAMERA_MOVES.find(move => move.value === value) || CAMERA_MOVES[0]; }
function normalizeDrawingStrokes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-120).map(stroke => ({
    id: typeof stroke?.id === 'string' ? stroke.id : createId('stroke'),
    color: validHexColor(stroke?.color, '#ff3b30'),
    width: clamp(Number(stroke?.width) || 2.4, .8, 8),
    points: Array.isArray(stroke?.points) ? stroke.points.slice(0, 1500).map(point => ({ x: clamp(Number(point?.x) || 0, 0, 100), y: clamp(Number(point?.y) || 0, 0, 100) })) : []
  })).filter(stroke => stroke.points.length);
}
function selectedItems() { const page = currentPage(); const ids = selectedItemIds.size ? selectedItemIds : selectedItemId ? new Set([selectedItemId]) : new Set(); return page ? page.items.filter(item => ids.has(item.id)) : []; }
function itemIsSelected(item) { return selectedItemIds.size ? selectedItemIds.has(item.id) : item.id === selectedItemId; }
function clearItemSelection() { selectedItemIds.clear(); selectionAnchorId = null; selectedItemId = null; }
function setItemSelection(items, primaryId = items[0]?.id || null) { selectedItemIds = new Set(items.map(item => item.id)); selectedItemId = primaryId; selectionAnchorId = primaryId; }
function itemDisplayTitle(item, asset) {
  const type = shotTypeInfo(item.shotType);
  const base = item.title?.trim() || asset?.name || `Plano ${(item.slot ?? 0) + 1}`;
  return base.startsWith(`${type.value} ·`) ? base : `${type.value} · ${base}`;
}
let project = null;
let projects = [];
let currentProjectId = null;

function blankPage(title = 'Página 1') { return { id: createId('page'), title, items: [] }; }
function defaultProject() { return { version: 2, layoutEngine: 'grid', layoutEngineVersion: 1, title: 'Storyboard X', producer: DEFAULT_PRODUCER_NAME, producerBrandingConfigured: false, client: '', agency: '', director: '', date: new Date().toISOString().slice(0, 10), ratio: 'landscape', formatLocked: false, showProjectTitle: true, showProducerBranding: true, showClientMeta: false, showAgencyMeta: false, showDirectorMeta: false, showProjectFrame: true, showPageNumber: true, producerLogo: DEFAULT_PRODUCER_LOGO, producerLogoName: 'Logo GRAN BERTA FILMS', clientLogo: '', clientLogoName: '', background: '#ffffff', backgroundImage: '', backgroundImageName: '', backgroundPattern: 'none', backgroundPatternColor: '#c7c7c7', backgroundImageOpacity: 100, backgroundImageBlur: 0, frameTextColor: '#111111', descriptionTextColor: '', descriptionBoxColor: '#000000', padding: MIN_CANVAS_PADDING, gap: 16, defaultFit: 'contain', defaultFrame: 'original', defaultCropAspect: null, showDescriptions: true, infoPlacement: 'below', infoStyle: 'dark', assets: [], pages: [blankPage()] }; }

const FRAME_ASPECTS = Object.freeze({ horizontal: 16 / 9, vertical: 9 / 16, square: 1 });
const FRAME_MODES = new Set(['original', 'horizontal', 'vertical', 'square']);
const FRAME_LABELS = Object.freeze({ original: 'Original', horizontal: 'Horizontal', vertical: 'Vertical', square: 'Cuadrada' });
function validFrameMode(value) { return FRAME_MODES.has(value) ? value : null; }
function frameAspect(mode) { return FRAME_ASPECTS[mode] || null; }
function formatAspect(ratio) { return ratio === 'portrait' ? 9 / 16 : ratio === 'square' ? 1 : 16 / 9; }
function frameModeFromAspect(aspect, fallback = 'horizontal') {
  const target = Number(aspect);
  if (!Number.isFinite(target) || target <= 0) return fallback;
  return Object.entries(FRAME_ASPECTS).reduce((closest, [mode, value]) => {
    const distance = Math.abs(Math.log(target / value));
    return distance < closest.distance ? { mode, distance } : closest;
  }, { mode: fallback, distance: Infinity }).mode;
}
function projectDefaultFrame() {
  if (validFrameMode(project?.defaultFrame)) return project.defaultFrame;
  return project?.defaultFit === 'cover' ? frameModeFromAspect(project.defaultCropAspect || getPageAspect()) : 'original';
}
function frameFields(mode) {
  return mode === 'original' ? { frame: 'original', fit: 'contain', cropAspect: null } : { frame: mode, fit: 'cover', cropAspect: frameAspect(mode) };
}
function renderFrameButtons(selector, modes, activeMode) {
  $$(selector).forEach((button, index) => {
    const mode = modes[index];
    button.hidden = !mode;
    button.dataset.frame = mode || '';
    button.textContent = mode ? FRAME_LABELS[mode] : '';
    button.classList.toggle('is-active', mode === activeMode);
  });
}
function itemFrameMode(item) {
  if (validFrameMode(item?.frame)) return item.frame;
  return item?.fit === 'cover' ? frameModeFromAspect(item.cropAspect || getPageAspect()) : 'original';
}

projects = loadProjects();

function legacyCropAspect(page, data) {
  const count = Number(page.photosPerPage || data.photosPerPage) || 4;
  const effectiveCount = Math.max(count, page.items?.length || 0);
  const direction = page.layoutDirection || data.layoutDirection || 'grid';
  const cols = direction === 'columns' ? count : direction === 'rows' ? Math.ceil(effectiveCount / count) : effectiveCount <= 1 ? 1 : effectiveCount <= 4 ? 2 : 3;
  const rows = direction === 'rows' ? count : Math.ceil(effectiveCount / cols);
  const pad = Math.max(MIN_CANVAS_PADDING, Number(data.padding) || MIN_CANVAS_PADDING);
  const gap = (Number(data.gap) || 0) / 10;
  const w = (100 - pad * 2 - gap * (cols - 1)) / cols;
  const h = (100 - pad * 2 - gap * (rows - 1)) / rows;
  const safe = Math.min(1.6, w * .12, h * .12);
  const imageHeight = h - safe * 2 - (data.infoPlacement === 'below' ? Math.min((h - safe * 2) * .18, 11) : 0);
  return (data.ratio === 'portrait' ? 9 / 16 : data.ratio === 'square' ? 1 : 16 / 9) * (w - safe * 2) / imageHeight;
}

function normalizeProject(data) {
  const base = defaultProject();
  const normalized = { ...base, ...data };
  normalized.id = data.id || createId('project');
  normalized.versionGroupId = data.versionGroupId || normalized.id;
  normalized.versionName = typeof data.versionName === 'string' && data.versionName.trim() ? data.versionName : 'Base';
  normalized.createdAt = data.createdAt || new Date().toISOString();
  normalized.updatedAt = data.updatedAt || normalized.createdAt;
  normalized.producer = DEFAULT_PRODUCER_NAME;
  normalized.producerBrandingConfigured = data.producerBrandingConfigured === true;
  normalized.author = normalized.producer;
  normalized.client = typeof data.client === 'string' ? data.client : '';
  normalized.agency = typeof data.agency === 'string' ? data.agency : '';
  normalized.director = typeof data.director === 'string' ? data.director : '';
  if (normalized.title === 'Mi nuevo video') normalized.title = 'Storyboard X';
  const migrateOldCropDefault = data.version !== 2;
  normalized.version = 2;
  normalized.layoutEngineVersion = 1;
  normalized.layoutEngine = data.layoutEngineVersion === 1 && data.layoutEngine === 'adaptive' ? 'adaptive' : 'grid';
  normalized.formatLocked = typeof data.formatLocked === 'boolean' ? data.formatLocked : true;
  normalized.showProjectTitle = typeof data.showProjectTitle === 'boolean' ? data.showProjectTitle : true;
  normalized.showProducerBranding = normalized.producerBrandingConfigured ? data.showProducerBranding === true : true;
  normalized.showClientMeta = typeof data.showClientMeta === 'boolean' ? data.showClientMeta : false;
  normalized.showAgencyMeta = typeof data.showAgencyMeta === 'boolean' ? data.showAgencyMeta : false;
  normalized.showDirectorMeta = typeof data.showDirectorMeta === 'boolean' ? data.showDirectorMeta : false;
  normalized.showProjectFrame = typeof data.showProjectFrame === 'boolean' ? data.showProjectFrame : false;
  normalized.showPageNumber = typeof data.showPageNumber === 'boolean' ? data.showPageNumber : true;
  normalized.producerLogo = DEFAULT_PRODUCER_LOGO;
  normalized.producerLogoName = 'Logo GRAN BERTA FILMS';
  normalized.clientLogo = typeof data.clientLogo === 'string' ? data.clientLogo : '';
  normalized.clientLogoName = typeof data.clientLogoName === 'string' ? data.clientLogoName : '';
  normalized.background = typeof data.background === 'string' && data.background ? data.background : '#ffffff';
  normalized.backgroundImage = typeof data.backgroundImage === 'string' ? data.backgroundImage : '';
  normalized.backgroundImageName = typeof data.backgroundImageName === 'string' ? data.backgroundImageName : '';
  normalized.backgroundPattern = BACKGROUND_PATTERNS.has(data.backgroundPattern) ? data.backgroundPattern : 'none';
  normalized.backgroundPatternColor = validHexColor(data.backgroundPatternColor, '#c7c7c7');
  normalized.backgroundImageOpacity = Math.max(0, Math.min(100, Number.isFinite(Number(data.backgroundImageOpacity)) ? Number(data.backgroundImageOpacity) : 100));
  normalized.backgroundImageBlur = Math.max(0, Math.min(24, Number.isFinite(Number(data.backgroundImageBlur)) ? Number(data.backgroundImageBlur) : 0));
  normalized.frameTextColor = validHexColor(data.frameTextColor, '#111111');
  normalized.descriptionTextColor = validHexColor(data.descriptionTextColor, '');
  normalized.descriptionBoxColor = validHexColor(data.descriptionBoxColor, '#000000');
  normalized.showDescriptions = true;
  normalized.infoPlacement = ['below', 'overlay', 'none'].includes(data.infoPlacement) ? data.infoPlacement : 'below';
  normalized.infoStyle = data.infoStyle === 'light' ? 'light' : 'dark';
  normalized.padding = Math.max(MIN_CANVAS_PADDING, Number(normalized.padding) || MIN_CANVAS_PADDING);
  if (migrateOldCropDefault) normalized.defaultFit = 'contain';
  normalized.defaultFrame = validFrameMode(data.defaultFrame) ? data.defaultFrame : (normalized.defaultFit === 'cover' ? frameModeFromAspect(data.defaultCropAspect || formatAspect(normalized.ratio)) : 'original');
  normalized.defaultCropAspect = frameAspect(normalized.defaultFrame);
  normalized.defaultFit = normalized.defaultFrame === 'original' ? 'contain' : 'cover';
  normalized.assets = Array.isArray(data.assets) ? data.assets : [];
  normalized.pages = Array.isArray(data.pages) && data.pages.length ? data.pages.map((page, index) => {
    const migratedPage = { ...blankPage(`Página ${index + 1}`), ...page, items: Array.isArray(page.items) ? page.items.map((item, itemIndex) => {
      const legacyFit = migrateOldCropDefault ? 'contain' : (item.fit || normalized.defaultFit);
      const mode = validFrameMode(item.frame) ? item.frame : (legacyFit === 'cover' ? frameModeFromAspect(item.cropAspect || normalized.defaultCropAspect || formatAspect(normalized.ratio)) : 'original');
      const cameraMoveSpill = item.cameraMoveSpill === true;
      const cameraMoveMin = cameraMoveSpill ? -400 : 8;
      const cameraMoveMax = cameraMoveSpill ? 400 : 92;
      const cameraMoveX = Number(item.cameraMoveX);
      const cameraMoveY = Number(item.cameraMoveY);
      return { ...item, ...frameFields(mode), shotType: item.shotType || 'PG', title: item.title || '', description: item.description || '', cameraMove: CAMERA_MOVE_VALUES.has(item.cameraMove) ? item.cameraMove : 'none', cameraMoveMode: 'overlay', cameraMoveX: clamp(Number.isFinite(cameraMoveX) ? cameraMoveX : 50, cameraMoveMin, cameraMoveMax), cameraMoveY: clamp(Number.isFinite(cameraMoveY) ? cameraMoveY : 50, cameraMoveMin, cameraMoveMax), cameraMoveScale: clamp(Number(item.cameraMoveScale) || 1, .45, 1.45), cameraMoveColor: validHexColor(item.cameraMoveColor, '#ff3b30'), cameraMoveSpill, drawingColor: validHexColor(item.drawingColor, validHexColor(item.cameraMoveColor, '#ff3b30')), drawingWidth: clamp(Number(item.drawingWidth) || 2.4, .8, 8), drawingStrokes: normalizeDrawingStrokes(item.drawingStrokes), slot: Number.isFinite(item.slot) ? item.slot : itemIndex };
    }) : [] };
    if (data.layoutEngine !== 'adaptive') migratedPage.items.forEach(item => {
      if (item.fit === 'cover' && !item.cropAspect) item.cropAspect = legacyCropAspect(page, data);
    });
    migratedPage.items.sort((a, b) => a.slot - b.slot);
    renumberItems(migratedPage);
    delete migratedPage.photosPerPage;
    delete migratedPage.layoutDirection;
    return migratedPage;
  }) : [blankPage()];
  delete normalized.photosPerPage;
  delete normalized.layoutDirection;
  return normalized;
}

function migrateLegacy() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (!legacy || !Array.isArray(legacy.shots) || !legacy.shots.length) return null;
    const migrated = defaultProject();
    migrated.title = legacy.title || migrated.title;
    migrated.producer = legacy.author || migrated.producer;
    migrated.author = migrated.producer;
    migrated.date = legacy.date || migrated.date;
    migrated.assets = legacy.shots.filter(shot => shot.image).map((shot, index) => ({ id: `asset-migrated-${index}-${Date.now()}`, name: shot.title || `Foto ${index + 1}`, image: shot.image, width: 1600, height: 900 }));
    return migrated;
  } catch { return null; }
}

function loadProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.assets)) return normalizeProject(saved);
  } catch { /* Use a fresh project below. */ }
  return migrateLegacy() || defaultProject();
}

function loadProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY));
    if (Array.isArray(saved)) return saved.map(normalizeProject);
  } catch { /* Recover from the single-project format below. */ }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.assets)) return [normalizeProject(saved)];
  } catch { /* Start with an empty dashboard below. */ }
  const legacy = migrateLegacy();
  return legacy ? [normalizeProject(legacy)] : [];
}

function projectHasContent(candidate = project) { return !!candidate && (candidate.assets.length > 0 || candidate.pages.some(page => page.items.length > 0)); }
function projectFormatLabel(ratio) { return ratio === 'portrait' ? 'Vertical · 9:16' : ratio === 'square' ? 'Cuadrado · 1:1' : 'Horizontal · 16:9'; }
function projectDateLabel(value) { const date = new Date(value || Date.now()); return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }

function projectGroups() {
  const groups = new Map();
  projects.forEach(entry => {
    const key = entry.versionGroupId || entry.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return [...groups.values()].map(entries => {
    entries.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const base = entries.find(entry => entry.id === entry.versionGroupId) || entries[0];
    return { base, entries, updatedAt: entries.reduce((latest, entry) => Math.max(latest, new Date(entry.updatedAt || 0).getTime()), 0) };
  }).sort((a, b) => {
    if (projectSort === 'title') return (a.base.title || '').localeCompare(b.base.title || '', 'es', { sensitivity: 'base' });
    if (projectSort === 'client') return (a.base.client || '').localeCompare(b.base.client || '', 'es', { sensitivity: 'base' }) || (a.base.title || '').localeCompare(b.base.title || '', 'es', { sensitivity: 'base' });
    return b.updatedAt - a.updatedAt;
  });
}

function currentPage() { return project.pages[currentPageIndex] || project.pages[0]; }
function findItem(id) { return currentPage()?.items.find(item => item.id === id); }
function findAsset(id) { return project.assets.find(asset => asset.id === id); }
function placedAssetIds() { return new Set(project.pages.flatMap(page => page.items.map(item => item.assetId))); }

function saveProject() {
  if (!window.STUDIO_PERMISSIONS?.storyboards) return;
  if (!project) return;
  const candidate = project;
  candidate.updatedAt = new Date().toISOString();
  const index = projects.findIndex(entry => entry.id === candidate.id);
  if (index === -1) projects.unshift(candidate);
  else projects[index] = candidate;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
      localStorage.setItem(CURRENT_PROJECT_KEY, candidate.id);
      writeIndexedDbSnapshot();
    } catch {
      writeIndexedDbSnapshot();
    }
  }, 320);
}

function persistProjects() {
  if (!window.STUDIO_PERMISSIONS?.storyboards) return;
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); writeIndexedDbSnapshot(); } catch { writeIndexedDbSnapshot(); }
}

function openIndexedDb(callback) {
  if (!('indexedDB' in window)) return;
  try {
    const request = window.indexedDB.open(INDEXED_DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('workspace')) request.result.createObjectStore('workspace'); };
    request.onsuccess = () => callback(request.result);
  } catch { /* LocalStorage remains the fallback. */ }
}

function writeIndexedDbSnapshot() {
  openIndexedDb(db => {
    try {
      const transaction = db.transaction('workspace', 'readwrite');
      transaction.objectStore('workspace').put({ projects, updatedAt: new Date().toISOString() }, 'projects');
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    } catch { db.close(); }
  });
}

function hydrateProjectsFromIndexedDb() {
  if (!window.STUDIO_PERMISSIONS?.storyboards || indexedDbHydrationStarted) return;
  indexedDbHydrationStarted = true;
  openIndexedDb(db => {
    try {
      const request = db.transaction('workspace', 'readonly').objectStore('workspace').get('projects');
      request.onsuccess = () => {
        const saved = request.result;
        const localUpdatedAt = projects.reduce((latest, entry) => Math.max(latest, new Date(entry.updatedAt || 0).getTime()), 0);
        const databaseUpdatedAt = new Date(saved?.updatedAt || 0).getTime();
        if (window.STUDIO_PERMISSIONS?.storyboards && Array.isArray(saved?.projects) && saved.projects.length && databaseUpdatedAt >= localUpdatedAt) {
          projects = saved.projects.map(normalizeProject);
          renderDashboard();
        }
        db.close();
      };
      request.onerror = () => db.close();
    } catch { db.close(); }
  });
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function captureUndoState() {
  lastUndoState = { project: JSON.parse(JSON.stringify(project)), currentPageIndex, selectedItemId, selectedItemIds: [...selectedItemIds], selectionAnchorId, activeInspector };
}

function closeDeletePageConfirm() {
  pendingDeletePageIndex = null;
  $('#deletePageConfirmModal').hidden = true;
}
function closeClearPageConfirm() { $('#clearPageConfirmModal').hidden = true; }
function closeClearLibraryConfirm() { $('#clearLibraryConfirmModal').hidden = true; }
function deleteAsset(id) {
  const asset = project?.assets.find(entry => entry.id === id);
  if (!asset) return;
  captureUndoState();
  const deletingSelected = selectedItems().some(item => item.assetId === asset.id);
  project.assets = project.assets.filter(entry => entry.id !== asset.id);
  project.pages.forEach(page => { page.items = page.items.filter(item => item.assetId !== asset.id); renumberItems(page); });
  if (deletingSelected) clearItemSelection();
  activeInspector = 'page';
  render();
  saveProject();
  showToast(`“${asset.name || 'Foto'}” quitada · Ctrl + Z para recuperar`);
}
function confirmClearLibrary() {
  if (!project?.assets.length) { closeClearLibraryConfirm(); return; }
  captureUndoState();
  project.assets = [];
  project.pages.forEach(page => { page.items = []; renumberItems(page); });
  clearItemSelection();
  activeInspector = 'page';
  closeClearLibraryConfirm();
  render();
  saveProject();
  showToast('Biblioteca limpiada · Ctrl + Z para recuperar');
}
function confirmClearPage() {
  if (!project || !currentPage().items.length) { closeClearPageConfirm(); return; }
  captureUndoState();
  currentPage().items = [];
  selectedItemId = null;
  activeInspector = 'page';
  closeClearPageConfirm();
  render();
  saveProject();
  showToast('Página limpiada · Ctrl + Z para recuperar');
}

function restoreLastUndo() {
  if (!lastUndoState || !project) { showToast('No hay una acción para deshacer'); return; }
  project = normalizeProject(lastUndoState.project);
  currentProjectId = project.id;
  currentPageIndex = Math.min(lastUndoState.currentPageIndex, project.pages.length - 1);
  selectedItemId = lastUndoState.selectedItemId;
  selectedItemIds = new Set(lastUndoState.selectedItemIds || (selectedItemId ? [selectedItemId] : []));
  selectionAnchorId = lastUndoState.selectionAnchorId || selectedItemId;
  activeInspector = lastUndoState.activeInspector;
  lastUndoState = null;
  closeDeletePageConfirm();
  closeClearPageConfirm();
  render();
  saveProject();
  showToast('Página recuperada');
}

function pageFormatClass() { return project.ratio === 'portrait' ? 'format-portrait' : project.ratio === 'square' ? 'format-square' : ''; }
function getPageAspect() { return project.ratio === 'portrait' ? 9 / 16 : project.ratio === 'square' ? 1 : 16 / 9; }
function renumberItems(page) { page.items.forEach((item, index) => { item.slot = index; }); }
function descriptionLineCount(item) {
  const description = item.description?.trim() || '';
  return Math.min(5, Math.max(1, description.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 48)), 0)));
}
function photoInfoHeight(item) { return Math.min(40, PHOTO_INFO_OVERLAY_HEIGHT + (descriptionLineCount(item) - 1) * 4); }
function photoInfoMinHeight(item) { return item.description?.trim() ? 48 + (descriptionLineCount(item) - 1) * 16 : 32; }
// Reserve a compact label below the photo without shrinking the photo frame.
// Longer descriptions grow the label gradually and never consume image height.
function captionRatioForItem(item) {
  return Math.min(.36, .16 + (descriptionLineCount(item) - 1) * .045);
}
const layoutCache = new WeakMap();
function pageLayout(page = currentPage()) {
  // The editor treats every non-contain frame as a crop. Keep export geometry
  // on the same rule so legacy items without an explicit `fit` cannot diverge.
  const aspects = page.items.map(item => item.fit === 'contain' ? assetAspect(findAsset(item.assetId)) : (item.cropAspect || getPageAspect()));
  // Only captions placed below photos reserve space in the page layout.
  const captions = project.infoPlacement === 'below';
  const options = { engine: project.layoutEngine, aspect: getPageAspect(), padding: project.padding, gap: project.gap, captions, captionRatios: captions ? page.items.map(captionRatioForItem) : undefined };
  const key = JSON.stringify([aspects, options]);
  const cached = layoutCache.get(page);
  if (cached?.key === key) return cached.rects;
  const rects = StoryboardLayout.arrange(aspects, options);
  rects.forEach((rect, index) => {
    // The grid cell may be shared, but each photo frame keeps its own aspect.
    const photoBox = rect.image;
    const captionHeight = captions ? photoBox.height * captionRatioForItem(page.items[index]) : 0;
    rect.caption = captions ? { x: photoBox.x, y: photoBox.y + photoBox.height, width: photoBox.width, height: captionHeight } : null;
    rect.card = { x: photoBox.x, y: photoBox.y, width: photoBox.width, height: photoBox.height + captionHeight };
  });
  layoutCache.set(page, { key, rects });
  return rects;
}
function assetAspect(asset) {
  const width = Number(asset?.width);
  const height = Number(asset?.height);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

function renderDashboard() {
  const grid = $('#projectGrid');
  if (!grid) return;
  const groups = projectGroups();
  $('#projectCount').textContent = `${groups.length} proyecto${groups.length === 1 ? '' : 's'}`;
  $('#dashboardEmpty').hidden = groups.length > 0;
  $('#projectSort').value = projectSort;
  grid.innerHTML = groups.map((group, index) => {
    const entry = group.base;
    const asset = entry.assets[0];
    const preview = asset ? `<img src="${asset.image}" alt="" />` : '<span class="project-card-empty-mark">▱</span>';
    const pageCount = entry.pages.length;
    const photoCount = entry.assets.length;
    const projectDetails = [['CLIENTE', entry.client], ['AGENCIA', entry.agency], ['PRODUCTORA', entry.producer], ['DIRECTOR', entry.director]].filter(([, value]) => value?.trim());
    const projectDetailsMarkup = projectDetails.length ? `<div class="project-card-details">${projectDetails.map(([label, value]) => `<span><small>${label}</small><strong>${escapeHtml(value)}</strong></span>`).join('')}</div>` : '';
    const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.7 3.7 3.7-.7L18.5 8a2.5 2.5 0 0 0-3.5-3.5L4 16.5Zm9.5-9.5 4 4" /></svg>';
    const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v6m4-6v6" /></svg>';
    return `<article class="project-card" style="--card-index:${index}"><div class="project-card-open" data-open-project="${entry.id}" role="button" tabindex="0"><span class="project-card-preview ${asset ? '' : 'is-empty'}">${preview}<span class="project-card-format">${projectFormatLabel(entry.ratio)}</span></span><span class="project-card-body"><span class="project-card-title-slot"><strong class="project-card-name">${escapeHtml(entry.title || 'Sin título')}</strong><input id="dashboard-title-${entry.id}" class="project-card-title-input" data-project-title="${entry.id}" value="${escapeHtml(entry.title || '')}" placeholder="Título del proyecto" autocomplete="off" hidden /></span>${projectDetailsMarkup}<span class="project-card-meta"><span>${pageCount} página${pageCount === 1 ? '' : 's'}</span><span>${photoCount} foto${photoCount === 1 ? '' : 's'}</span><span>${projectDateLabel(entry.updatedAt)}</span></span></span></div><div class="project-card-actions"><button class="project-card-action project-card-edit" data-edit-project="${entry.id}" type="button" aria-label="Editar nombre del proyecto" title="Editar nombre">${editIcon}</button><button class="project-card-action project-card-delete" data-delete-project="${entry.id}" type="button" aria-label="Eliminar proyecto y sus versiones" title="Eliminar proyecto y sus versiones">${deleteIcon}</button></div></article>`;
  }).join('');
  $$('[data-open-project]', grid).forEach(card => {
    const open = () => { if (!card.classList.contains('is-editing')) openProject(card.dataset.openProject); };
    if (card.matches('button')) card.addEventListener('click', event => { event.stopPropagation(); open(); });
    else {
      card.addEventListener('click', event => { if (!event.target.closest('input,button')) open(); });
      card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('input')) { event.preventDefault(); open(); } });
    }
  });
  $$('[data-edit-project]', grid).forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const card = button.closest('.project-card')?.querySelector('[data-open-project]');
    const input = card?.querySelector('[data-project-title]');
    const title = card?.querySelector('.project-card-name');
    if (!card || !input || !title) return;
    input.dataset.previousValue = input.value;
    card.classList.add('is-editing');
    title.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }));
  $$('[data-project-title]', grid).forEach(input => {
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('input', event => {
      const entry = projects.find(candidate => candidate.id === input.dataset.projectTitle);
      if (!entry) return;
      const groupId = entry.versionGroupId || entry.id;
      projects.filter(candidate => (candidate.versionGroupId || candidate.id) === groupId).forEach(candidate => { candidate.title = event.currentTarget.value; candidate.updatedAt = new Date().toISOString(); });
      entry.updatedAt = new Date().toISOString();
      input.closest('.project-card')?.querySelector('.project-card-name')?.replaceChildren(document.createTextNode(entry.title || 'Sin título'));
      persistProjects();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') {
        event.preventDefault();
        input.value = input.dataset.previousValue || input.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      const card = input.closest('[data-open-project]');
      const title = card?.querySelector('.project-card-name');
      if (title) title.hidden = false;
      input.hidden = true;
      card?.classList.remove('is-editing');
    });
  });
  $$('[data-delete-project]', grid).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openDeleteProjectModal(button.dataset.deleteProject); }));
}

function projectVersions(groupId = project?.versionGroupId || project?.id) {
  return projects.filter(entry => (entry.versionGroupId || entry.id) === groupId).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function renderVersionManager() {
  const list = $('#versionManagerList');
  if (!list || !project) return;
  const versions = projectVersions();
  list.innerHTML = versions.map((version, index) => `<div class="version-manager-row${version.id === project.id ? ' is-current' : ''}" data-version-row="${version.id}"><div class="version-manager-mark">${String(index + 1).padStart(2, '0')}</div><div class="version-manager-copy"><input class="version-manager-name" data-version-name="${version.id}" value="${escapeHtml(version.versionName || 'Base')}" aria-label="Nombre de la versión" /><small>${projectFormatLabel(version.ratio)} · ${version.pages.length} página${version.pages.length === 1 ? '' : 's'} · ${version.assets.length} foto${version.assets.length === 1 ? '' : 's'}</small></div><button class="button button-ghost button-small" data-open-version="${version.id}" type="button">Abrir</button><button class="button button-danger button-small" data-delete-version="${version.id}" type="button"${versions.length === 1 ? ' disabled' : ''}>Eliminar</button></div>`).join('');
  $$('[data-version-name]', list).forEach(input => input.addEventListener('change', event => {
    const entry = projects.find(candidate => candidate.id === event.target.dataset.versionName);
    if (!entry) return;
    const value = event.target.value.trim();
    entry.versionName = value || (entry.id === entry.versionGroupId ? 'Base' : projectFormatLabel(entry.ratio).split(' · ')[0]);
    entry.updatedAt = new Date().toISOString();
    if (project.id === entry.id) project.versionName = entry.versionName;
    persistProjects();
    renderVersionManager();
    showToast('Nombre de versión actualizado');
  }));
  $$('[data-open-version]', list).forEach(button => button.addEventListener('click', () => { closeVersionsModal(); openProject(button.dataset.openVersion); }));
  $$('[data-delete-version]', list).forEach(button => button.addEventListener('click', () => openDeleteVersionModal(button.dataset.deleteVersion)));
}

function openVersionsModal() { if (!project) return; renderVersionManager(); $('#versionsModal').hidden = false; }
function closeVersionsModal() { $('#versionsModal').hidden = true; }
function openDeleteVersionModal(id) {
  const versions = projectVersions();
  const entry = versions.find(candidate => candidate.id === id);
  if (!entry || versions.length === 1) return;
  pendingDeleteVersionId = id;
  $('#deleteVersionName').textContent = entry.versionName || projectFormatLabel(entry.ratio);
  $('#deleteVersionModal').hidden = false;
}
function closeDeleteVersionModal() { pendingDeleteVersionId = null; $('#deleteVersionModal').hidden = true; }
function confirmDeleteVersion() {
  if (!pendingDeleteVersionId) return;
  const entry = projects.find(candidate => candidate.id === pendingDeleteVersionId);
  const groupId = entry?.versionGroupId || pendingDeleteVersionId;
  const versions = projectVersions(groupId);
  if (!entry || versions.length <= 1) { closeDeleteVersionModal(); return; }
  const fallback = versions.find(candidate => candidate.id !== entry.id);
  projects = projects.filter(candidate => candidate.id !== entry.id);
  persistProjects();
  closeDeleteVersionModal();
  if (project?.id === entry.id) {
    closeVersionsModal();
    openProject(fallback.id);
  } else {
    renderVersionManager();
  }
  showToast(`Versión ${entry.versionName || projectFormatLabel(entry.ratio)} eliminada`);
}

function showDashboard() {
  if (!window.STUDIO_PERMISSIONS?.storyboards) return false;
  if (project) saveProject();
  project = null;
  lastUndoState = null;
  closeDeletePageConfirm();
  closeVersionsModal();
  closeDeleteVersionModal();
  currentProjectId = null;
  $('#dashboardView').hidden = false;
  $('#editorView').hidden = true;
  $('#reviewsView').hidden = true;
  $('#reviewsHome').hidden = true;
  document.body.classList.remove('reviews-open');
  document.body.classList.remove('reviews-hud-hidden');
  document.body.classList.remove('public-review');
  $('#storyboardsNav').classList.add('is-active');
  $('#reviewsNav').classList.remove('is-active');
  $('#backToDashboardBtn').hidden = true;
  $('#manageVersionsBtn').hidden = true;
  $('#createVersionBtn').hidden = true;
  $('#exportBtn').hidden = true;
  $('#breadcrumbTitle').textContent = 'Todos los proyectos';
  renderDashboard();
  return true;
}

function showEditor() {
  if (!window.STUDIO_PERMISSIONS?.storyboards) return false;
  $('#dashboardView').hidden = true;
  $('#editorView').hidden = false;
  $('#reviewsView').hidden = true;
  $('#reviewsHome').hidden = true;
  document.body.classList.remove('reviews-open');
  document.body.classList.remove('reviews-hud-hidden');
  document.body.classList.remove('public-review');
  $('#storyboardsNav').classList.add('is-active');
  $('#reviewsNav').classList.remove('is-active');
  $('#backToDashboardBtn').hidden = false;
  $('#manageVersionsBtn').hidden = false;
  $('#createVersionBtn').hidden = false;
  $('#exportBtn').hidden = false;
  $('#breadcrumbTitle').textContent = project?.title || 'Sin título';
  queueMicrotask(optimizeCurrentBackgroundImage);
  return true;
}

function openDeleteProjectModal(id) {
  const entry = projects.find(candidate => candidate.id === id);
  if (!entry) return;
  pendingDeleteProjectId = id;
  $('#deleteProjectName').textContent = entry.title || 'Sin título';
  $('#deleteProjectModal').hidden = false;
}
function closeDeleteProjectModal() { pendingDeleteProjectId = null; $('#deleteProjectModal').hidden = true; }
function confirmDeleteProject() {
  if (!pendingDeleteProjectId) return;
  const entry = projects.find(candidate => candidate.id === pendingDeleteProjectId);
  const groupId = entry?.versionGroupId || pendingDeleteProjectId;
  projects = projects.filter(candidate => (candidate.versionGroupId || candidate.id) !== groupId);
  persistProjects();
  if (entry && (project?.versionGroupId || currentProjectId) === groupId) { project = null; currentProjectId = null; }
  closeDeleteProjectModal();
  renderDashboard();
  showToast(`${entry?.title || 'Proyecto'}${entry && projects.length ? '' : ''} eliminado`);
}

function openProject(id) {
  if (!window.STUDIO_PERMISSIONS?.storyboards) return;
  const stored = projects.find(entry => entry.id === id);
  if (!stored) return;
  project = normalizeProject(stored);
  lastUndoState = null;
  currentProjectId = project.id;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
  showEditor();
  render();
  if (!project.formatLocked) openFormatModal();
}
function itemLayout(item, page = currentPage()) {
  return pageLayout(page)[page.items.indexOf(item)];
}
function slotAtPoint(clientX, clientY) {
  const rect = $('#canvasPage').getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const x = (clientX - rect.left) / rect.width * 100;
  const y = (clientY - rect.top) / rect.height * 100;
  const layouts = pageLayout();
  if (!layouts.length) return 0;
  let closest = 0;
  let distance = Infinity;
  layouts.forEach(({ card }, index) => {
    const dx = Math.max(card.x - x, 0, x - card.x - card.width) * getPageAspect();
    const dy = Math.max(card.y - y, 0, y - card.y - card.height);
    const candidate = dx * dx + dy * dy;
    if (candidate < distance) { closest = index; distance = candidate; }
  });
  if (slotDrag && !slotDrag.duplicate) return closest;
  const target = layouts[closest].card;
  return closest + (x > target.x + target.width / 2 || y > target.y + target.height ? 1 : 0);
}

function cameraMoveSvg(move, itemId, className = '') {
  const markerId = `camera-arrow-${String(itemId).replace(/[^a-z0-9_-]/gi, '')}`;
  const straight = paths => paths.map(path => `<path d="${path}" marker-end="url(#${markerId})" />`).join('');
  let paths = '';
  if (move.value === 'zoom-in' || move.value === 'dolly-in') paths = straight(['M8 8 L35 35', 'M92 8 L65 35', 'M8 92 L35 65', 'M92 92 L65 65']);
  if (move.value === 'zoom-out' || move.value === 'dolly-out') paths = straight(['M35 35 L8 8', 'M65 35 L92 8', 'M35 65 L8 92', 'M65 65 L92 92']);
  if (move.value === 'pan-left') paths = straight(['M90 66 Q50 88 10 66']);
  if (move.value === 'pan-right') paths = straight(['M10 66 Q50 88 90 66']);
  if (move.value === 'tilt-up') paths = straight(['M72 90 Q90 50 72 10']);
  if (move.value === 'tilt-down') paths = straight(['M72 10 Q90 50 72 90']);
  if (move.value === 'track-left') paths = straight(['M90 40 L10 40', 'M90 62 L10 62']);
  if (move.value === 'track-right') paths = straight(['M10 40 L90 40', 'M10 62 L90 62']);
  if (move.value === 'dolly-in' || move.value === 'dolly-out') paths += '<rect x="31" y="31" width="38" height="38" rx="2" />';
  return `<svg class="${className}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="${markerId}" viewBox="0 0 8 8" refX="6.8" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker></defs><g>${paths}</g></svg>`;
}

function cameraMoveMarkup(item) {
  const move = cameraMoveInfo(item.cameraMove);
  if (move.value === 'none') return '';
  const editing = annotationToolMode === 'move' && selectedItemId === item.id;
  return `<div class="camera-move-overlay camera-move-${move.value}${item.cameraMoveSpill ? ' camera-spill' : ''}${editing ? ' is-editing' : ''}" data-camera-overlay="${item.id}" style="--camera-x:${item.cameraMoveX ?? 50}%;--camera-y:${item.cameraMoveY ?? 50}%;--camera-scale:${item.cameraMoveScale ?? 1};--camera-color:${validHexColor(item.cameraMoveColor, '#ff3b30')}" title="${editing ? 'Arrastrá para mover las flechas' : `Movimiento de cámara: ${escapeHtml(move.label)}`}">${cameraMoveSvg(move, item.id)}</div>`;
}

function drawingPathData(points) {
  if (!points?.length) return '';
  if (points.length === 1) return `M${points[0].x} ${points[0].y} l.01 .01`;
  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const midpoint = { x: (points[index].x + points[index + 1].x) / 2, y: (points[index].y + points[index + 1].y) / 2 };
    path += ` Q${points[index].x} ${points[index].y} ${midpoint.x} ${midpoint.y}`;
  }
  const last = points.at(-1);
  return `${path} L${last.x} ${last.y}`;
}

function drawingMarkup(item) {
  const strokes = normalizeDrawingStrokes(item.drawingStrokes);
  const editing = annotationToolMode === 'draw' && selectedItemId === item.id;
  const paths = strokes.map(stroke => `<path data-stroke-id="${stroke.id}" d="${drawingPathData(stroke.points)}" stroke="${stroke.color}" stroke-width="${stroke.width}" />`).join('');
  return `<svg class="photo-drawing-layer${editing ? ' is-editing' : ''}" data-drawing-layer="${item.id}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Dibujo sobre la foto">${paths}</svg>`;
}

function itemImageBox(item, layout) {
  return layout.image;
}

function boxStyleWithinCard(box, card) {
  return `position:absolute;left:${(box.x - card.x) / card.width * 100}%;top:${(box.y - card.y) / card.height * 100}%;width:${box.width / card.width * 100}%;height:${box.height / card.height * 100}%;`;
}

function itemMarkup(item, page = currentPage()) {
  const asset = findAsset(item.assetId); if (!asset) return '';
  const label = itemDisplayTitle(item, asset);
  const number = String((item.slot ?? 0) + 1).padStart(2, '0');
  const layout = itemLayout(item, page);
  const imageBox = itemImageBox(item, layout);
  const imageStyle = boxStyleWithinCard(imageBox, layout.card);
  const captionStyle = layout.caption ? boxStyleWithinCard(layout.caption, layout.card) : '';
  const description = item.description?.trim() || '';
  const overlayInfo = project.infoPlacement === 'overlay';
  const belowInfo = project.infoPlacement === 'below';
  const showInfo = project.infoPlacement !== 'none';
  const infoStyleClass = `description-style-${project.infoStyle || 'dark'}`;
  const descriptionTextColor = project.descriptionTextColor || (project.infoStyle === 'light' ? '#000000' : '#ffffff');
  const infoMarkup = showInfo ? `<div class="description-box has-description-color ${overlayInfo ? 'description-overlay ' : ''}${infoStyleClass} ${description ? '' : 'is-empty'}" style="${overlayInfo ? `height:${photoInfoHeight(item)}%;min-height:${photoInfoMinHeight(item)}px;` : captionStyle}--description-text-color:${descriptionTextColor};--description-box-color:${colorWithAlpha(project.descriptionBoxColor, .72)};"><strong>${escapeHtml(label)}</strong><small class="description-editor" contenteditable="true" spellcheck="false">${escapeHtml(description)}</small></div>` : '';
  return `<div class="design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'}${item.cameraMoveSpill ? ' has-camera-spill' : ''} ${itemIsSelected(item) ? 'is-selected' : ''}" data-item-id="${item.id}" style="left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%;display:block" draggable="false">
    <div class="design-photo${item.cameraMoveSpill ? ' camera-spill' : ''}" style="${imageStyle}"><img src="${asset.image}" alt="${escapeHtml(label)}" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span class="item-number">${number}</span>${drawingMarkup(item)}${cameraMoveMarkup(item)}${overlayInfo ? infoMarkup : ''}</div>
    ${belowInfo ? infoMarkup : ''}
  </div>`;
}

function storyboardMetaMarkup(pageNumber = currentPageIndex + 1, totalPages = project.pages.length) {
  const producer = project.showProducerBranding && (project.producer?.trim() || project.producerLogo);
  const details = [
    project.showClientMeta && project.client?.trim() ? ['CLIENTE', project.client] : null,
    project.showAgencyMeta && project.agency?.trim() ? ['AGENCIA', project.agency] : null,
    project.showDirectorMeta && project.director?.trim() ? ['DIRECTOR', project.director] : null
  ].filter(Boolean);
  const producerLogoSource = project.producerLogo ? resolveMediaSource(project.producerLogo).replaceAll('"', '%22').replaceAll("'", '%27') : '';
  const producerMarkup = producer ? `<span class="storyboard-meta-producer">${producerLogoSource ? `<span class="storyboard-meta-logo" style="--producer-logo:url('${escapeHtml(producerLogoSource)}')"></span>` : ''}${project.producer?.trim() ? `<strong>${escapeHtml(DEFAULT_PRODUCER_NAME)}</strong>` : ''}</span>` : '';
  const titleMarkup = project.showProjectTitle && project.title.trim() ? `<strong class="storyboard-meta-title">${escapeHtml(project.title)}</strong>` : '';
  const detailsMarkup = details.map(([label, value]) => `<span>${label === 'CLIENTE' && project.clientLogo ? `<img class="storyboard-meta-client-logo" src="${project.clientLogo}" alt="" />` : ''}<small>${label}</small><strong>${escapeHtml(value)}</strong></span>`).join('');
  const pageMarkup = project.showPageNumber ? `<strong class="storyboard-meta-page">${String(pageNumber).padStart(2, '0')}</strong>` : '';
  const topContent = producerMarkup || titleMarkup ? `<div class="storyboard-meta-top"><span class="storyboard-meta-rule"></span>${producerMarkup}${producerMarkup && titleMarkup ? '<span class="storyboard-meta-rule"></span>' : ''}${titleMarkup}<span class="storyboard-meta-rule"></span></div>` : '';
  const bottomContent = detailsMarkup || pageMarkup ? `<div class="storyboard-meta-bottom"><span class="storyboard-meta-rule"></span>${detailsMarkup ? `<div class="storyboard-meta-details">${detailsMarkup}</div>` : ''}${detailsMarkup && pageMarkup ? '<span class="storyboard-meta-rule"></span>' : ''}${pageMarkup}<span class="storyboard-meta-rule"></span></div>` : '';
  const frameTextColor = project.frameTextColor || '#111111';
  return `<div class="storyboard-meta-frame ${project.showProjectFrame ? '' : 'is-frame-hidden'}" style="--frame-text-color:${frameTextColor};--frame-rule-color:${colorWithAlpha(frameTextColor, .68)}" aria-hidden="true">${topContent}${bottomContent}</div>`;
}

function renderLibrary() {
  const placed = placedAssetIds();
  $('#assetCount').textContent = project.assets.length;
  $('#clearLibraryBtn').hidden = !project.assets.length;
  $('#libraryEmpty').hidden = !!project.assets.length;
  $('#assetGrid').innerHTML = project.assets.map((asset, index) => `<div class="asset-thumb ${placed.has(asset.id) ? 'is-placed' : ''}" draggable="true" data-asset-id="${asset.id}" title="${escapeHtml(asset.name)}"><img src="${asset.image}" alt="${escapeHtml(asset.name)}" /><span class="asset-thumb-index">${String(index + 1).padStart(2, '0')}</span><div class="asset-thumb-actions"><button class="asset-thumb-action" data-add-asset="${asset.id}" type="button" title="Agregar al artboard" aria-label="Agregar ${escapeHtml(asset.name)}">＋</button><button class="asset-thumb-delete" data-delete-asset="${asset.id}" type="button" title="Quitar de la biblioteca" aria-label="Quitar ${escapeHtml(asset.name)}">×</button></div></div>`).join('');
  $$('.asset-thumb').forEach(thumb => {
    thumb.addEventListener('dragstart', event => { draggedAssetId = thumb.dataset.assetId; slotMode = true; thumb.classList.add('is-dragging'); renderPage(); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', draggedAssetId); });
    thumb.addEventListener('dragend', () => { draggedAssetId = null; slotMode = false; hoverSlotIndex = null; thumb.classList.remove('is-dragging'); renderPage(); });
    thumb.addEventListener('dblclick', () => addAssetToPage(thumb.dataset.assetId));
    thumb.querySelector('[data-add-asset]')?.addEventListener('click', event => { event.stopPropagation(); addAssetToPage(thumb.dataset.assetId); });
    thumb.querySelector('[data-delete-asset]')?.addEventListener('click', event => { event.stopPropagation(); deleteAsset(thumb.dataset.assetId); });
  });
}

function fitCanvasPage() {
  const pageElement = $('#canvasPage');
  const stage = $('#canvasStage');
  if (!pageElement || !stage || !stage.clientWidth || !stage.clientHeight) return;
  const aspect = getPageAspect();
  const width = Math.max(0, Math.min(stage.clientWidth, stage.clientHeight * aspect));
  const height = width / aspect;
  pageElement.style.width = `${width}px`;
  pageElement.style.height = `${height}px`;
}

function renderPage() {
  const page = currentPage();
  $('#canvasPage').className = `canvas-page ${pageFormatClass()} ${slotMode ? 'is-slot-mode' : ''}`;
  const guides = slotMode ? pageLayout(page).map(({ card: rect }, index) => `<div class="slot-guide" data-slot-index="${index}" style="left:${rect.x}%;top:${rect.y}%;width:${rect.width}%;height:${rect.height}%"><span>${String(index + 1).padStart(2, '0')}</span></div>`).join('') : '';
  const content = page?.items.length ? page.items.map(item => itemMarkup(item, page)).join('') : '<div class="empty-page"><div><span>▱</span><strong>Tu artboard está vacío</strong><small>Arrastrá una foto desde la biblioteca</small></div></div>';
  $('#canvasPage').innerHTML = guides + content + storyboardMetaMarkup();
  applyArtboardBackground($('#canvasPage'));
  $$('.design-item').forEach(item => bindDesignItem(item));
  $$('[data-camera-overlay]').forEach(overlay => bindCameraOverlay(overlay));
  $$('[data-drawing-layer]').forEach(layer => bindDrawingLayer(layer));
  $$('.description-editor').forEach(editor => {
    editor.addEventListener('pointerdown', event => event.stopPropagation());
    editor.addEventListener('click', event => event.stopPropagation());
    editor.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); editor.blur(); } });
    editor.addEventListener('input', event => { const item = findItem(editor.closest('.design-item')?.dataset.itemId); if (!item) return; item.description = event.currentTarget.textContent.trim(); $('#photoDescription').value = item.description; const box = editor.closest('.description-box'); box.classList.toggle('is-empty', !item.description); box.style.setProperty('--description-box-color', colorWithAlpha(project.descriptionBoxColor, .72)); if (project.infoPlacement === 'overlay') box.style.height = `${photoInfoHeight(item)}%`; saveProject(); });
    editor.addEventListener('blur', () => { if (project.infoPlacement !== 'overlay') renderPage(); });
  });
  $('#pageNumber').textContent = currentPageIndex + 1;
  $('#pageTotal').textContent = project.pages.length;
  $('#prevPageBtn').disabled = currentPageIndex === 0;
  $('#nextPageBtn').disabled = currentPageIndex >= project.pages.length - 1;
  $('#pagePhotoCount').textContent = `${page.items.length} foto${page.items.length === 1 ? '' : 's'} en esta página`;
  const selectionCount = selectedItems().length;
  $('#selectionStatus').textContent = selectionCount > 1 ? `${selectionCount} fotos seleccionadas · elegí un encuadre para aplicarlo a todas` : selectionCount === 1 ? 'Foto seleccionada · arrastrá para cambiar su lugar en la secuencia' : 'Las fotos se acomodan automáticamente al agregarlas o quitarlas';
  $('#selectionStatus').classList.toggle('photo-selected', selectionCount > 0);
  renderPageCarousel();
  updateSlotGuides();
  requestAnimationFrame(fitCanvasPage);
}

function pageThumbnailMarkup(page) {
  if (!page.items.length) return '<div class="page-thumb-empty">Página vacía</div>';
  return page.items.map(item => {
    const asset = findAsset(item.assetId); if (!asset) return '';
    const layout = itemLayout(item, page);
    const label = itemDisplayTitle(item, asset);
    const number = String((item.slot ?? 0) + 1).padStart(2, '0');
    const imageBox = itemImageBox(item, layout);
    const imageStyle = boxStyleWithinCard(imageBox, layout.card);
    const captionStyle = layout.caption ? boxStyleWithinCard(layout.caption, layout.card) : '';
    const overlayInfo = project.infoPlacement === 'overlay';
    const belowInfo = project.infoPlacement === 'below';
    const showInfo = project.infoPlacement !== 'none';
    const descriptionTextColor = project.descriptionTextColor || (project.infoStyle === 'light' ? '#000000' : '#ffffff');
    const caption = showInfo ? `<div class="page-thumb-caption has-description-color ${overlayInfo ? 'page-thumb-caption-overlay ' : ''}page-thumb-caption-style-${project.infoStyle || 'dark'}" style="${overlayInfo ? `height:${photoInfoHeight(item)}%;` : captionStyle}--description-text-color:${descriptionTextColor};--description-box-color:${colorWithAlpha(project.descriptionBoxColor, .72)};">${escapeHtml(label)}</div>` : '';
    const objectFit = item.fit === 'cover' ? 'cover' : 'contain';
    return `<div class="page-thumb-item" style="left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%;display:block"><div class="page-thumb-photo" style="${imageStyle}"><img src="${asset.image}" alt="" style="object-fit:${objectFit};object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span>${number}</span>${overlayInfo ? caption : ''}</div>${belowInfo ? caption : ''}</div>`;
  }).join('');
}

function addNewPage() {
  project.pages.push(blankPage(`Página ${project.pages.length + 1}`));
  currentPageIndex = project.pages.length - 1;
  selectedItemId = null;
  activeInspector = 'page';
  render();
  saveProject();
  showToast('Página nueva agregada');
}

function cloneStoryboardItem(item) {
  return { ...item, id: createId('item'), drawingStrokes: normalizeDrawingStrokes(item.drawingStrokes).map(stroke => ({ ...stroke, id: createId('stroke'), points: stroke.points.map(point => ({ ...point })) })) };
}

function duplicatePage(source) {
  return {
    ...source,
    id: createId('page'),
    title: `${source.title || 'Página'} · copia`,
    items: source.items.map(cloneStoryboardItem)
  };
}

function duplicatePageAt(sourceIndex) {
  if (!project.pages[sourceIndex]) return;
  captureUndoState();
  const copy = duplicatePage(project.pages[sourceIndex]);
  project.pages.splice(sourceIndex + 1, 0, copy);
  currentPageIndex = sourceIndex + 1;
  selectedItemId = null;
  activeInspector = 'page';
  closePageMenus();
  render();
  saveProject();
  showToast('Página copiada');
}

function removePageAt(pageIndex) {
  if (project.pages.length <= 1) { showToast('El proyecto necesita al menos una página'); return false; }
  if (!project.pages[pageIndex]) return false;
  captureUndoState();
  project.pages.splice(pageIndex, 1);
  currentPageIndex = Math.min(pageIndex, project.pages.length - 1);
  selectedItemId = null;
  activeInspector = 'page';
  closePageMenus();
  render();
  saveProject();
  showToast('Página eliminada · Ctrl + Z para recuperar');
  return true;
}

function closePageMenus() { $$('.page-thumb-wrap.is-menu-open').forEach(wrapper => { wrapper.classList.remove('is-menu-open'); const menu = wrapper.querySelector('.page-thumb-menu'); if (menu) { menu.classList.remove('opens-up'); menu.style.left = ''; menu.style.top = ''; } }); }

function pageIndexAtPoint(clientX, clientY, track) {
  return [...track.querySelectorAll('[data-page-index]')].map(button => ({ button, rect: button.getBoundingClientRect() })).find(({ rect }) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
}

function startPageDuplicateDrag(sourceIndex, event, track) {
  event.preventDefault();
  event.stopPropagation();
  let moved = false;
  document.body.classList.add('is-page-dragging');
  const onMove = moveEvent => { moved ||= Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) > 8; };
  const finish = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancel);
    document.body.classList.remove('is-page-dragging');
  };
  const onUp = upEvent => {
    const target = pageIndexAtPoint(upEvent.clientX, upEvent.clientY, track);
    if (moved && target) {
      const targetIndex = Number(target.button.dataset.pageIndex);
      const targetRect = target.button.getBoundingClientRect();
      const insertIndex = targetIndex + (upEvent.clientX > targetRect.left + targetRect.width / 2 ? 1 : 0);
      const copy = duplicatePage(project.pages[sourceIndex]);
      project.pages.splice(Math.min(insertIndex, project.pages.length), 0, copy);
      currentPageIndex = Math.min(insertIndex, project.pages.length - 1);
      selectedItemId = null;
      activeInspector = 'page';
      finish(); render(); saveProject(); showToast('Página duplicada');
      return;
    }
    finish();
  };
  const cancel = () => finish();
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
  document.addEventListener('pointercancel', cancel, { once: true });
}

function renderPageCarousel() {
  const track = $('#pageCarouselTrack');
  if (!track) return;
  $('#carouselCount').textContent = `${project.pages.length} página${project.pages.length === 1 ? '' : 's'}`;
  track.innerHTML = `${project.pages.map((page, index) => `<div class="page-thumb-wrap"><button class="page-thumb ${index === currentPageIndex ? 'is-active' : ''}" data-page-index="${index}" type="button"><span class="page-thumb-canvas ${pageFormatClass()}">${pageThumbnailMarkup(page)}</span><span class="page-thumb-label">${String(index + 1).padStart(2, '0')} · ${escapeHtml(page.title || `Página ${index + 1}`)}</span></button><button class="page-thumb-menu-button" data-page-menu type="button" aria-label="Opciones de ${escapeHtml(page.title || `Página ${index + 1}`)}" title="Opciones">⋯</button><div class="page-thumb-menu" role="menu"><button data-copy-page="${index}" type="button" role="menuitem">Duplicar</button><button data-export-page-png="${index}" type="button" role="menuitem">Exportar rápido como PNG</button><button data-delete-page-menu="${index}" type="button" role="menuitem" ${project.pages.length <= 1 ? 'disabled' : ''}>Eliminar</button></div></div>`).join('')}<button class="page-thumb page-thumb-add" data-add-page type="button" aria-label="Agregar nueva página"><span class="page-thumb-canvas page-thumb-add-canvas ${pageFormatClass()}"><span class="page-thumb-add-symbol">＋</span></span><span class="page-thumb-label">＋ Nueva página</span></button>`;
  $$('.page-thumb-canvas:not(.page-thumb-add-canvas)', track).forEach(applyArtboardBackground);
  $$('[data-page-index]', track).forEach(button => {
    button.addEventListener('pointerdown', event => { if (event.altKey) startPageDuplicateDrag(Number(button.dataset.pageIndex), event, track); });
    button.addEventListener('click', () => { if (document.body.classList.contains('is-page-dragging')) return; currentPageIndex = Number(button.dataset.pageIndex); selectedItemId = null; activeInspector = 'page'; render(); });
  });
  $$('[data-page-menu]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); const wrapper = button.closest('.page-thumb-wrap'); const menu = wrapper.querySelector('.page-thumb-menu'); const wasOpen = wrapper.classList.contains('is-menu-open'); closePageMenus(); if (!wasOpen) { const rect = button.getBoundingClientRect(); wrapper.classList.add('is-menu-open'); menu.style.left = '0px'; menu.style.top = '0px'; const origin = menu.getBoundingClientRect(); const menuHeight = origin.height; const opensUp = window.innerHeight - rect.bottom < menuHeight + 10; const desiredLeft = Math.max(6, Math.min(window.innerWidth - 210, rect.right - 202)); const desiredTop = opensUp ? Math.max(6, rect.top - menuHeight - 4) : Math.min(window.innerHeight - menuHeight - 6, rect.bottom + 4); menu.classList.toggle('opens-up', opensUp); menu.style.left = `${desiredLeft - origin.left}px`; menu.style.top = `${desiredTop - origin.top}px`; } }));
  $$('[data-copy-page]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); duplicatePageAt(Number(button.dataset.copyPage)); }));
  $$('[data-export-page-png]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); const pageIndex = Number(button.dataset.exportPagePng); closePageMenus(); exportPageAsPng(pageIndex); }));
  $$('[data-delete-page-menu]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); removePageAt(Number(button.dataset.deletePageMenu)); }));
  $('[data-add-page]', track)?.addEventListener('click', addNewPage);
}

function applyBackgroundPreview() {
  const preview = $('#backgroundPreview');
  preview.hidden = !project.backgroundImage;
  preview.style.backgroundColor = project.background || '#ffffff';
  let image = preview.querySelector('.background-preview-photo');
  if (!project.backgroundImage) { image?.remove(); preview.title = ''; return; }
  if (!image) {
    image = document.createElement('img');
    image.className = 'background-preview-photo';
    image.alt = '';
    preview.appendChild(image);
  }
  if (image._backgroundSource !== project.backgroundImage) {
    image.src = resolveMediaSource(project.backgroundImage);
    image._backgroundSource = project.backgroundImage;
  }
  const blur = Math.min(8, (project.backgroundImageBlur ?? 0) / 3);
  const previewSide = Math.max(1, Math.min(preview.clientWidth || 180, preview.clientHeight || 64));
  image.style.opacity = String((project.backgroundImageOpacity ?? 100) / 100);
  image.style.filter = blur ? `blur(${blur}px)` : 'none';
  image.style.transform = blur ? `scale(${1 + blur * 2 / previewSide})` : 'none';
  preview.title = project.backgroundImageName || 'Foto de fondo cargada';
}

function renderControls() {
  $('#projectTitle').value = project.title;
  $('#projectProducer').value = DEFAULT_PRODUCER_NAME;
  $('#projectProducer').readOnly = true;
  $('#projectTitleDisplay').textContent = project.title || 'Sin título';
  $('#projectProducerDisplay').textContent = DEFAULT_PRODUCER_NAME;
  $('#projectProducerLabel').hidden = false;
  $('#projectClient').value = project.client || '';
  $('#projectAgency').value = project.agency || '';
  $('#projectDirector').value = project.director || '';
  $('#breadcrumbTitle').textContent = project.title || 'Sin título';
  $('#editorView').classList.toggle('is-portrait-layout', project.ratio === 'portrait');
  $('#backgroundColor').value = project.background;
  $('#backgroundValue').textContent = project.background.toUpperCase();
  $('#backgroundPattern').value = project.backgroundPattern || 'none';
  $('#backgroundPatternColor').value = project.backgroundPatternColor || '#c7c7c7';
  $('#backgroundPatternColorValue').textContent = (project.backgroundPatternColor || '#c7c7c7').toUpperCase();
  $('#backgroundPatternColorControls').hidden = !project.backgroundPattern || project.backgroundPattern === 'none';
  $('#backgroundImageControls').hidden = !project.backgroundImage;
  $('#backgroundImageOpacity').value = project.backgroundImageOpacity ?? 100;
  $('#backgroundImageOpacityValue').textContent = `${project.backgroundImageOpacity ?? 100}%`;
  $('#backgroundImageBlur').value = project.backgroundImageBlur ?? 0;
  $('#backgroundImageBlurValue').textContent = `${project.backgroundImageBlur ?? 0} px`;
  $('#removeBackgroundImageBtn').disabled = !project.backgroundImage;
  applyBackgroundPreview();
  $('#pageGap').value = project.gap;
  $('#pageGapValue').textContent = `${project.gap} px`;
  $('#pagePadding').value = project.padding;
  $('#pagePaddingValue').textContent = `${project.padding}%`;
  $('#layoutEngine').value = project.layoutEngine || 'grid';
  $('#layoutModeLabel').textContent = project.layoutEngine === 'adaptive' ? '✦ Distribución adaptable' : '✦ Grilla equitativa';
  $('#autoLayoutStatus').title = project.layoutEngine === 'adaptive' ? 'Las fotos se distribuyen según sus proporciones' : 'La grilla equitativa elige la mejor cantidad de filas y columnas para aprovechar el canvas';
  $('#infoPlacement').value = project.infoPlacement || 'below';
  $('#descriptionBoxColor').value = project.descriptionBoxColor || '#000000';
  $('#descriptionBoxColorValue').textContent = (project.descriptionBoxColor || '#000000').toUpperCase();
  $('#frameTextColor').value = project.frameTextColor || '#111111';
  $('#frameTextColorValue').textContent = (project.frameTextColor || '#111111').toUpperCase();
  const descriptionTextColor = project.descriptionTextColor || (project.infoStyle === 'light' ? '#000000' : '#ffffff');
  $('#descriptionTextColor').value = descriptionTextColor;
  $('#descriptionTextColorValue').textContent = descriptionTextColor.toUpperCase();
  $('#showProjectTitle').checked = project.showProjectTitle;
  $('#showProducerBranding').checked = project.showProducerBranding;
  $('#showProjectFrame').checked = project.showProjectFrame;
  $('#showClientMeta').checked = project.showClientMeta;
  $('#showAgencyMeta').checked = project.showAgencyMeta;
  $('#showDirectorMeta').checked = project.showDirectorMeta;
  $('#showPageNumber').checked = project.showPageNumber;
  $('#producerLogoPreview').hidden = false;
  $('#producerLogoPreview').innerHTML = `<img src="${DEFAULT_PRODUCER_LOGO}" alt="" /><span>Logo fijo · GRAN BERTA FILMS</span>`;
  $('#producerLogoBtn').hidden = true;
  $('#removeProducerLogoBtn').hidden = true;
  $('#clientLogoPreview').hidden = !project.clientLogo;
  $('#clientLogoPreview').innerHTML = project.clientLogo ? `<img src="${project.clientLogo}" alt="" /><span>${escapeHtml(project.clientLogoName || 'Logo cargado')}</span>` : '';
  $('#removeClientLogoBtn').disabled = !project.clientLogo;
  $$('.format-btn').forEach(button => { button.classList.toggle('is-active', button.dataset.format === project.ratio); button.disabled = project.formatLocked; button.title = project.formatLocked ? 'El formato queda fijo durante este proyecto' : 'Elegí el formato del proyecto'; });
  renderFrameButtons('.fit-default-btn', ['original', ...Object.keys(FRAME_ASPECTS)], projectDefaultFrame());
  document.documentElement.style.setProperty('--zoom', zoom);
}

function renderInspector() {
  $('#pageInspector').hidden = activeInspector !== 'page';
  $('#infoInspector').hidden = activeInspector !== 'info';
  $('#photoInspector').hidden = activeInspector !== 'photo';
  $$('.inspector-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.inspector === activeInspector));
  const selection = selectedItems();
  $('#selectionCount').textContent = `${selection.length} seleccionada${selection.length === 1 ? '' : 's'}`;
  $('#selectAllPhotosBtn').disabled = !currentPage()?.items.length;
  $('#clearPhotoSelectionBtn').disabled = !selection.length;
  $('#batchFrameSection').hidden = selection.length < 2;
  const selectionModes = selection.map(item => itemFrameMode(item));
  $$('.batch-fit-btn').forEach(button => button.classList.toggle('is-active', selection.length > 1 && selectionModes.every(mode => mode === button.dataset.frame)));
  const item = findItem(selectedItemId);
  const photoInspectorActive = activeInspector === 'photo';
  $('#noSelection').hidden = !photoInspectorActive || !!item;
  $('#selectedPhotoForm').hidden = !photoInspectorActive || !item;
  if (!photoInspectorActive || !item) return;
  const asset = findAsset(item.assetId);
  $('#selectedPreview').innerHTML = asset ? `<img src="${asset.image}" alt="" />` : '';
  $('#selectedPhotoName').textContent = itemDisplayTitle(item, asset) || 'Foto';
  $('#selectedPhotoSize').textContent = asset ? `${asset.width} × ${asset.height} px` : '—';
  $('#slotNumber').textContent = String((item.slot ?? 0) + 1).padStart(2, '0');
  $('#photoFocusX').value = item.focusX ?? 50; $('#photoFocusY').value = item.focusY ?? 50;
  $('#focusValue').textContent = `${Math.round(item.focusX ?? 50)}% / ${Math.round(item.focusY ?? 50)}%`;
  $('#photoShotType').innerHTML = SHOT_TYPES.map(type => `<option value="${type.value}">${type.value} · ${type.label}</option>`).join('');
  $('#photoShotType').value = item.shotType || 'PG';
  $('#photoTitle').value = item.title || '';
  $('#photoDescription').value = item.description || '';
  $$('.camera-preset').forEach(button => button.classList.toggle('is-active', button.dataset.cameraPreset === (item.cameraMove || 'none')));
  $('#photoAnnotationColor').value = validHexColor(item.drawingColor || item.cameraMoveColor, '#ff3b30');
  $('#photoCameraScale').value = Math.round((item.cameraMoveScale ?? 1) * 100);
  $('#cameraScaleValue').textContent = `${Math.round((item.cameraMoveScale ?? 1) * 100)}%`;
  $('#cameraMoveSpill').checked = item.cameraMoveSpill === true;
  $('#cameraMoveSpill').disabled = !item.cameraMove || item.cameraMove === 'none';
  $('#photoDrawingWidth').value = item.drawingWidth ?? 2.4;
  $('#drawingWidthValue').textContent = Number(item.drawingWidth ?? 2.4).toFixed(1);
  $('#moveCameraOverlayBtn').classList.toggle('is-active', annotationToolMode === 'move');
  $('#moveCameraOverlayBtn').disabled = !item.cameraMove || item.cameraMove === 'none';
  $('#drawOnPhotoBtn').classList.toggle('is-active', annotationToolMode === 'draw');
  $('#undoDrawingBtn').disabled = !item.drawingStrokes?.length;
  $('#clearDrawingBtn').disabled = !item.drawingStrokes?.length;
  $('#cameraToolHelp').textContent = annotationToolMode === 'move' ? 'Arrastrá las flechas directamente sobre la foto.' : annotationToolMode === 'draw' ? 'Dibujá sobre la foto. Desactivá el lápiz cuando termines.' : 'Elegí un movimiento. Después podés mover las flechas o dibujar directamente sobre la foto.';
  const currentFrame = itemFrameMode(item);
  renderFrameButtons('.fit-btn', ['original', ...Object.keys(FRAME_ASPECTS)], currentFrame);
}

function render() { renderControls(); renderLibrary(); renderPage(); renderInspector(); }

function previewArtboardBackgroundSettings() {
  [$('#canvasPage'), ...$$('.page-thumb-canvas:not(.page-thumb-add-canvas)')].forEach(applyArtboardBackground);
  $('#backgroundValue').textContent = project.background.toUpperCase();
  $('#backgroundPatternColorValue').textContent = project.backgroundPatternColor.toUpperCase();
  $('#backgroundImageOpacityValue').textContent = `${project.backgroundImageOpacity}%`;
  $('#backgroundImageBlurValue').textContent = `${project.backgroundImageBlur} px`;
  applyBackgroundPreview();
}

function previewStoryboardColors() {
  const frameColor = project.frameTextColor;
  $$('.storyboard-meta-frame').forEach(frame => {
    frame.style.setProperty('--frame-text-color', frameColor);
    frame.style.setProperty('--frame-rule-color', colorWithAlpha(frameColor, .68));
  });
  $$('.description-box,.page-thumb-caption').forEach(box => {
    box.style.setProperty('--description-box-color', colorWithAlpha(project.descriptionBoxColor, .72));
    box.style.setProperty('--description-text-color', project.descriptionTextColor);
  });
  $('#frameTextColorValue').textContent = frameColor.toUpperCase();
  $('#descriptionBoxColorValue').textContent = project.descriptionBoxColor.toUpperCase();
  $('#descriptionTextColorValue').textContent = project.descriptionTextColor.toUpperCase();
}

function selectItem(id, event = {}) {
  const page = currentPage();
  const itemIndex = page?.items.findIndex(item => item.id === id) ?? -1;
  if (itemIndex < 0) return;
  const additive = event.ctrlKey || event.metaKey;
  if (event.shiftKey && selectionAnchorId) {
    const anchorIndex = page.items.findIndex(item => item.id === selectionAnchorId);
    if (anchorIndex >= 0) {
      const start = Math.min(anchorIndex, itemIndex);
      const end = Math.max(anchorIndex, itemIndex);
      const range = page.items.slice(start, end + 1);
      if (additive) range.forEach(item => selectedItemIds.add(item.id));
      else selectedItemIds = new Set(range.map(item => item.id));
    }
  } else if (additive) {
    if (selectedItemIds.has(id)) selectedItemIds.delete(id);
    else selectedItemIds.add(id);
    selectionAnchorId = id;
  } else {
    selectedItemIds = new Set([id]);
    selectionAnchorId = id;
  }
  selectedItemId = selectedItemIds.has(id) ? id : [...selectedItemIds].at(-1) || null;
  activeInspector = selectedItemIds.size > 1 ? 'page' : selectedItemId ? 'photo' : 'page';
  renderPage(); renderInspector();
}

function selectAllCurrentPage() {
  const page = currentPage();
  if (!page?.items.length) return;
  setItemSelection(page.items, page.items[0].id);
  activeInspector = 'page';
  renderPage(); renderInspector();
}

function startMarqueeSelection(event) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || event.target.closest('.design-item') || slotMode) return;
  const board = $('#canvasPage');
  const boardRect = board.getBoundingClientRect();
  const origin = { x: clamp((event.clientX - boardRect.left) / boardRect.width, 0, 1), y: clamp((event.clientY - boardRect.top) / boardRect.height, 0, 1) };
  const existingIds = new Set(selectedItems().map(item => item.id));
  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  let marquee = null;
  let selectedByBox = new Set();
  const cleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onCancel);
    marquee?.remove();
  };
  const restoreHighlights = () => $$('.design-item', board).forEach(node => {
    const id = node.dataset.itemId;
    node.classList.toggle('is-selected', selectedItemIds.size ? selectedItemIds.has(id) : selectedItemId === id);
  });
  const onMove = moveEvent => {
    if (moveEvent.pointerId !== event.pointerId) return;
    if (!marquee && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 4) return;
    if (!marquee) { marquee = document.createElement('div'); marquee.className = 'selection-marquee'; board.appendChild(marquee); }
    const rect = board.getBoundingClientRect();
    const end = { x: clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1), y: clamp((moveEvent.clientY - rect.top) / rect.height, 0, 1) };
    const left = Math.min(origin.x, end.x), right = Math.max(origin.x, end.x);
    const top = Math.min(origin.y, end.y), bottom = Math.max(origin.y, end.y);
    marquee.style.cssText = `left:${left * 100}%;top:${top * 100}%;width:${(right - left) * 100}%;height:${(bottom - top) * 100}%`;
    const bounds = { left: rect.left + left * rect.width, right: rect.left + right * rect.width, top: rect.top + top * rect.height, bottom: rect.top + bottom * rect.height };
    selectedByBox = new Set();
    $$('.design-item', board).forEach(node => {
      const photo = node.querySelector('.design-photo')?.getBoundingClientRect();
      const hit = photo && bounds.left < photo.right && bounds.right > photo.left && bounds.top < photo.bottom && bounds.bottom > photo.top;
      if (hit) selectedByBox.add(node.dataset.itemId);
      node.classList.toggle('is-selected', !!hit || (additive && existingIds.has(node.dataset.itemId)));
    });
  };
  const onUp = upEvent => {
    if (upEvent.pointerId !== event.pointerId) return;
    if (!marquee) {
      cleanup();
      clearItemSelection(); activeInspector = 'page';
      renderPage(); renderInspector();
      suppressCanvasClick = true;
      setTimeout(() => { suppressCanvasClick = false; }, 0);
      return;
    }
    onMove(upEvent);
    cleanup();
    const ids = additive ? new Set([...existingIds, ...selectedByBox]) : selectedByBox;
    const items = currentPage().items.filter(item => ids.has(item.id));
    if (items.length) setItemSelection(items, ids.has(selectedItemId) ? selectedItemId : items.at(-1).id);
    else clearItemSelection();
    activeInspector = items.length > 1 ? 'page' : items.length ? 'photo' : 'page';
    renderPage(); renderInspector();
    suppressCanvasClick = true;
    setTimeout(() => { suppressCanvasClick = false; }, 0);
  };
  const onCancel = cancelEvent => {
    if (cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== event.pointerId) return;
    cleanup();
    restoreHighlights();
  };
  const onKeyDown = keyEvent => { if (keyEvent.key === 'Escape') onCancel(keyEvent); };
  event.preventDefault();
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onCancel);
}

function applyFrameToSelection(mode) {
  const items = selectedItems();
  if (items.length < 2 || !validFrameMode(mode)) return;
  captureUndoState();
  items.forEach(item => Object.assign(item, frameFields(mode)));
  render(); saveProject();
  showToast(`Encuadre ${FRAME_LABELS[mode].toLowerCase()} aplicado a ${items.length} fotos`);
}

function setAnnotationToolMode(mode) {
  annotationToolMode = annotationToolMode === mode ? 'none' : mode;
  renderPage();
  renderInspector();
}

function bindCameraOverlay(overlay) {
  overlay.addEventListener('pointerdown', event => {
    if (annotationToolMode !== 'move' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const item = findItem(overlay.dataset.cameraOverlay);
    const photo = overlay.closest('.design-photo');
    if (!item || !photo) return;
    const rect = photo.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, itemX: item.cameraMoveX ?? 50, itemY: item.cameraMoveY ?? 50 };
    const moveMin = item.cameraMoveSpill ? -400 : 8;
    const moveMax = item.cameraMoveSpill ? 400 : 92;
    overlay.setPointerCapture?.(event.pointerId);
    const onMove = moveEvent => {
      item.cameraMoveX = clamp(start.itemX + (moveEvent.clientX - start.x) / rect.width * 100, moveMin, moveMax);
      item.cameraMoveY = clamp(start.itemY + (moveEvent.clientY - start.y) / rect.height * 100, moveMin, moveMax);
      overlay.style.setProperty('--camera-x', `${item.cameraMoveX}%`);
      overlay.style.setProperty('--camera-y', `${item.cameraMoveY}%`);
    };
    const finish = () => { overlay.removeEventListener('pointermove', onMove); overlay.removeEventListener('pointerup', finish); overlay.removeEventListener('pointercancel', finish); saveProject(); };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', finish);
    overlay.addEventListener('pointercancel', finish);
  });
}

function bindDrawingLayer(layer) {
  layer.addEventListener('pointerdown', event => {
    if (annotationToolMode !== 'draw' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const item = findItem(layer.dataset.drawingLayer);
    if (!item) return;
    item.drawingStrokes = normalizeDrawingStrokes(item.drawingStrokes);
    const stroke = { id: createId('stroke'), color: validHexColor(item.drawingColor, '#ff3b30'), width: clamp(Number(item.drawingWidth) || 2.4, .8, 8), points: [] };
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.dataset.strokeId = stroke.id;
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', stroke.width);
    layer.appendChild(path);
    const addPoint = pointEvent => {
      const rect = layer.getBoundingClientRect();
      const point = { x: clamp((pointEvent.clientX - rect.left) / rect.width * 100, 0, 100), y: clamp((pointEvent.clientY - rect.top) / rect.height * 100, 0, 100) };
      const previous = stroke.points.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < .35) return;
      stroke.points.push(point);
      path.setAttribute('d', drawingPathData(stroke.points));
    };
    addPoint(event);
    layer.setPointerCapture?.(event.pointerId);
    const onMove = moveEvent => addPoint(moveEvent);
    const finish = () => {
      layer.removeEventListener('pointermove', onMove);
      layer.removeEventListener('pointerup', finish);
      layer.removeEventListener('pointercancel', finish);
      if (stroke.points.length) item.drawingStrokes.push(stroke);
      saveProject();
      renderInspector();
    };
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerup', finish);
    layer.addEventListener('pointercancel', finish);
  });
}

function bindDesignItem(element) {
  const id = element.dataset.itemId;
  element.addEventListener('pointerdown', event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) startSlotDrag(event, id); });
  element.addEventListener('click', event => { event.stopPropagation(); selectItem(id, event); });
}

function startSlotDrag(event, id) {
  const item = findItem(id); if (!item || event.button !== 0) return;
  event.preventDefault();
  selectedItemIds = new Set([id]); selectionAnchorId = id; selectedItemId = id; activeInspector = 'photo';
  slotDrag = { id, duplicate: event.altKey };
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  slotMode = true; hoverSlotIndex = item.slot; renderPage(); renderInspector();
  const onMove = moveEvent => { moved ||= Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8; hoverSlotIndex = slotAtPoint(moveEvent.clientX, moveEvent.clientY); updateSlotGuides(); };
  const finish = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancel);
    slotDrag = null; slotMode = false; hoverSlotIndex = null;
    render();
  };
  const onUp = upEvent => {
    const targetSlot = slotAtPoint(upEvent.clientX, upEvent.clientY);
    if (targetSlot === null && moved && !slotDrag.duplicate) {
      currentPage().items = currentPage().items.filter(entry => entry.id !== id);
      renumberItems(currentPage());
      selectedItemId = null;
      activeInspector = 'page';
      finish(); saveProject(); showToast('Foto eliminada al arrastrarla fuera del canvas');
      return;
    }
    if (targetSlot !== null) {
      if (slotDrag.duplicate) {
        const copy = cloneStoryboardItem(item);
        currentPage().items.splice(targetSlot, 0, copy);
        renumberItems(currentPage());
        selectedItemId = copy.id;
      } else {
        moveItemToSlot(id, targetSlot);
      }
    }
    finish(); saveProject();
  };
  const cancel = () => finish();
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
  document.addEventListener('pointercancel', cancel, { once: true });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function updateSlotGuides() { const target = hoverSlotIndex === null ? null : Math.min(hoverSlotIndex, currentPage().items.length - 1); $$('.slot-guide').forEach(guide => guide.classList.toggle('is-target', Number(guide.dataset.slotIndex) === target)); }
function moveItemToSlot(itemId, targetSlot) {
  const page = currentPage();
  const source = page.items.findIndex(item => item.id === itemId);
  if (source < 0) return;
  const [item] = page.items.splice(source, 1);
  page.items.splice(clamp(targetSlot, 0, page.items.length), 0, item);
  renumberItems(page);
  selectedItemId = itemId;
}
function addAssetToPage(assetId, targetSlot = null) {
  const asset = findAsset(assetId); const page = currentPage(); if (!asset || !page) return;
  const [item] = createAutoItems([asset]);
  page.items.splice(targetSlot === null ? page.items.length : clamp(targetSlot, 0, page.items.length), 0, item);
  renumberItems(page);
  selectedItemId = item.id; activeInspector = 'photo'; render(); saveProject(); showToast('Foto agregada · distribución ajustada');
}

function createAutoItems(assets) {
  return assets.map((asset, index) => ({ id: createId('item'), assetId: asset.id, slot: index, ...frameFields(projectDefaultFrame()), focusX: 50, focusY: 50, shotType: 'PG', title: '', description: '', cameraMove: 'none', cameraMoveMode: 'overlay', cameraMoveX: 50, cameraMoveY: 50, cameraMoveScale: 1, cameraMoveColor: '#ff3b30', cameraMoveSpill: false, drawingColor: '#ff3b30', drawingWidth: 2.4, drawingStrokes: [] }));
}

function autoArrange() {
  const placed = placedAssetIds();
  const remaining = project.assets.filter(asset => !placed.has(asset.id));
  if (!remaining.length) { showToast('Todas las fotos de la biblioteca ya están en el storyboard'); return; }
  currentPage().items.push(...createAutoItems(remaining));
  renumberItems(currentPage());
  render(); saveProject(); showToast(`${remaining.length} fotos agregadas a esta página`);
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => { const max = 1800; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); resolve({ image: canvas.toDataURL('image/jpeg', .86), width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); }; image.src = url;
  });
}

async function compressBackgroundImage(source) {
  const image = await loadImageSource(source);
  if (!image) throw new Error('No se pudo leer la imagen de fondo');
  const max = 1800;
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .84);
}

async function optimizeCurrentBackgroundImage() {
  const activeProject = project;
  const source = activeProject?.backgroundImage || '';
  if (!source.startsWith('data:image/') || source.length < 900000) return;
  try {
    const optimized = await compressBackgroundImage(source);
    if (project !== activeProject || project.backgroundImage !== source || optimized.length >= source.length) return;
    project.backgroundImage = optimized;
    render();
    saveProject();
  } catch (error) {
    console.warn('No se pudo optimizar la foto de fondo.', error);
  }
}

async function handleFiles(fileList, firstSlot = null) {
  const files = [...fileList].filter(file => file.type.startsWith('image/')); if (!files.length) { showToast('Elegí archivos de imagen JPG, PNG o WEBP'); return; }
  try {
    const incoming = await Promise.all(files.map(async file => { const compressed = await compressImage(file); return { id: createId('asset'), name: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '), ...compressed }; }));
    project.assets.push(...incoming);
    if (firstSlot !== null) {
      const page = currentPage();
      const items = createAutoItems(incoming);
      page.items.splice(clamp(firstSlot, 0, page.items.length), 0, ...items);
      renumberItems(page);
      selectedItemId = items[items.length - 1].id; activeInspector = 'photo';
    }
    render(); saveProject(); showToast(`${incoming.length} foto${incoming.length === 1 ? '' : 's'} agregada${incoming.length === 1 ? '' : 's'} ${firstSlot !== null ? 'al artboard' : 'a la biblioteca'}`);
  } catch { showToast('No se pudo leer alguna de las fotos'); }
}

function deleteSelected() {
  const page = currentPage(); const selected = selectedItems();
  if (!page || !selected.length) return;
  captureUndoState();
  const ids = new Set(selected.map(item => item.id));
  page.items = page.items.filter(item => !ids.has(item.id));
  renumberItems(page); clearItemSelection(); activeInspector = 'page'; render(); saveProject();
  showToast(`${selected.length} foto${selected.length === 1 ? '' : 's'} quitada${selected.length === 1 ? '' : 's'} · distribución ajustada`);
}
function duplicateSelected() { const item = findItem(selectedItemId); if (!item) return; const copy = cloneStoryboardItem(item); currentPage().items.splice(item.slot + 1, 0, copy); renumberItems(currentPage()); setItemSelection([copy], copy.id); render(); saveProject(); showToast('Foto duplicada · distribución ajustada'); }
function deleteCurrentPage() {
  removePageAt(currentPageIndex);
}

function confirmDeletePage() {
  if (pendingDeletePageIndex === null || project.pages.length <= 1) return;
  captureUndoState();
  project.pages.splice(pendingDeletePageIndex, 1);
  currentPageIndex = Math.min(pendingDeletePageIndex, project.pages.length - 1);
  selectedItemId = null;
  activeInspector = 'page';
  closeDeletePageConfirm();
  render();
  saveProject();
  showToast('Página eliminada · Ctrl + Z para recuperar');
}

function downloadBlob(blob, filename) { const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = filename; link.style.display = 'none'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
function exportProjectSlug() {
  return (project.title || 'Storyboard').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Storyboard';
}
function exportedPageFilename(pageIndex, extension = 'png') { return `${exportProjectSlug()}_pag${pageIndex + 1}.${extension}`; }
function downloadProject() { downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.title || 'storyboard'}.json`); showToast('Proyecto editable exportado'); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipUint16(view, offset, value) { view.setUint16(offset, value, true); }
function zipUint32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function createZipBlob(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach(entry => {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    zipUint32(localView, 0, 0x04034b50); zipUint16(localView, 4, 20); zipUint16(localView, 6, 0x800); zipUint16(localView, 8, 0); zipUint16(localView, 10, 0); zipUint16(localView, 12, 0); zipUint32(localView, 14, crc); zipUint32(localView, 18, data.length); zipUint32(localView, 22, data.length); zipUint16(localView, 26, name.length); zipUint16(localView, 28, 0);
    localParts.push(localHeader, name, data);
    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    zipUint32(centralView, 0, 0x02014b50); zipUint16(centralView, 4, 20); zipUint16(centralView, 6, 20); zipUint16(centralView, 8, 0x800); zipUint16(centralView, 10, 0); zipUint16(centralView, 12, 0); zipUint16(centralView, 14, 0); zipUint32(centralView, 16, crc); zipUint32(centralView, 20, data.length); zipUint32(centralView, 24, data.length); zipUint16(centralView, 28, name.length); zipUint16(centralView, 30, 0); zipUint16(centralView, 32, 0); zipUint16(centralView, 34, 0); zipUint16(centralView, 36, 0); zipUint32(centralView, 38, 0); zipUint32(centralView, 42, offset);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  });
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  zipUint32(endView, 0, 0x06054b50); zipUint16(endView, 4, 0); zipUint16(endView, 6, 0); zipUint16(endView, 8, entries.length); zipUint16(endView, 10, entries.length); zipUint32(endView, 12, centralSize); zipUint32(endView, 16, offset); zipUint16(endView, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function drawImageInBox(ctx, image, x, y, width, height, fit, focusX = 50, focusY = 50) {
  if (fit === 'contain') { const scale = Math.min(width / image.width, height / image.height); const drawW = image.width * scale; const drawH = image.height * scale; ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH); return; }
  const scale = Math.max(width / image.width, height / image.height); const drawW = image.width * scale; const drawH = image.height * scale; const freeX = width - drawW; const freeY = height - drawH; ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.drawImage(image, x + freeX * (focusX / 100), y + freeY * (focusY / 100), drawW, drawH); ctx.restore();
}

function drawItemMetadata(ctx, item, asset, layout, width, height) {
  const image = itemImageBox(item, layout);
  const x = image.x / 100 * width;
  const y = image.y / 100 * height;
  const number = String((item.slot ?? 0) + 1).padStart(2, '0');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, image.width / 100 * width, image.height / 100 * height);
  ctx.clip();
  const badgeX = x + 7;
  const badgeY = y + 7;
  ctx.font = '500 10px "DM Mono", monospace';
  const badgeWidth = Math.max(24, ctx.measureText(number).width + 10);
  const badgeHeight = 20;
  ctx.fillStyle = 'rgba(0,0,0,.86)';
  ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(number, badgeX + badgeWidth / 2, badgeY + 14);
  ctx.restore();
  ctx.textAlign = 'left';
  if (project.infoPlacement === 'none') return;
  const title = itemDisplayTitle(item, asset);
  const description = item.description?.trim() || '';
  // The title is always rendered. The description toggle only hides the
  // optional second line below it.
  const overlayHeight = photoInfoHeight(item);
  const caption = layout.caption || { x: image.x, y: image.y + image.height * (1 - overlayHeight / 100), width: image.width, height: image.height * overlayHeight / 100 };
  const renderScale = width / Math.max(1, $('#canvasPage')?.clientWidth || width);
  const captionX = caption.x / 100 * width;
  let captionY = caption.y / 100 * height;
  const captionWidth = caption.width / 100 * width;
  let captionHeight = caption.height / 100 * height;
  if (!layout.caption) {
    captionHeight = Math.max(captionHeight, photoInfoMinHeight(item) * renderScale);
    captionY = (image.y + image.height) / 100 * height - captionHeight;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(captionX, captionY, captionWidth, captionHeight);
  ctx.clip();
  const lightInfo = project.infoStyle === 'light';
  const descriptionTextColor = project.descriptionTextColor || (lightInfo ? '#000000' : '#ffffff');
  ctx.fillStyle = colorWithAlpha(project.descriptionBoxColor, .72);
  ctx.fillRect(captionX, captionY, captionWidth, captionHeight);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1;
  if (!description && lightInfo) ctx.setLineDash([3, 3]);
  ctx.strokeRect(captionX + .5, captionY + .5, Math.max(0, captionWidth - 1), Math.max(0, captionHeight - 1));
  ctx.setLineDash([]);
  ctx.fillStyle = descriptionTextColor;
  const inset = Math.max(8, Math.round(10 * renderScale));
  const titleSize = Math.max(14, Math.round(14 * renderScale));
  const descriptionSize = Math.max(12, Math.round(12 * renderScale));
  const verticalPadding = 5 * renderScale;
  const textGap = 3 * renderScale;
  ctx.textBaseline = 'top';
  ctx.font = `600 ${titleSize}px "Space Grotesk", sans-serif`;
  const titleY = captionY + Math.max(verticalPadding, (captionHeight - titleSize * 1.2 - descriptionSize * 1.3 - textGap - verticalPadding * 2) / 2 + verticalPadding);
  ctx.fillText(title, captionX + inset, titleY, Math.max(0, captionWidth - inset * 2));
  if (description && captionHeight > titleSize + 8) {
    ctx.font = `400 ${descriptionSize}px "DM Sans", sans-serif`;
    ctx.fillStyle = description ? descriptionTextColor : (lightInfo ? '#555' : '#d0d0d0');
    const text = description;
    const maxWidth = Math.max(0, captionWidth - inset * 2);
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    });
    if (line) lines.push(line);
    const maxLines = Math.max(1, Math.floor((captionHeight - (titleY - captionY) - titleSize * 1.2 - verticalPadding) / (descriptionSize * 1.3)));
    lines.slice(0, maxLines).forEach((lineText, index) => ctx.fillText(lineText, captionX + inset, titleY + titleSize * 1.2 + textGap + index * descriptionSize * 1.3, maxWidth));
  }
  ctx.restore();
}

function loadImageSource(source) {
  return new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = source; });
}

function drawTintedImage(ctx, image, x, y, width, height, color) {
  const buffer = document.createElement('canvas');
  buffer.width = Math.max(1, Math.ceil(width));
  buffer.height = Math.max(1, Math.ceil(height));
  const bufferCtx = buffer.getContext('2d');
  bufferCtx.drawImage(image, 0, 0, buffer.width, buffer.height);
  bufferCtx.globalCompositeOperation = 'source-in';
  bufferCtx.fillStyle = color;
  bufferCtx.fillRect(0, 0, buffer.width, buffer.height);
  ctx.drawImage(buffer, x, y, width, height);
}

async function drawProducerBranding(ctx, width, height) {
  const producer = project.producer?.trim() || '';
  if (!project.showProducerBranding || (!producer && !project.producerLogo)) return;
  const logo = project.producerLogo ? await loadImageSource(project.producerLogo) : null;
  const padding = Math.max(8, Math.round(width * .008));
  const logoSize = Math.max(22, Math.round(height * .045));
  const fontSize = Math.max(13, Math.round(width * .011));
  ctx.save();
  ctx.font = `600 ${fontSize}px Arial`;
  const textWidth = producer ? ctx.measureText(producer.toUpperCase()).width : 0;
  const contentWidth = (logo ? logoSize + 8 : 0) + textWidth;
  const boxWidth = contentWidth + padding * 2;
  const boxHeight = logo ? logoSize + padding * 2 : fontSize + padding * 2;
  const x = width * .06;
  const y = height * .06;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  let cursorX = x + padding;
  if (logo) { ctx.drawImage(logo, cursorX, y + (boxHeight - logoSize) / 2, logoSize, logoSize); cursorX += logoSize + 8; }
  if (producer) { ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(producer.toUpperCase(), cursorX, y + boxHeight / 2); }
  ctx.restore();
}
function drawProjectTitle(ctx, width, height) {
  if (!project.showProjectTitle || !project.title.trim()) return;
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(16, Math.round(width * .012))}px Arial`;
  ctx.textAlign = 'right';
  ctx.fillText(project.title.slice(0, 70), width * .965, height * .045);
  ctx.restore();
}

function drawCanvasArrow(ctx, x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(8, Math.min(18, Math.hypot(x2 - x1, y2 - y1) * .08));
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  drawCanvasArrowHead(ctx, x2, y2, angle, size);
}

function drawCanvasArrowHead(ctx, x, y, angle, size) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6)); ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6)); ctx.closePath(); ctx.fill();
}

function drawCameraMoveOverlayCanvas(ctx, item, layout, width, height) {
  const move = cameraMoveInfo(item.cameraMove);
  if (move.value === 'none') return;
  const box = itemImageBox(item, layout);
  const x = box.x / 100 * width; const y = box.y / 100 * height; const w = box.width / 100 * width; const h = box.height / 100 * height;
  const scale = clamp(Number(item.cameraMoveScale) || 1, .45, 1.45) * .92;
  const cameraMoveMin = item.cameraMoveSpill ? -400 : 8;
  const cameraMoveMax = item.cameraMoveSpill ? 400 : 92;
  const cameraMoveX = Number(item.cameraMoveX);
  const cameraMoveY = Number(item.cameraMoveY);
  const centerX = x + w * clamp(Number.isFinite(cameraMoveX) ? cameraMoveX : 50, cameraMoveMin, cameraMoveMax) / 100;
  const centerY = y + h * clamp(Number.isFinite(cameraMoveY) ? cameraMoveY : 50, cameraMoveMin, cameraMoveMax) / 100;
  const point = (px, py) => ({ x: centerX + (px - 50) / 100 * w * scale, y: centerY + (py - 50) / 100 * h * scale });
  const line = (fromX, fromY, toX, toY) => { const from = point(fromX, fromY); const to = point(toX, toY); drawCanvasArrow(ctx, from.x, from.y, to.x, to.y); };
  const curve = (fromX, fromY, controlX, controlY, toX, toY) => { const from = point(fromX, fromY); const control = point(controlX, controlY); const to = point(toX, toY); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo(control.x, control.y, to.x, to.y); ctx.stroke(); drawCanvasArrowHead(ctx, to.x, to.y, Math.atan2(to.y - control.y, to.x - control.x), Math.max(9, Math.min(20, Math.min(w, h) * .07))); };
  ctx.save(); if (!item.cameraMoveSpill) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); } ctx.strokeStyle = validHexColor(item.cameraMoveColor, '#ff3b30'); ctx.fillStyle = validHexColor(item.cameraMoveColor, '#ff3b30'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(255,255,255,.95)'; ctx.shadowBlur = 1; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
  if (move.value === 'zoom-in' || move.value === 'dolly-in') { line(8, 8, 35, 35); line(92, 8, 65, 35); line(8, 92, 35, 65); line(92, 92, 65, 65); }
  if (move.value === 'zoom-out' || move.value === 'dolly-out') { line(35, 35, 8, 8); line(65, 35, 92, 8); line(35, 65, 8, 92); line(65, 65, 92, 92); }
  if (move.value === 'pan-left') curve(90, 66, 50, 88, 10, 66);
  if (move.value === 'pan-right') curve(10, 66, 50, 88, 90, 66);
  if (move.value === 'tilt-up') curve(72, 90, 90, 50, 72, 10);
  if (move.value === 'tilt-down') curve(72, 10, 90, 50, 72, 90);
  if (move.value === 'track-left') { line(90, 40, 10, 40); line(90, 62, 10, 62); }
  if (move.value === 'track-right') { line(10, 40, 90, 40); line(10, 62, 90, 62); }
  if (move.value === 'dolly-in' || move.value === 'dolly-out') { const start = point(31, 31); const end = point(69, 69); ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y); }
  ctx.restore();
}

function drawPhotoAnnotationsCanvas(ctx, item, layout, width, height) {
  const strokes = normalizeDrawingStrokes(item.drawingStrokes);
  if (!strokes.length) return;
  const box = itemImageBox(item, layout);
  const x = box.x / 100 * width; const y = box.y / 100 * height; const w = box.width / 100 * width; const h = box.height / 100 * height;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokes.forEach(stroke => {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, Math.min(w, h) * stroke.width / 100);
    ctx.beginPath();
    stroke.points.forEach((pointValue, index) => { const px = x + pointValue.x / 100 * w; const py = y + pointValue.y / 100 * h; if (!index) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    if (stroke.points.length === 1) { const pointValue = stroke.points[0]; ctx.lineTo(x + pointValue.x / 100 * w + .01, y + pointValue.y / 100 * h + .01); }
    ctx.stroke();
  });
  ctx.restore();
}

async function drawProjectMetaFrame(ctx, width, height, pageNumber, totalPages) {
  const insetX = width * .035;
  const insetY = height * .035;
  const barHeight = Math.max(24, Math.round(height * .045));
  const barY = insetY - Math.round(barHeight / 2);
  const footerY = height - insetY - Math.round(barHeight / 2);
  const logo = project.showProducerBranding && project.producerLogo ? await loadImageSource(project.producerLogo) : null;
  const clientLogo = project.showClientMeta && project.clientLogo ? await loadImageSource(project.clientLogo) : null;
  const details = [
    project.showClientMeta && project.client?.trim() ? ['CLIENTE', project.client] : null,
    project.showAgencyMeta && project.agency?.trim() ? ['AGENCIA', project.agency] : null,
    project.showDirectorMeta && project.director?.trim() ? ['DIRECTOR', project.director] : null
  ].filter(Boolean);
  ctx.save();
  const frameLineWidth = 1;
  const frameRight = width - insetX;
  const frameBottom = height - insetY;
  const drawRule = (y, segments) => { if (!project.showProjectFrame) return; ctx.beginPath(); segments.forEach(([start, end]) => { if (end <= start) return; ctx.moveTo(start, y); ctx.lineTo(end, y); }); ctx.stroke(); };
  const frameTextColor = project.frameTextColor || '#111111';
  if (project.showProjectFrame) { ctx.strokeStyle = colorWithAlpha(frameTextColor, .68); ctx.lineWidth = frameLineWidth; ctx.beginPath(); ctx.moveTo(insetX, insetY); ctx.lineTo(insetX, frameBottom); ctx.moveTo(frameRight, insetY); ctx.lineTo(frameRight, frameBottom); ctx.stroke(); }
  const fontSize = Math.max(7, Math.min(11, width * .0072));
  ctx.font = `500 ${fontSize}px "DM Mono", monospace`;
  ctx.textBaseline = 'middle';
  const producerStart = insetX + 30;
  let leftX = producerStart;
  let producerEnd = insetX;
  if (logo) { const logoSize = 18; drawTintedImage(ctx, logo, leftX, barY + (barHeight - logoSize) / 2, logoSize, logoSize, frameTextColor); leftX += logoSize + 6; producerEnd = leftX - 6; }
  if (project.showProducerBranding && project.producer?.trim()) { ctx.fillStyle = frameTextColor; ctx.textAlign = 'left'; const producerText = project.producer.trim().toUpperCase().slice(0, 44); ctx.fillText(producerText, leftX, barY + barHeight / 2); producerEnd = leftX + ctx.measureText(producerText).width; }
  const titleText = project.showProjectTitle && project.title.trim() ? project.title.trim().toUpperCase().slice(0, 54) : '';
  const titleEnd = frameRight - 30;
  const titleStart = titleText ? titleEnd - (ctx.measureText(titleText).width) : frameRight;
  if (titleText) { ctx.fillStyle = frameTextColor; ctx.textAlign = 'right'; ctx.fillText(titleText, titleEnd, barY + barHeight / 2); }
  ctx.lineWidth = frameLineWidth;
  const topRuleSegments = [];
  if (producerEnd > insetX) topRuleSegments.push([insetX, producerStart - 8]);
  if (producerEnd > insetX || titleText) topRuleSegments.push([producerEnd > insetX ? producerEnd + 8 : insetX, titleText ? titleStart - 8 : frameRight]);
  if (titleText) topRuleSegments.push([titleEnd + 8, frameRight]);
  ctx.strokeStyle = frameTextColor;
  ctx.globalAlpha = .68;
  if (project.showProducerBranding && (project.producer?.trim() || project.producerLogo) || titleText) drawRule(insetY, topRuleSegments);
  ctx.globalAlpha = 1;
  const detailsStart = insetX + 30;
  let detailX = detailsStart;
  ctx.textAlign = 'left';
  details.forEach(([label, value]) => { if (label === 'CLIENTE' && clientLogo) { const clientLogoSize = 18; ctx.drawImage(clientLogo, detailX, footerY + (barHeight - clientLogoSize) / 2, clientLogoSize, clientLogoSize); detailX += clientLogoSize + 4; } ctx.fillStyle = frameTextColor; ctx.font = `500 ${Math.max(7, fontSize * .75)}px "DM Mono", monospace`; const prefix = label; ctx.fillText(prefix, detailX, footerY + barHeight / 2); detailX += ctx.measureText(prefix).width + 4; ctx.fillStyle = frameTextColor; ctx.font = `500 ${fontSize}px "DM Mono", monospace`; const text = value.trim().toUpperCase().slice(0, 30); ctx.fillText(text, detailX, footerY + barHeight / 2); detailX += ctx.measureText(text).width + 12; });
  const detailsEnd = detailX - (details.length ? 12 : 0);
  const pageText = project.showPageNumber ? String(pageNumber).padStart(2, '0') : '';
  ctx.font = `500 ${fontSize}px "DM Mono", monospace`;
  const pageEnd = frameRight - 30;
  const pageStart = pageText ? pageEnd - ctx.measureText(pageText).width : frameRight;
  if (pageText) { ctx.fillStyle = frameTextColor; ctx.textAlign = 'right'; ctx.fillText(pageText, pageEnd, footerY + barHeight / 2); }
  ctx.strokeStyle = frameTextColor;
  ctx.globalAlpha = .68;
  ctx.lineWidth = frameLineWidth;
  const bottomRuleSegments = [];
  if (details.length) bottomRuleSegments.push([insetX, detailsStart - 8]);
  bottomRuleSegments.push([details.length ? detailsEnd + 8 : insetX, pageText ? pageStart - 8 : frameRight]);
  if (pageText) bottomRuleSegments.push([pageEnd + 8, frameRight]);
  if (details.length || pageText) drawRule(frameBottom, bottomRuleSegments);
  ctx.restore();
}

function inlineComputedStyles(source, clone) {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const cloneChildren = [...clone.children];
  const computed = getComputedStyle(source);
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed[index];
    clone.style.setProperty(property, computed.getPropertyValue(property));
  }
  ['::before', '::after'].forEach(pseudo => {
    const pseudoStyle = getComputedStyle(source, pseudo);
    let content = pseudoStyle.content;
    const hasBackgroundImage = pseudoStyle.backgroundImage && pseudoStyle.backgroundImage !== 'none';
    if ((!content || content === 'none' || content === 'normal' || content === '""' || content === "''") && !hasBackgroundImage) return;
    if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") content = '';
    if (content.startsWith('attr(') && source.dataset.placeholder) content = source.dataset.placeholder;
    if ((content.startsWith('"') && content.endsWith('"')) || (content.startsWith("'") && content.endsWith("'"))) content = content.slice(1, -1);
    const generated = document.createElement('span');
    generated.textContent = content;
    for (let index = 0; index < pseudoStyle.length; index += 1) {
      const property = pseudoStyle[index];
      if (property !== 'content') generated.style.setProperty(property, pseudoStyle.getPropertyValue(property));
    }
    if (pseudo === '::before') clone.prepend(generated); else clone.append(generated);
  });
  [...source.children].forEach((child, index) => inlineComputedStyles(child, cloneChildren[index]));
}

async function renderPageCanvasFromArtboard(page, pageIndex, totalPages) {
  await document.fonts.ready;
  const width = project.ratio === 'portrait' ? 900 : 1600;
  const height = Math.round(width / getPageAspect());
  const liveBoard = $('#canvasPage');
  const logicalWidth = Math.max(1, liveBoard?.clientWidth || width);
  const logicalHeight = logicalWidth / getPageAspect();
  const board = document.createElement('div');
  board.className = `canvas-page ${pageFormatClass()}`;
  board.style.cssText = `position:fixed;left:-100000px;top:0;width:${logicalWidth}px;height:${logicalHeight}px;max-width:none;max-height:none;box-shadow:none;transform:none;transition:none;`;
  const content = page.items.map(item => itemMarkup(item, page)).join('');
  board.innerHTML = `${content || '<div class="empty-page"><div><span>▱</span><strong>Tu artboard está vacío</strong><small>Arrastrá una foto desde la biblioteca</small></div></div>'}${storyboardMetaMarkup(pageIndex + 1, totalPages)}`;
  applyArtboardBackground(board);
  board.querySelectorAll('.is-selected,.is-editing').forEach(element => element.classList.remove('is-selected', 'is-editing'));
  board.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
  document.body.appendChild(board);
  try {
    await Promise.all([...board.querySelectorAll('img')].map(image => image.decode?.().catch(() => {}) || Promise.resolve()));
    const clone = board.cloneNode(true);
    inlineComputedStyles(board, clone);
    clone.style.setProperty('position', 'relative', 'important');
    clone.style.setProperty('left', '0', 'important');
    clone.style.setProperty('top', '0', 'important');
    clone.style.setProperty('width', `${logicalWidth}px`, 'important');
    clone.style.setProperty('height', `${logicalHeight}px`, 'important');
    clone.style.setProperty('box-shadow', 'none', 'important');
    clone.style.setProperty('transform', 'none', 'important');
    const markup = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logicalWidth} ${logicalHeight}"><foreignObject width="${logicalWidth}" height="${logicalHeight}"><div xmlns="http://www.w3.org/1999/xhtml">${markup}</div></foreignObject></svg>`;
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = await loadImageSource(svgUrl);
      if (!image) throw new Error('No se pudo rasterizar el artboard');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      return canvas;
    } finally { URL.revokeObjectURL(svgUrl); }
  } finally { board.remove(); }
}

async function renderPageCanvasLegacy(page, pageIndex = currentPageIndex, totalPages = project.pages.length) {
  await document.fonts.ready;
  const width = project.ratio === 'portrait' ? 900 : 1600; const height = Math.round(width / getPageAspect()); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); await drawArtboardBackground(ctx, width, height);
  await Promise.all(page.items.map(item => new Promise(resolve => { const asset = findAsset(item.assetId); if (!asset) return resolve(); const image = new Image(); const layout = itemLayout(item, page); image.onload = () => { const box = itemImageBox(item, layout); const x = box.x / 100 * width; const y = box.y / 100 * height; const w = box.width / 100 * width; const h = box.height / 100 * height; if (item.fit === 'contain') { ctx.fillStyle = '#eee'; ctx.fillRect(x, y, w, h); } drawImageInBox(ctx, image, x, y, w, h, item.fit, item.focusX, item.focusY); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, Math.max(0, w - 1), Math.max(0, h - 1)); resolve(); }; image.onerror = resolve; image.src = asset.image; })));
  page.items.forEach(item => { const layout = itemLayout(item, page); drawCameraMoveOverlayCanvas(ctx, item, layout, width, height); drawPhotoAnnotationsCanvas(ctx, item, layout, width, height); const asset = findAsset(item.assetId); if (asset) drawItemMetadata(ctx, item, asset, layout, width, height); });
  await drawProjectMetaFrame(ctx, width, height, pageIndex + 1, totalPages);
  return canvas;
}

async function renderPageCanvas(page, pageIndex = currentPageIndex, totalPages = project.pages.length) {
  try { return await renderPageCanvasFromArtboard(page, pageIndex, totalPages); }
  catch (error) { console.warn('Se usará el render de respaldo para exportar esta página.', error); return renderPageCanvasLegacy(page, pageIndex, totalPages); }
}

function canvasToBlob(canvas, type = 'image/png', quality = .92) {
  return new Promise((resolve, reject) => {
    if (typeof canvas?.toBlob !== 'function') { reject(new Error('Este navegador no puede crear el archivo de imagen')); return; }
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('El navegador no pudo crear el archivo de imagen')), type, quality); }
    catch (error) { reject(error); }
  });
}

async function renderPageBlob(page, pageIndex = currentPageIndex, totalPages = project.pages.length, type = 'image/png', quality = .92) {
  const canvas = await renderPageCanvas(page, pageIndex, totalPages);
  try { return await canvasToBlob(canvas, type, quality); }
  catch (error) {
    console.warn('Falló la conversión del artboard; se reintentará con el render de respaldo.', error);
    const fallbackCanvas = await renderPageCanvasLegacy(page, pageIndex, totalPages);
    return canvasToBlob(fallbackCanvas, type, quality);
  }
}

async function exportPageAsPng(pageIndex = currentPageIndex) {
  const page = project.pages[pageIndex];
  if (!page) return;
  showToast(`Preparando el PNG de la página ${pageIndex + 1}…`);
  try {
    const blob = await renderPageBlob(page, pageIndex, project.pages.length, 'image/png');
    downloadBlob(blob, exportedPageFilename(pageIndex));
    showToast(`Página ${pageIndex + 1} exportada como PNG`);
  } catch (error) {
    console.error('No se pudo exportar la página como PNG.', error);
    showToast('No se pudo exportar el PNG. Probá de nuevo en unos segundos.');
  }
}

async function exportImage(type) {
  const page = currentPage();
  if (!page) return;
  showToast(`Preparando la página como ${type.toUpperCase()}…`);
  try {
    const mimeType = type === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await renderPageBlob(page, currentPageIndex, project.pages.length, mimeType);
    downloadBlob(blob, exportedPageFilename(currentPageIndex, type));
    showToast(`Página exportada como ${type.toUpperCase()}`);
  } catch (error) {
    console.error('No se pudo exportar la página.', error);
    showToast(`No se pudo exportar como ${type.toUpperCase()}. Probá de nuevo.`);
  }
}
async function exportAllPagesPng() {
  showToast('Preparando las páginas como PNG…');
  try {
    const totalPages = project.pages.length;
    const entries = [];
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      const blob = await renderPageBlob(project.pages[pageIndex], pageIndex, totalPages);
      entries.push({ name: exportedPageFilename(pageIndex), data: new Uint8Array(await blob.arrayBuffer()) });
    }
    downloadBlob(createZipBlob(entries), `${exportProjectSlug()}_paginas.zip`);
    showToast(`${entries.length} página${entries.length === 1 ? '' : 's'} exportada${entries.length === 1 ? '' : 's'} como PNG`);
  } catch (error) {
    console.error('No se pudieron exportar todas las páginas como PNG.', error);
    showToast('No se pudieron exportar las páginas como PNG. Probá de nuevo.');
  }
}

function printAllPages() {
  const layer = document.createElement('div'); layer.className = 'print-layer';
  project.pages.forEach((page, pageIndex) => {
    const sheet = document.createElement('div');
    sheet.className = `canvas-page print-page ${pageFormatClass()}`;
    applyArtboardBackground(sheet);
    page.items.forEach(item => {
      const asset = findAsset(item.assetId); if (!asset) return;
      const layout = itemLayout(item, page);
      const label = itemDisplayTitle(item, asset);
      const number = String((item.slot ?? 0) + 1).padStart(2, '0');
      const imageBox = itemImageBox(item, layout);
      const imageStyle = boxStyleWithinCard(imageBox, layout.card);
      const captionStyle = layout.caption ? boxStyleWithinCard(layout.caption, layout.card) : '';
      const overlayInfo = project.infoPlacement === 'overlay';
      const belowInfo = project.infoPlacement === 'below';
      const showInfo = project.infoPlacement !== 'none';
      const infoStyleClass = `description-style-${project.infoStyle || 'dark'}`;
      const descriptionTextColor = project.descriptionTextColor || (project.infoStyle === 'light' ? '#000000' : '#ffffff');
      const infoMarkup = showInfo ? `<div class="description-box has-description-color ${overlayInfo ? 'description-overlay ' : ''}${infoStyleClass} ${item.description?.trim() ? '' : 'is-empty'}" style="${overlayInfo ? `height:${photoInfoHeight(item)}%;min-height:${photoInfoMinHeight(item)}px;` : captionStyle}--description-text-color:${descriptionTextColor};--description-box-color:${colorWithAlpha(project.descriptionBoxColor, .72)};"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(item.description?.trim() || '')}</small></div>` : '';
      const node = document.createElement('div');
      node.className = `design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'}${item.cameraMoveSpill ? ' has-camera-spill' : ''}`;
      node.style.cssText = `left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%`;
      node.innerHTML = `<div class="design-photo${item.cameraMoveSpill ? ' camera-spill' : ''}" style="${imageStyle}"><img src="${asset.image}" alt="" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span class="item-number">${number}</span>${drawingMarkup(item)}${cameraMoveMarkup(item)}${overlayInfo ? infoMarkup : ''}</div>${belowInfo ? infoMarkup : ''}`;
      sheet.appendChild(node);
    });
    sheet.insertAdjacentHTML('beforeend', storyboardMetaMarkup(pageIndex + 1, project.pages.length));
    layer.appendChild(sheet);
  });
  document.body.appendChild(layer); const cleanup = () => layer.remove(); window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup, 2500);
}

function openExport() { $('#exportModal').hidden = false; }
function closeExport() { $('#exportModal').hidden = true; }
function openFormatModal() {
  const isNew = pendingNewProject;
  $('#newProjectFields').hidden = !isNew;
  $('#formatTitle').textContent = isNew ? 'Completá los datos del proyecto' : 'Elegí el formato del canvas';
  $('#formatCopy').textContent = isNew ? 'Antes de elegir el formato, completá el título y el cliente. Los demás datos son opcionales.' : 'El formato queda fijo para todo este proyecto. Si necesitás otro, creá una versión desde el editor.';
  $('#formatChoiceHeading').hidden = !isNew;
  if (!isNew && project) $$('#newProjectFields .text-field').forEach(input => { input.value = ({ newProjectTitle: project.title, newProjectClient: project.client, newProjectAgency: project.agency, newProjectProducer: project.producer, newProjectDirector: project.director }[input.id] || ''); });
  $('#formatModal').hidden = false;
}
function closeFormatModal() { $('#formatModal').hidden = true; $('#newProjectError').textContent = ''; $$('#newProjectTitle, #newProjectClient').forEach(input => input.classList.remove('is-invalid')); }
function closeNewProjectFormat() {
  pendingNewProject = false;
  project = null;
  currentProjectId = null;
  closeFormatModal();
  showDashboard();
}
function openVersionModal() {
  if (!project) return;
  $$('#versionModal [data-version-format]').forEach(button => { button.disabled = button.dataset.versionFormat === project.ratio; button.title = button.disabled ? 'Este es el formato actual' : 'Crear una copia en este formato'; });
  $('#versionModal').hidden = false;
}
function closeVersionModal() { $('#versionModal').hidden = true; }
function createProjectVersion(format) {
  if (!project || format === project.ratio) return;
  const labels = { landscape: 'Horizontal', portrait: 'Vertical', square: '1:1' };
  const variant = normalizeProject(JSON.parse(JSON.stringify(project)));
  variant.id = createId('project');
  variant.versionGroupId = project.versionGroupId || project.id;
  variant.versionName = labels[format] || format;
  variant.title = project.title || 'Storyboard';
  variant.ratio = format;
  variant.formatLocked = true;
  variant.createdAt = new Date().toISOString();
  variant.updatedAt = variant.createdAt;
  variant.pages = variant.pages.map((page, pageIndex) => ({ ...page, id: createId('page'), title: page.title || `Página ${pageIndex + 1}`, items: page.items.map(item => ({ ...item, id: createId('item') })) }));
  projects.unshift(variant);
  persistProjects();
  project = variant;
  currentProjectId = variant.id;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  lastUndoState = null;
  closeVersionModal();
  showEditor();
  render();
  saveProject();
  showToast(`Versión ${labels[format] || format} creada`);
}
function selectProjectFormat(format) {
  if (pendingNewProject) {
    const fields = { title: $('#newProjectTitle'), client: $('#newProjectClient'), agency: $('#newProjectAgency'), producer: $('#newProjectProducer'), director: $('#newProjectDirector') };
    const title = fields.title.value.trim();
    const client = fields.client.value.trim();
    fields.title.classList.toggle('is-invalid', !title);
    fields.client.classList.toggle('is-invalid', !client);
    if (!title || !client) {
      $('#newProjectError').textContent = !title && !client ? 'Completá el título y el cliente para continuar.' : !title ? 'Completá el título del proyecto para continuar.' : 'Completá el cliente para continuar.';
      (!title ? fields.title : fields.client).focus();
      return;
    }
    project = normalizeProject({ ...defaultProject(), title, client, agency: fields.agency.value.trim(), producer: DEFAULT_PRODUCER_NAME, author: DEFAULT_PRODUCER_NAME, director: fields.director.value.trim(), ratio: format, formatLocked: true, versionName: 'Base' });
    project.versionGroupId = project.id;
    pendingNewProject = false;
    currentProjectId = project.id;
    currentPageIndex = 0;
    selectedItemId = null;
    activeInspector = 'page';
    closeFormatModal();
    showEditor();
    render();
    saveProject();
    showToast('Proyecto creado');
    return;
  }
  if (!project) return;
  project.ratio = format;
  project.formatLocked = true;
  closeFormatModal();
  render();
  saveProject();
  const labels = { landscape: 'Horizontal', portrait: 'Vertical', square: 'Cuadrado' };
  showToast(`Canvas ${labels[format] || ''} seleccionado`);
}
function createProjectDraft() {
  if (!window.STUDIO_PERMISSIONS?.storyboards) return;
  pendingNewProject = true;
  project = null;
  lastUndoState = null;
  currentProjectId = null;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  ['newProjectTitle', 'newProjectClient', 'newProjectAgency', 'newProjectProducer', 'newProjectDirector'].forEach(id => { const input = $('#' + id); input.value = ''; input.classList.remove('is-invalid'); });
  $('#newProjectError').textContent = '';
  openFormatModal();
}
function resetProject() {
  if (project) { $('#newProjectConfirmModal').hidden = false; return; }
  createProjectDraft();
}
function closeNewProjectConfirm() { $('#newProjectConfirmModal').hidden = true; }

$('#uploadZone').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; });
$('#uploadZone').addEventListener('dragover', event => { event.preventDefault(); $('#uploadZone').classList.add('is-over'); });
$('#uploadZone').addEventListener('dragleave', () => $('#uploadZone').classList.remove('is-over'));
$('#uploadZone').addEventListener('drop', event => { event.preventDefault(); $('#uploadZone').classList.remove('is-over'); handleFiles(event.dataTransfer.files); });

$('#canvasPage').addEventListener('pointerdown', startMarqueeSelection);
$('#canvasPage').addEventListener('click', event => {
  if (suppressCanvasClick) { suppressCanvasClick = false; return; }
  if (!event.target.closest('.design-item')) { clearItemSelection(); activeInspector = 'page'; render(); }
});
$('#canvasPage').addEventListener('dragover', event => { event.preventDefault(); $('#canvasPage').classList.add('is-drop-target'); hoverSlotIndex = slotAtPoint(event.clientX, event.clientY); updateSlotGuides(); });
$('#canvasPage').addEventListener('dragleave', event => { if (!$('#canvasPage').contains(event.relatedTarget)) $('#canvasPage').classList.remove('is-drop-target'); });
$('#canvasPage').addEventListener('drop', event => { event.preventDefault(); $('#canvasPage').classList.remove('is-drop-target'); const targetSlot = slotAtPoint(event.clientX, event.clientY) ?? currentPage().items.length; const assetId = draggedAssetId; draggedAssetId = null; slotMode = false; hoverSlotIndex = null; if (assetId) addAssetToPage(assetId, targetSlot); else if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files, targetSlot); });

$('#autoArrangeBtn').addEventListener('click', autoArrange);
$$('.format-btn').forEach(button => button.addEventListener('click', () => { if (project.formatLocked) { showToast('El formato está fijado para este proyecto'); return; } project.ratio = button.dataset.format; render(); saveProject(); }));
$('#zoomOutBtn').addEventListener('click', () => { zoom = clamp(zoom - .1, .6, 1.4); renderControls(); }); $('#zoomInBtn').addEventListener('click', () => { zoom = clamp(zoom + .1, .6, 1.4); renderControls(); });
$('#prevPageBtn').addEventListener('click', () => { if (currentPageIndex > 0) { currentPageIndex--; selectedItemId = null; render(); } }); $('#nextPageBtn').addEventListener('click', () => { if (currentPageIndex < project.pages.length - 1) { currentPageIndex++; selectedItemId = null; render(); } });

['projectTitle', 'projectProducer', 'projectClient', 'projectAgency', 'projectDirector'].forEach(id => $('#' + id).addEventListener('input', event => { const key = { projectTitle: 'title', projectProducer: 'producer', projectClient: 'client', projectAgency: 'agency', projectDirector: 'director' }[id]; project[key] = id === 'projectProducer' ? DEFAULT_PRODUCER_NAME : event.target.value; if (id === 'projectProducer') { project.author = DEFAULT_PRODUCER_NAME; project.producerBrandingConfigured = true; $('#projectProducerDisplay').textContent = DEFAULT_PRODUCER_NAME; $('#projectProducerLabel').hidden = false; } if (id === 'projectTitle') $('#projectTitleDisplay').textContent = project.title || 'Sin título'; $('#breadcrumbTitle').textContent = project.title || 'Sin título'; renderPage(); saveProject(); }));
$('#backgroundColor').addEventListener('input', event => { project.background = validHexColor(event.target.value, '#ffffff'); previewArtboardBackgroundSettings(); saveProject(); });
$('#backgroundPatternColor').addEventListener('input', event => { project.backgroundPatternColor = validHexColor(event.target.value, '#c7c7c7'); previewArtboardBackgroundSettings(); saveProject(); });
$('#backgroundImageOpacity').addEventListener('input', event => { project.backgroundImageOpacity = Number(event.target.value); previewArtboardBackgroundSettings(); saveProject(); });
$('#backgroundImageBlur').addEventListener('input', event => { project.backgroundImageBlur = Number(event.target.value); previewArtboardBackgroundSettings(); saveProject(); });
['backgroundColor', 'backgroundPatternColor', 'backgroundImageOpacity', 'backgroundImageBlur'].forEach(id => $('#' + id).addEventListener('change', render));
$('#backgroundImageBtn').addEventListener('click', () => $('#backgroundImageInput').click());
$('#backgroundImageInput').addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (!file.type.startsWith('image/')) { showToast('Elegí un archivo de imagen'); return; } const activeProject = project; const url = URL.createObjectURL(file); try { const image = await compressBackgroundImage(url); if (project !== activeProject) return; project.backgroundImage = image; project.backgroundImageName = file.name; project.backgroundPattern = 'none'; render(); saveProject(); showToast('Foto de fondo cargada'); } catch (error) { console.error('No se pudo cargar la foto de fondo.', error); showToast('No se pudo cargar la foto de fondo'); } finally { URL.revokeObjectURL(url); } });
$('#removeBackgroundImageBtn').addEventListener('click', () => { if (!project.backgroundImage) return; project.backgroundImage = ''; project.backgroundImageName = ''; render(); saveProject(); });
$('#backgroundPattern').addEventListener('change', event => { const pattern = BACKGROUND_PATTERNS.has(event.target.value) ? event.target.value : 'none'; project.backgroundPattern = pattern; if (pattern !== 'none') { project.backgroundImage = ''; project.backgroundImageName = ''; } render(); saveProject(); });
$('#layoutEngine').addEventListener('change', event => { project.layoutEngine = event.target.value === 'adaptive' ? 'adaptive' : 'grid'; project.layoutEngineVersion = 1; render(); saveProject(); });
$('#pageGap').addEventListener('input', event => { project.gap = Number(event.target.value); render(); saveProject(); }); $('#pagePadding').addEventListener('input', event => { project.padding = Number(event.target.value); render(); saveProject(); }); $('#infoPlacement').addEventListener('change', event => { project.infoPlacement = ['below', 'overlay', 'none'].includes(event.target.value) ? event.target.value : 'below'; render(); saveProject(); }); $('#frameTextColor').addEventListener('input', event => { project.frameTextColor = validHexColor(event.target.value, '#111111'); previewStoryboardColors(); saveProject(); }); $('#descriptionBoxColor').addEventListener('input', event => { project.descriptionBoxColor = validHexColor(event.target.value, '#000000'); previewStoryboardColors(); saveProject(); }); $('#descriptionTextColor').addEventListener('input', event => { project.descriptionTextColor = validHexColor(event.target.value, '#ffffff'); previewStoryboardColors(); saveProject(); }); ['frameTextColor', 'descriptionBoxColor', 'descriptionTextColor'].forEach(id => $('#' + id).addEventListener('change', render)); $('#showProjectTitle').addEventListener('change', event => { project.showProjectTitle = event.target.checked; render(); saveProject(); });
$('#showProducerBranding').addEventListener('change', event => { project.showProducerBranding = event.target.checked; project.producerBrandingConfigured = true; render(); saveProject(); });
$('#showProjectFrame').addEventListener('change', event => { project.showProjectFrame = event.target.checked; render(); saveProject(); });
$('#showClientMeta').addEventListener('change', event => { project.showClientMeta = event.target.checked; render(); saveProject(); });
$('#showAgencyMeta').addEventListener('change', event => { project.showAgencyMeta = event.target.checked; render(); saveProject(); });
$('#showDirectorMeta').addEventListener('change', event => { project.showDirectorMeta = event.target.checked; render(); saveProject(); });
$('#showPageNumber').addEventListener('change', event => { project.showPageNumber = event.target.checked; render(); saveProject(); });
$('#producerLogoBtn').addEventListener('click', () => $('#producerLogoInput').click());
$('#producerLogoInput').addEventListener('change', event => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { showToast('Elegí un archivo de imagen'); event.target.value = ''; return; } const reader = new FileReader(); reader.onload = () => { project.producerLogo = reader.result; project.producerLogoName = file.name; project.showProducerBranding = true; render(); saveProject(); showToast('Logo de productora cargado'); }; reader.readAsDataURL(file); event.target.value = ''; });
$('#removeProducerLogoBtn').addEventListener('click', () => { project.producerLogo = ''; project.producerLogoName = ''; render(); saveProject(); });
$('#clientLogoBtn').addEventListener('click', () => $('#clientLogoInput').click());
$('#clientLogoInput').addEventListener('change', event => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { showToast('Elegí un archivo de imagen'); event.target.value = ''; return; } const reader = new FileReader(); reader.onload = () => { project.clientLogo = reader.result; project.clientLogoName = file.name; render(); saveProject(); showToast('Logo de cliente cargado'); }; reader.readAsDataURL(file); event.target.value = ''; });
$('#removeClientLogoBtn').addEventListener('click', () => { project.clientLogo = ''; project.clientLogoName = ''; render(); saveProject(); });
$$('.fit-default-btn').forEach(button => button.addEventListener('click', () => { const mode = validFrameMode(button.dataset.frame) ? button.dataset.frame : 'original'; project.defaultFrame = mode; project.defaultCropAspect = frameAspect(mode); project.defaultFit = mode === 'original' ? 'contain' : 'cover'; renderControls(); saveProject(); }));
$('#clearPageBtn').addEventListener('click', () => { if (currentPage().items.length) $('#clearPageConfirmModal').hidden = false; });

$$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => {
  activeInspector = tab.dataset.inspector;
  if (activeInspector === 'photo' && selectedItems().length > 1) {
    const item = findItem(selectedItemId) || selectedItems()[0];
    setItemSelection([item], item.id);
    renderPage();
  }
  renderInspector();
}));
$('#selectAllPhotosBtn').addEventListener('click', selectAllCurrentPage);
$('#clearPhotoSelectionBtn').addEventListener('click', () => { clearItemSelection(); activeInspector = 'page'; render(); });
$$('.batch-fit-btn').forEach(button => button.addEventListener('click', () => applyFrameToSelection(button.dataset.frame)));
$$('.fit-btn').forEach(button => button.addEventListener('click', () => { const item = findItem(selectedItemId); if (!item) return; Object.assign(item, frameFields(validFrameMode(button.dataset.frame) ? button.dataset.frame : 'original')); renderPage(); renderInspector(); saveProject(); }));
$('#photoFocusX').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusX = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoFocusY').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusY = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoShotType').addEventListener('change', event => { const item = findItem(selectedItemId); if (!item) return; item.shotType = event.target.value; renderPage(); renderInspector(); saveProject(); }); $('#photoTitle').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.title = event.target.value; renderPage(); saveProject(); }); $('#photoDescription').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.description = event.target.value; renderPage(); saveProject(); });
$$('.camera-preset').forEach(button => button.addEventListener('click', () => { const item = findItem(selectedItemId); if (!item) return; item.cameraMove = CAMERA_MOVE_VALUES.has(button.dataset.cameraPreset) ? button.dataset.cameraPreset : 'none'; item.cameraMoveMode = 'overlay'; if (item.cameraMove === 'none' && annotationToolMode === 'move') annotationToolMode = 'none'; renderPage(); renderInspector(); saveProject(); }));
$('#photoAnnotationColor').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; const color = validHexColor(event.target.value, '#ff3b30'); item.cameraMoveColor = color; item.drawingColor = color; document.querySelector(`[data-camera-overlay="${CSS.escape(item.id)}"]`)?.style.setProperty('--camera-color', color); saveProject(); });
$('#photoAnnotationColor').addEventListener('change', renderPage);
$('#photoCameraScale').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.cameraMoveScale = clamp(Number(event.target.value) / 100, .45, 1.45); $('#cameraScaleValue').textContent = `${Math.round(item.cameraMoveScale * 100)}%`; renderPage(); saveProject(); });
$('#cameraMoveSpill').addEventListener('change', event => { const item = findItem(selectedItemId); if (!item) return; item.cameraMoveSpill = event.target.checked; const moveMin = item.cameraMoveSpill ? -400 : 8; const moveMax = item.cameraMoveSpill ? 400 : 92; const cameraMoveX = Number(item.cameraMoveX); const cameraMoveY = Number(item.cameraMoveY); item.cameraMoveX = clamp(Number.isFinite(cameraMoveX) ? cameraMoveX : 50, moveMin, moveMax); item.cameraMoveY = clamp(Number.isFinite(cameraMoveY) ? cameraMoveY : 50, moveMin, moveMax); renderPage(); renderInspector(); saveProject(); });
$('#photoDrawingWidth').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.drawingWidth = clamp(Number(event.target.value), .8, 8); $('#drawingWidthValue').textContent = item.drawingWidth.toFixed(1); saveProject(); });
$('#moveCameraOverlayBtn').addEventListener('click', () => setAnnotationToolMode('move'));
$('#drawOnPhotoBtn').addEventListener('click', () => setAnnotationToolMode('draw'));
$('#undoDrawingBtn').addEventListener('click', () => { const item = findItem(selectedItemId); if (!item?.drawingStrokes?.length) return; item.drawingStrokes.pop(); renderPage(); renderInspector(); saveProject(); });
$('#clearDrawingBtn').addEventListener('click', () => { const item = findItem(selectedItemId); if (!item?.drawingStrokes?.length) return; item.drawingStrokes = []; renderPage(); renderInspector(); saveProject(); });
$('#deletePhotoBtn').addEventListener('click', deleteSelected); $('#duplicatePhotoBtn').addEventListener('click', duplicateSelected); $('#clearLibraryBtn').addEventListener('click', () => { if (project?.assets.length) $('#clearLibraryConfirmModal').hidden = false; });

$('#dashboardCreateBtn').addEventListener('click', resetProject);
$('#dashboardEmptyCreateBtn').addEventListener('click', resetProject);
$('#storyboardsNav').addEventListener('click', () => { if (window.STUDIO_PERMISSIONS?.storyboards) showDashboard(); });
document.querySelector('.brand').addEventListener('click', event => {
  event.preventDefault();
  if (document.documentElement.dataset.studioApp === 'reviews') window.STUDIO_SHOW_REVIEWS?.();
  else if (window.STUDIO_PERMISSIONS?.storyboards) showDashboard();
});
$('#backToDashboardBtn').addEventListener('click', showDashboard);
$('#manageVersionsBtn').addEventListener('click', openVersionsModal);
$('#createVersionBtn').addEventListener('click', openVersionModal);
$('#exportBtn').addEventListener('click', openExport);
$$('[data-close-modal]').forEach(button => button.addEventListener('click', closeExport));
$('#exportModal').addEventListener('click', event => { if (event.target === $('#exportModal')) closeExport(); });
$$('[data-project-format]').forEach(button => button.addEventListener('click', () => selectProjectFormat(button.dataset.projectFormat)));
$$('[data-version-format]').forEach(button => button.addEventListener('click', () => createProjectVersion(button.dataset.versionFormat)));
$('#cancelVersionBtn').addEventListener('click', closeVersionModal);
$('#versionModal').addEventListener('click', event => { if (event.target === $('#versionModal')) closeVersionModal(); });
$('#cancelVersionsBtn').addEventListener('click', closeVersionsModal);
$('#versionsModal').addEventListener('click', event => { if (event.target === $('#versionsModal')) closeVersionsModal(); });
$('#cancelDeleteVersionBtn').addEventListener('click', closeDeleteVersionModal);
$('#cancelDeleteVersionBtnSecondary').addEventListener('click', closeDeleteVersionModal);
$('#confirmDeleteVersionBtn').addEventListener('click', confirmDeleteVersion);
$('#deleteVersionModal').addEventListener('click', event => { if (event.target === $('#deleteVersionModal')) closeDeleteVersionModal(); });
$('#cancelNewProjectBtn').addEventListener('click', closeNewProjectConfirm);
$('#cancelNewProjectBtnSecondary').addEventListener('click', closeNewProjectConfirm);
$('#confirmNewProjectBtn').addEventListener('click', () => { closeNewProjectConfirm(); createProjectDraft(); });
$('#newProjectConfirmModal').addEventListener('click', event => { if (event.target === $('#newProjectConfirmModal')) closeNewProjectConfirm(); });
$('#cancelDeletePageBtn').addEventListener('click', closeDeletePageConfirm);
$('#cancelDeletePageBtnSecondary').addEventListener('click', closeDeletePageConfirm);
$('#confirmDeletePageBtn').addEventListener('click', confirmDeletePage);
$('#deletePageConfirmModal').addEventListener('click', event => { if (event.target === $('#deletePageConfirmModal')) closeDeletePageConfirm(); });
$('#cancelClearPageBtn').addEventListener('click', closeClearPageConfirm);
$('#cancelClearPageBtnSecondary').addEventListener('click', closeClearPageConfirm);
$('#confirmClearPageBtn').addEventListener('click', confirmClearPage);
$('#clearPageConfirmModal').addEventListener('click', event => { if (event.target === $('#clearPageConfirmModal')) closeClearPageConfirm(); });
$('#cancelClearLibraryBtn').addEventListener('click', closeClearLibraryConfirm);
$('#cancelClearLibraryBtnSecondary').addEventListener('click', closeClearLibraryConfirm);
$('#confirmClearLibraryBtn').addEventListener('click', confirmClearLibrary);
$('#clearLibraryConfirmModal').addEventListener('click', event => { if (event.target === $('#clearLibraryConfirmModal')) closeClearLibraryConfirm(); });
$('#cancelDeleteProjectBtn').addEventListener('click', closeDeleteProjectModal);
$('#cancelDeleteProjectBtnSecondary').addEventListener('click', closeDeleteProjectModal);
$('#confirmDeleteProjectBtn').addEventListener('click', confirmDeleteProject);
$('#deleteProjectModal').addEventListener('click', event => { if (event.target === $('#deleteProjectModal')) closeDeleteProjectModal(); });
$('#projectSort').addEventListener('change', event => { projectSort = ['updated', 'title', 'client'].includes(event.target.value) ? event.target.value : 'updated'; localStorage.setItem(PROJECT_SORT_KEY, projectSort); renderDashboard(); }); $('#cancelFormatBtn').addEventListener('click', () => pendingNewProject ? closeNewProjectFormat() : closeFormatModal()); $('#formatModal').addEventListener('click', event => { if (event.target === $('#formatModal')) pendingNewProject ? closeNewProjectFormat() : closeFormatModal(); });
$$('[data-export]').forEach(button => button.addEventListener('click', async () => { const type = button.dataset.export; closeExport(); if (type === 'png-all') await exportAllPagesPng(); else if (type === 'print') printAllPages(); else await exportImage(type); }));

document.addEventListener('click', event => { if (!event.target.closest('.page-thumb-wrap')) closePageMenus(); });
window.addEventListener('resize', () => requestAnimationFrame(fitCanvasPage));
document.addEventListener('keydown', event => {
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); showToast('Proyecto guardado'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !editing && project && !$('#editorView').hidden) { event.preventDefault(); selectAllCurrentPage(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); restoreLastUndo(); }
  if (event.key === 'Delete' && !editing) { if (selectedItems().length) deleteSelected(); else if (project && !$('#editorView').hidden) deleteCurrentPage(); }
  if (event.key === 'Escape') { closeExport(); closeVersionModal(); closeNewProjectConfirm(); closeDeletePageConfirm(); closeClearPageConfirm(); closeClearLibraryConfirm(); closeDeleteProjectModal(); closePageMenus(); }
});

window.addEventListener('studio-auth-change', () => {
  const allowed = window.STUDIO_PERMISSIONS?.storyboards === true;
  $('#storyboardsNav').hidden = !allowed;
  $('#dashboardCreateBtn').hidden = !allowed;
  $('#dashboardEmptyCreateBtn').hidden = !allowed;
  if (allowed) {
    if (document.documentElement.dataset.studioApp === 'storyboards' && !$('#dashboardView').hidden) renderDashboard();
    hydrateProjectsFromIndexedDb();
    return;
  }
  // Permission changes can arrive while a storyboard editor is already open.
  // Save is denied by saveProject(), then move the visible workspace to an
  // authorized section or leave it behind the auth gate.
  if (!document.body.classList.contains('auth-locked')) {
    if (window.STUDIO_PERMISSIONS?.reviewsView || window.STUDIO_PERMISSIONS?.reviewsClient) window.STUDIO_SHOW_REVIEWS?.();
    else document.body.classList.add('auth-locked');
  }
});

window.showDashboard = showDashboard;
showDashboard();

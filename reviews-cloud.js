// Shared Reviews data. Dropbox remains the only media host; Firestore stores links and feedback.
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(window.STORYBOARD_FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const ADMIN_EMAIL = 'info@granbertafilms.com';
export const PERMISSION_KEYS = ['storyboards', 'storyboardsView', 'pdr', 'pdrView', 'reviewsClient', 'reviewsView', 'reviewsCreate', 'reviewsEdit', 'reviewsShare'];
export const ALL_PERMISSIONS = { ...Object.fromEntries(PERMISSION_KEYS.map(key => [key, true])), reviewsClient: false };
function normalizedPermissions(data) {
  if (!data || data.active === false) return null;
  const permissions = Object.fromEntries(PERMISSION_KEYS.map(key => [key, data.permissions?.[key] === true]));
  // Legacy entries without explicit permissions keep Visto, but never inherit all of Mira.
  if (!data.permissions) { permissions.storyboards = true; permissions.storyboardsView = true; }
  if (data.roles?.reviews === 'client' || permissions.reviewsClient) {
    permissions.reviewsClient = true;
    for (const key of ['reviewsView', 'reviewsCreate', 'reviewsEdit', 'reviewsShare']) permissions[key] = false;
  }
  return Object.values(permissions).some(Boolean) ? permissions : null;
}
const shareRef = token => doc(db, 'reviewShares', token);
const fileRef = (token, id) => doc(db, 'reviewShares', token, 'files', id);
const commentRef = (token, fileId, id) => doc(db, 'reviewShares', token, 'files', fileId, 'comments', id);
const encodeStrokes = strokes => JSON.stringify(Array.isArray(strokes) ? strokes : []);
function decodeComment(item) {
  const data = item.data();
  let strokes = [];
  try { const parsed = JSON.parse(data.strokesJson || '[]'); if (Array.isArray(parsed)) strokes = parsed; } catch { /* Ignore malformed old drawing data. */ }
  return { ...data, id: item.id, strokes };
}

export async function staffRole(user) {
  if (!user || user.isAnonymous || !user.emailVerified || !user.providerData.some(provider => provider.providerId === 'google.com')) return null;
  if (user.email?.toLowerCase() === ADMIN_EMAIL) return { role: 'admin', permissions: { ...ALL_PERMISSIONS } };
  const member = await getDoc(doc(db, 'reviewStaff', user.email.toLowerCase()));
  const permissions = normalizedPermissions(member.exists() ? member.data() : null);
  return permissions ? { role: 'staff', permissions, roles: member.data().roles || {}, reviewTokens: Array.isArray(member.data().reviewTokens) ? member.data().reviewTokens : [] } : null;
}
export function watchStaffRole(user, callback, onError) {
  return onSnapshot(doc(db, 'reviewStaff', user.email.toLowerCase()),
    snapshot => {
      const permissions = normalizedPermissions(snapshot.exists() ? snapshot.data() : null);
      callback(permissions ? { role: 'staff', permissions, roles: snapshot.data().roles || {}, reviewTokens: Array.isArray(snapshot.data().reviewTokens) ? snapshot.data().reviewTokens : [] } : null);
    }, onError);
}

export async function registerAccessRequest(user) {
  const ref = doc(db, 'accessRequests', user.uid);
  if ((await getDoc(ref)).exists()) return;
  await setDoc(ref, { uid: user.uid, email: user.email.toLowerCase(), name: (user.displayName || '').slice(0, 100), createdAt: serverTimestamp() });
}
export async function accessRequests() {
  const snapshot = await getDocs(collection(db, 'accessRequests'));
  return snapshot.docs.map(item => item.data()).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export async function staffList() {
  const snapshot = await getDocs(collection(db, 'reviewStaff'));
  return snapshot.docs.map(item => ({ email: item.id, ...item.data() })).sort((a, b) => a.email.localeCompare(b.email));
}
export async function saveStaff(email, permissions, name = '', options = {}) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Escribí un correo válido.');
  if (normalized === ADMIN_EMAIL) throw new Error('Esta cuenta ya es administradora.');
  const safe = Object.fromEntries(PERMISSION_KEYS.map(key => [key, permissions?.[key] === true]));
  const active = options.active !== false;
  if (active && !Object.values(safe).some(Boolean)) throw new Error('Seleccioná al menos una aplicación o desactivá el acceso.');
  if (safe.reviewsClient && (safe.reviewsView || safe.reviewsCreate || safe.reviewsEdit || safe.reviewsShare)) throw new Error('El rol Cliente no puede combinarse con acceso a toda la biblioteca.');
  if ((safe.reviewsCreate || safe.reviewsEdit || safe.reviewsShare) && !safe.reviewsView) throw new Error('Para trabajar en Reviews, habilitá también Ver Reviews.');
  if ((safe.reviewsCreate || safe.reviewsShare) && !safe.reviewsEdit) throw new Error('Para crear o compartir reviews, habilitá también Editar Reviews.');
  const reviewTokens = [...new Set((Array.isArray(options.reviewTokens) ? options.reviewTokens : []).filter(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)))];
  if (safe.storyboards) safe.storyboardsView = true;
  if (safe.pdr) safe.pdrView = true;
  const roles = { storyboards: safe.storyboards ? 'editor' : safe.storyboardsView ? 'viewer' : 'none', pdr: safe.pdr ? 'editor' : safe.pdrView ? 'viewer' : 'none', reviews: safe.reviewsClient ? 'client' : options.roles?.reviews || 'custom' };
  await setDoc(doc(db, 'reviewStaff', normalized), { name: name.trim().slice(0, 100), active, roles,
    permissions: safe, reviewTokens: safe.reviewsClient ? reviewTokens : [], updatedAt: new Date().toISOString(), updatedBy: auth.currentUser?.email || '' });
}
export async function removeStaff(email) {
  const normalized = email.trim().toLowerCase();
  await deleteDoc(doc(db, 'reviewStaff', normalized));
  const requests = await getDocs(collection(db, 'accessRequests'));
  for (const request of requests.docs) if (request.data().email === normalized) await deleteDoc(request.ref);
}

// Visto stores complete project snapshots in small Firestore documents. A revision
// becomes visible only after all its chunks have been uploaded successfully.
const storyboardRef = id => doc(db, 'storyboardProjects', id);
const storyboardChunks = id => collection(db, 'storyboardProjects', id, 'chunks');
const STORYBOARD_CHUNK_BYTES = 120000;
function encodeStoryboard(project) {
  const bytes = new TextEncoder().encode(JSON.stringify(project));
  const chunks = [];
  for (let start = 0; start < bytes.length; start += STORYBOARD_CHUNK_BYTES) {
    const part = bytes.subarray(start, start + STORYBOARD_CHUNK_BYTES);
    let binary = '';
    for (let offset = 0; offset < part.length; offset += 16000) binary += String.fromCharCode(...part.subarray(offset, offset + 16000));
    chunks.push(btoa(binary));
  }
  return chunks;
}
function decodeStoryboard(chunks) {
  const parts = chunks.map(value => Uint8Array.from(atob(value), character => character.charCodeAt(0)));
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function saveStoryboardProject(project) {
  const chunks = encodeStoryboard(project);
  const revision = crypto.randomUUID();
  for (let index = 0; index < chunks.length; index++) {
    await setDoc(doc(storyboardChunks(project.id), `${revision}-${index}`), { data: chunks[index] });
  }
  await setDoc(storyboardRef(project.id), {
    title: project.title || '', client: project.client || '', versionGroupId: project.versionGroupId || project.id,
    versionName: project.versionName || 'Base', updatedAt: project.updatedAt || new Date().toISOString(),
    revision, chunkCount: chunks.length,
  });
  try {
    const oldChunks = await getDocs(storyboardChunks(project.id));
    for (const item of oldChunks.docs) if (!item.id.startsWith(`${revision}-`)) await deleteDoc(item.ref);
  } catch (error) { console.warn('Could not remove an old Visto snapshot', error); }
}
export async function deleteStoryboardProject(id) {
  await deleteDoc(storyboardRef(id));
  const chunks = await getDocs(storyboardChunks(id));
  for (const item of chunks.docs) await deleteDoc(item.ref);
}
export async function listStoryboardProjects() {
  const projects = await getDocs(collection(db, 'storyboardProjects'));
  return Promise.all(projects.docs.map(async item => {
    const { revision, chunkCount } = item.data();
    if (!revision || !Number.isInteger(chunkCount) || chunkCount < 1) return null;
    const snapshots = await Promise.all(Array.from({ length: chunkCount }, (_, index) => getDoc(doc(storyboardChunks(item.id), `${revision}-${index}`))));
    if (snapshots.some(snapshot => !snapshot.exists())) return null;
    try { return decodeStoryboard(snapshots.map(snapshot => snapshot.data().data)); }
    catch (error) { console.error('Could not open Visto project', item.id, error); return null; }
  })).then(items => items.filter(Boolean));
}

export async function saveStaffProject(project) {
  const { versions, ...rest } = project;
  await setDoc(doc(db, 'reviewProjects', project.id), { ...rest, versionsJson: JSON.stringify(versions || []) });
}
export async function deleteStaffProject(id) { await deleteDoc(doc(db, 'reviewProjects', id)); }
export async function listStaffProjects() {
  const snapshot = await getDocs(collection(db, 'reviewProjects'));
  return snapshot.docs.map(item => {
    const data = item.data();
    let versions = [];
    try { versions = JSON.parse(data.versionsJson || '[]'); } catch { /* Preserve the project even if version metadata is malformed. */ }
    const { versionsJson, ...rest } = data;
    return { ...rest, id: item.id, versions };
  });
}
export async function saveStaffFile(record) {
  if (record.source !== 'dropbox') return;
  const commentsJson = JSON.stringify(record.comments || []);
  if (commentsJson.length > 700000) throw new Error('Esta review tiene demasiadas anotaciones para sincronizar en un solo archivo.');
  await setDoc(doc(db, 'reviewItems', record.id), { ...cloudFile(record), projectId: record.projectId,
    versionId: record.versionId, commentsJson });
}
export async function deleteStaffFile(id) { await deleteDoc(doc(db, 'reviewItems', id)); }
export async function listStaffFiles() {
  const snapshot = await getDocs(collection(db, 'reviewItems'));
  return snapshot.docs.map(item => {
    const data = item.data();
    let comments = [];
    try { comments = JSON.parse(data.commentsJson || '[]'); } catch { /* Ignore malformed old feedback. */ }
    const { commentsJson, ...rest } = data;
    return { ...rest, id: item.id, comments };
  });
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function cloudFile(record) {
  return { name: record.name, kind: record.kind, source: 'dropbox', sourceUrl: record.sourceUrl,
    sectionId: record.sectionId || 'default', sortIndex: Number(record.sortIndex) || 0,
    fps: Number(record.fps) || 24, frameStart: Number(record.frameStart) || 1,
    timelineMode: record.timelineMode || 'time', inPoint: record.inPoint ?? null, outPoint: record.outPoint ?? null,
    createdAt: record.createdAt || new Date().toISOString(), updatedAt: record.updatedAt || new Date().toISOString() };
}
export async function publishReview(project, version, records) {
  const id = version.shareToken || token();
  const firstPublish = !version.shareToken;
  const share = { projectId: project.id, versionId: version.id, projectTitle: project.title,
    versionTitle: version.title, category: version.category || 'General', sections: version.sections || [],
    client: project.client || '', agency: project.agency || '', director: project.director || '',
    active: true, updatedAt: new Date().toISOString(), createdBy: auth.currentUser?.uid || '' };
  // Stage the files first; the bearer link is only usable after the share document exists.
  try {
    for (const record of records) {
      if (record.source !== 'dropbox') continue;
      await setDoc(fileRef(id, record.id), cloudFile(record));
      if (firstPublish) for (const comment of record.comments || []) {
        const { strokes, ...rest } = comment;
        await setDoc(commentRef(id, record.id, comment.id), { ...rest, strokesJson: encodeStrokes(strokes), authorUid: auth.currentUser?.uid || '', authorName: 'Equipo' });
      }
    }
    await setDoc(shareRef(id), share);
  } catch (error) {
    if (firstPublish) for (const record of records) {
      try { await removeSharedFile(id, record.id); } catch (cleanupError) { console.error('Could not clean up a staged review file', cleanupError); }
    }
    throw error;
  }
  return id;
}
export async function updateShareMetadata(project, version) {
  if (!version.shareToken) return;
  await updateDoc(shareRef(version.shareToken), { projectTitle: project.title, versionTitle: version.title,
    category: version.category || 'General', sections: version.sections || [], client: project.client || '',
    agency: project.agency || '', director: project.director || '', updatedAt: new Date().toISOString() });
}
export async function upsertSharedFile(token, record) {
  if (record.source === 'dropbox') await setDoc(fileRef(token, record.id), cloudFile(record));
}
export async function removeSharedFile(token, id) {
  const comments = await getDocs(collection(db, 'reviewShares', token, 'files', id, 'comments'));
  for (const comment of comments.docs) await deleteDoc(comment.ref);
  await deleteDoc(fileRef(token, id));
}
export async function deleteSharedReview(token) {
  // Revoke first so a partial cleanup cannot leave a usable guest link.
  if (!(await getDoc(shareRef(token))).exists()) return;
  await updateDoc(shareRef(token), { active: false, updatedAt: new Date().toISOString() });
  const files = await getDocs(collection(db, 'reviewShares', token, 'files'));
  for (const file of files.docs) await removeSharedFile(token, file.id);
  await deleteDoc(shareRef(token));
}
export async function getSharedReview(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('El enlace no es válido.');
  const snapshot = await getDoc(shareRef(token));
  if (!snapshot.exists() || !snapshot.data().active) throw new Error('Esta review ya no está disponible.');
  const files = await getDocs(collection(db, 'reviewShares', token, 'files'));
  return { ...snapshot.data(), token, files: files.docs.map(item => ({ id: item.id, ...item.data(), comments: [] })) };
}
export async function listReviewShares() {
  const shares = await getDocs(collection(db, 'reviewShares'));
  return shares.docs.filter(item => item.data().active).map(item => ({ token: item.id, ...item.data() }));
}
export async function listSharedReviews(assignedTokens = null) {
  if (Array.isArray(assignedTokens)) {
    const loaded = await Promise.all(assignedTokens.map(async assignedToken => {
      try { return await getSharedReview(assignedToken); } catch { return null; }
    }));
    return loaded.filter(Boolean);
  }
  const shares = await getDocs(collection(db, 'reviewShares'));
  const active = shares.docs.filter(item => item.data().active);
  return Promise.all(active.map(async item => {
    const files = await getDocs(collection(db, 'reviewShares', item.id, 'files'));
    return { ...item.data(), token: item.id, files: files.docs.map(file => ({ id: file.id, ...file.data(), comments: [] })) };
  }));
}
export function watchComments(token, fileId, callback, onError) {
  return onSnapshot(collection(db, 'reviewShares', token, 'files', fileId, 'comments'),
    snapshot => callback(snapshot.docs.map(decodeComment)), onError);
}
export async function guestIdentity() {
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}
export async function addSharedComment(token, fileId, comment, authorName) {
  const user = await guestIdentity();
  const { strokes, ...rest } = comment;
  await setDoc(commentRef(token, fileId, comment.id), { ...rest, strokesJson: encodeStrokes(strokes), authorUid: user.uid,
    authorName: authorName.trim().slice(0, 60) });
}
export async function changeSharedComment(token, fileId, comment) {
  await updateDoc(commentRef(token, fileId, comment.id), { text: comment.text, strokesJson: encodeStrokes(comment.strokes),
    resolved: Boolean(comment.resolved) });
}
export async function deleteSharedComment(token, fileId, id) { await deleteDoc(commentRef(token, fileId, id)); }

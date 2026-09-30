/* Compact, reversible Mira links. Existing share IDs remain valid. */
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const isShareToken = value => /^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/.test(value || '');

export function createShareToken() {
  // 128 random bits, rather than a guessable sequence or project name.
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

function compactFile(id) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return base64url(Uint8Array.from(id.replaceAll('-', '').match(/../g), byte => parseInt(byte, 16)));
  }
  return `~${encodeURIComponent(id)}`;
}
function expandFile(value) {
  if (value.startsWith('~')) return decodeURIComponent(value.slice(1));
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) throw new Error('El archivo del enlace no es válido.');
  const bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==');
  const hex = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
export function expandShareHash(hash) {
  const value = hash.replace(/^#/, '');
  // Legacy query-style fragments and single-file Dropbox links keep working.
  if (!value || value.startsWith('share=') || value.startsWith('review=')) return value;
  const separator = value.indexOf('.');
  const token = separator < 0 ? value : value.slice(0, separator);
  if (!isShareToken(token)) throw new Error('El enlace de Mira no es válido.');
  const params = new URLSearchParams({ share: token });
  if (separator >= 0) params.set('file', expandFile(value.slice(separator + 1)));
  return params.toString();
}
function miraUrl(base) {
  const current = new URL(base);
  const root = /\/mira\/(?:index\.html)?$/.test(current.pathname) ? new URL('../', current) : new URL('./', current);
  return new URL('mira/', root);
}
export function buildShareUrl(base, token, fileId) {
  if (!isShareToken(token)) throw new Error('El enlace de Mira no es válido.');
  const link = miraUrl(base);
  link.hash = `${token}${fileId ? `.${compactFile(fileId)}` : ''}`;
  return link.href;
}

export const isShareAlias = value => /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/.test(value || '');

export function shareAliasBase(project, version, file, multipleFiles = false) {
  // Keep the project code at the start; normalize accents, punctuation and spaces.
  const fileTitle = multipleFiles ? String(file?.name || '').replace(/\.[^.]+$/, '') : '';
  const name = [project?.title, version?.title, fileTitle].filter(Boolean).join('-');
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120).replace(/-$/, '') || 'review';
}

export function sameShareTarget(a, b) {
  return Boolean(a && b && ['token', 'fileId', 'projectId', 'versionId'].every(key => typeof a[key] === 'string' && a[key] === b[key]));
}

export async function reserveShareAlias(base, claim) {
  if (!isShareAlias(base)) throw new Error('El nombre del enlace no es válido.');
  for (let index = 1; index <= 100; index++) {
    const alias = index === 1 ? base : `${base}-${index}`;
    if (await claim(alias)) return alias;
  }
  throw new Error('No se pudo reservar un nombre único para este enlace.');
}

export function buildNamedShareUrl(base, alias) {
  if (!isShareAlias(alias)) throw new Error('El nombre del enlace no es válido.');
  const link = miraUrl(base);
  link.hash = '/' + alias;
  return link.href;
}

export async function resolveShareHash(hash, loadAlias) {
  if (!hash.startsWith('#/')) return expandShareHash(hash);
  const alias = hash.slice(2);
  if (!isShareAlias(alias)) throw new Error('El nombre del enlace no es válido.');
  const target = await loadAlias(alias);
  if (!isShareToken(target?.token) || typeof target?.fileId !== 'string' || !target.fileId) throw new Error('Esta review ya no está disponible.');
  return new URLSearchParams({ share: target.token, file: target.fileId }).toString();
}

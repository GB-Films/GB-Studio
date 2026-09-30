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
export function buildShareUrl(base, token, fileId) {
  if (!isShareToken(token)) throw new Error('El enlace de Mira no es válido.');
  const current = new URL(base);
  const root = /\/mira\/(?:index\.html)?$/.test(current.pathname) ? new URL('../', current) : new URL('./', current);
  const link = new URL('mira/', root);
  link.hash = `${token}${fileId ? `.${compactFile(fileId)}` : ''}`;
  return link.href;
}

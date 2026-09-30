/* Read file metadata, never infer FPS from the display refresh rate or playback. */
export const METADATA_VERSION = 1;
const MAX_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function videoMetadata(result) {
  const tracks = result?.media?.track?.filter(track => track['@type'] === 'Video') || [];
  const track = tracks.find(track => track.Default === 'Yes') || tracks[0];
  if (!track) throw new Error('El archivo no contiene metadatos de video.');
  const numerator = integer(track.FrameRate_Num), denominator = integer(track.FrameRate_Den);
  const rate = numerator && denominator ? numerator / denominator : positive(track.FrameRate);
  const minimum = positive(track.FrameRate_Minimum), maximum = positive(track.FrameRate_Maximum);
  const variable = track.FrameRate_Mode === 'VFR' || (minimum && maximum && Math.abs(maximum - minimum) > .001);
  return {
    fps: rate,
    fpsNumerator: numerator && denominator ? numerator : null,
    fpsDenominator: numerator && denominator ? denominator : null,
    fpsMode: variable ? 'variable' : track.FrameRate_Mode === 'CFR' ? 'constant' : 'unknown',
    videoFrameCount: integer(track.FrameCount),
    videoDuration: positive(track.Duration),
    fpsSource: 'metadata', fpsMetadataVersion: METADATA_VERSION
  };
}

// Some hosts ignore Range. Accept a complete small file, but never download a
// multi-GB movie just to inspect its headers. MediaInfo can seek to the tail.
async function readResponse(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('El servidor no permite leer los metadatos por partes.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo leer el archivo.');
  const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('El archivo requiere demasiados datos para detectar los FPS.');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export async function remoteReader(urls) {
  let url, fileSize, fullFile = null, bytesRead = 0, requests = 0;
  const chunks = [];
  async function range(source, offset, length) {
    if (++requests > 96 || bytesRead + length > MAX_BYTES) throw new Error('No se pudieron detectar los FPS con una lectura breve del archivo.');
    const response = await fetch(source, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Dropbox no permitió leer los metadatos del video.'); }
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
      if (match && Number(match[1]) !== offset) { await response.body?.cancel(); throw new Error('El servidor devolvió otra parte del video.'); }
      if (match) fileSize = Number(match[3]);
      else if (!fileSize) {
        const head = await fetch(source, { method: 'HEAD' });
        if (head.ok) fileSize = Number(head.headers.get('content-length')) || null;
      }
      const bytes = await readResponse(response, Math.min(length, MAX_BYTES - bytesRead));
      bytesRead += bytes.length;
      chunks.push({ offset, bytes });
      return bytes;
    }
    const bytes = await readResponse(response, MAX_BYTES - bytesRead);
    bytesRead += bytes.length;
    fullFile = bytes; fileSize = bytes.length;
    return bytes.subarray(offset, offset + length);
  }
  let failure;
  for (const candidate of urls) {
    try {
      fileSize = null; fullFile = null; chunks.length = 0;
      await range(candidate, 0, CHUNK_BYTES);
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new Error('No se pudo leer el tamaño del video para inspeccionarlo.');
      url = candidate; break;
    } catch (error) { failure = error; }
  }
  if (!url) throw failure || new Error('No se pudieron leer los metadatos.');
  return {
    size: fileSize,
    async read(length, offset) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= fileSize) return new Uint8Array();
      length = Math.min(length, fileSize - offset);
      if (fullFile) return fullFile.subarray(offset, offset + length);
      const cached = chunks.find(chunk => offset >= chunk.offset && offset + length <= chunk.offset + chunk.bytes.length);
      if (cached) return cached.bytes.subarray(offset - cached.offset, offset - cached.offset + length);
      return range(url, offset, length);
    }
  };
}

export function inspectVideo(source, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const worker = new Worker(new URL('./reviews-video-metadata-worker.js?v=1', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('No se pudieron leer los FPS a tiempo.')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('No se pudieron analizar los metadatos del video.'));
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.metadata);
    worker.postMessage(source);
  });
}

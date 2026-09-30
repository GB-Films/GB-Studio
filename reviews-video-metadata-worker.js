import mediaInfoFactory from './assets/vendor/mediainfo/index.min.js';
import { remoteReader, videoMetadata } from './reviews-video-metadata.js?v=1';

self.onmessage = async ({ data: source }) => {
  let mediaInfo;
  try {
    const reader = source.blob ? {
      size: source.blob.size,
      read: async (length, offset) => new Uint8Array(await source.blob.slice(offset, offset + length).arrayBuffer())
    } : await remoteReader(source.urls);
    mediaInfo = await mediaInfoFactory({ format: 'object', locateFile: () => new URL('./assets/vendor/mediainfo/MediaInfoModule.wasm', import.meta.url).href });
    const result = await mediaInfo.analyzeData(reader.size, reader.read);
    self.postMessage({ metadata: videoMetadata(result) });
  } catch (error) { self.postMessage({ error: error.message || 'No se pudieron leer los FPS.' }); }
  finally { mediaInfo?.close(); }
};

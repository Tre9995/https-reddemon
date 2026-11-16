
// PlavioHD provider for RedDemon.
// Uses the private manifest URL configured in Render.

function getStreamEndpoint(type, id) {
  const manifestUrl = process.env.PLAVIOHD_MANIFEST_URL;

  if (!manifestUrl) {
    return null;
  }

  const parsed = new URL(manifestUrl);

  if (
    parsed.protocol !== 'https:' ||
    !parsed.pathname.endsWith('/manifest.json')
  ) {
    throw new Error('Invalid PlavioHD manifest URL configuration.');
  }

  if (!['movie', 'series'].includes(type) || !id) {
    return null;
  }

  const basePath = parsed.pathname.slice(
    0,
    -'manifest.json'.length
  );

  return new URL(
    basePath + 'stream/' + type + '/' +
    encodeURIComponent(id) + '.json',
    parsed.origin
  ).toString();
}

export const plavioHdProvider = {
  id: 'plaviohd',
  name: 'PlavioHD',

  capabilities: [
    'automatic-source-discovery',
    'movies',
    'series'
  ],

  async getStreams(context = {}) {
    try {
      const endpoint = getStreamEndpoint(
        context.type,
        context.id
      );

      if (!endpoint) return [];

      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      });

      if (!response.ok) {
        console.error(
          'PlavioHD returned HTTP status:',
          response.status
        );
        return [];
      }

      const data = await response.json();

      if (!Array.isArray(data.streams)) {
        return [];
      }

      return data.streams
        .filter(stream => {
          if (!stream || typeof stream.url !== 'string') {
            return false;
          }

          try {
            return new URL(stream.url).protocol === 'https:';
          } catch {
            return false;
          }
        })
        .map(stream => ({
          name: stream.name || 'PlavioHD',
          title: stream.title || stream.name || 'PlavioHD',
          url: stream.url,
          type: stream.type || 'url',
          mimeType: stream.mimeType || null,
          subtitles: Array.isArray(stream.subtitles)
            ? stream.subtitles
            : [],
          behaviorHints: stream.behaviorHints || {}
        }));
    } catch (error) {
      console.error(
        'PlavioHD provider error:',
        error.message
      );
      return [];
    }
  }
};

export default plavioHdProvider;

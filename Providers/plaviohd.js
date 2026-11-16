
// PlavioHD provider for RedDemon.
// Converts RedDemon TMDB IDs to IMDb IDs before requesting streams.

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function getImdbId(type, id) {
  // PlavioHD can use an IMDb ID directly.
  if (/^tt\d+/.test(id)) {
    return id.split(':')[0];
  }

  const parts = id.split(':');

  if (parts.length < 3 || parts[0] !== 'tmdb') {
    return null;
  }

  const mediaType = parts[1] === 'series' ? 'tv' : 'movie';
  const tmdbId = parts[2];

  if (
    !['movie', 'series'].includes(type) ||
    !/^\d+$/.test(tmdbId)
  ) {
    return null;
  }

  const accessToken =
    process.env.TMDB_READ_ACCESS_TOKEN ||
    process.env.TMDB_ACCESS_TOKEN;

  const apiKey = process.env.TMDB_API_KEY;

  if (!accessToken && !apiKey) {
    console.error('PlavioHD: TMDB credentials are not configured.');
    return null;
  }

  const url = new URL(
    `${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids`
  );

  if (!accessToken) {
    url.searchParams.set('api_key', apiKey);
  }

  const headers = { accept: 'application/json' };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    console.error(
      'PlavioHD: TMDB IMDb lookup failed:',
      response.status
    );
    return null;
  }

  const data = await response.json();

  return data.imdb_id || null;
}

function getEpisodeDetails(id, context) {
  const parts = id.split(':');

  return {
    season: context.season || parts[3],
    episode: context.episode || parts[4]
  };
}

function getStreamEndpoint(type, imdbId, season, episode) {
  const manifestUrl = process.env.PLAVIOHD_MANIFEST_URL;

  if (!manifestUrl) {
    throw new Error('PlavioHD manifest URL is not configured.');
  }

  const parsed = new URL(manifestUrl);

  if (
    parsed.protocol !== 'https:' ||
    !parsed.pathname.endsWith('/manifest.json')
  ) {
    throw new Error('Invalid PlavioHD manifest URL configuration.');
  }

  let streamId = imdbId;

  if (type === 'series' && season && episode) {
    streamId += `:${season}:${episode}`;
  }

  const basePath = parsed.pathname.slice(
    0,
    -'manifest.json'.length
  );

  return new URL(
    basePath + 'stream/' + type + '/' +
    encodeURIComponent(streamId) + '.json',
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
      const { type, id } = context;

      if (
        !['movie', 'series'].includes(type) ||
        typeof id !== 'string'
      ) {
        return [];
      }

      const imdbId = await getImdbId(type, id);

      if (!imdbId) {
        console.error('PlavioHD: No IMDb ID found for this title.');
        return [];
      }

      const { season, episode } =
        getEpisodeDetails(id, context);

      const endpoint = getStreamEndpoint(
        type,
        imdbId,
        season,
        episode
      );

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
      console.error('PlavioHD provider error:', error.message);
      return [];
    }
  }
};

export default plavioHdProvider;
    

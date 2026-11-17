
// RedDemon PlavioHD provider.
// Retrieves movie and TV streams from the configured PlavioHD addon.

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function getImdbId(type, id) {
  if (/^tt\d+/i.test(id)) {
    return id.split(':')[0];
  }

  const parts = id.split(':');

  if (
    parts.length !== 3 ||
    parts[0] !== 'tmdb' ||
    !/^\d+$/.test(parts[2])
  ) {
    return null;
  }

  const mediaType = type === 'series' ? 'tv' : 'movie';

  const accessToken =
    process.env.TMDB_READ_ACCESS_TOKEN ||
    process.env.TMDB_ACCESS_TOKEN;

  const apiKey = process.env.TMDB_API_KEY;

  if (!accessToken && !apiKey) {
    console.error('[PlavioHD] TMDB credentials are not configured.');
    return null;
  }

  const url = new URL(
    `${TMDB_BASE}/${mediaType}/${parts[2]}/external_ids`
  );

  const headers = { accept: 'application/json' };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else {
    url.searchParams.set('api_key', apiKey);
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    console.error('[PlavioHD] TMDB lookup failed:', response.status);
    return null;
  }

  const data = await response.json();
  return data.imdb_id || null;
}

function getEpisodeDetails(id, context = {}) {
  const parts = id.split(':');
  const isImdbId = /^tt\d+$/i.test(parts[0]);

  return {
    season: context.season || (isImdbId ? parts[1] : parts[3]),
    episode: context.episode || (isImdbId ? parts[2] : parts[4])
  };
}

function getStreamEndpoint(type, imdbId, season, episode) {
  const manifestValue = process.env.PLAVIOHD_MANIFEST_URL;

  if (!manifestValue) {
    throw new Error('PlavioHD manifest URL is not configured.');
  }

  const manifestUrl = new URL(manifestValue);

  if (
    manifestUrl.protocol !== 'https:' ||
    !manifestUrl.pathname.endsWith('/manifest.json')
  ) {
    throw new Error('Invalid PlavioHD manifest URL configuration.');
  }

  let streamId = imdbId;

  if (type === 'series') {
    if (!season || !episode) {
      throw new Error('Season and episode are required for series.');
    }

    streamId += `:${season}:${episode}`;
  }

  const basePath = manifestUrl.pathname.slice(
    0,
    -'manifest.json'.length
  );

  const endpoint = new URL(
    basePath +
      'stream/' +
      type +
      '/' +
      encodeURIComponent(streamId) +
      '.json',
    manifestUrl.origin
  );

  // Keep query parameters from the configured manifest URL.
  // Some provider installations use them for authentication.
  manifestUrl.searchParams.forEach((value, key) => {
    endpoint.searchParams.set(key, value);
  });

  return endpoint;
}

function extractStreams(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.streams)) {
    return data.streams;
  }

  if (Array.isArray(data?.result?.streams)) {
    return data.result.streams;
  }

  if (Array.isArray(data?.data?.streams)) {
    return data.data.streams;
  }

  return [];
}

function normalizeStreams(data) {
  const streams = extractStreams(data);

  return streams
    .filter(stream => {
      if (!stream || typeof stream.url !== 'string') {
        return false;
      }

      try {
        const parsed = new URL(stream.url);

        return (
          parsed.protocol === 'https:' ||
          parsed.protocol === 'http:'
        );
      } catch {
        return false;
      }
    })
    .map(stream => ({
      name: stream.name || 'PlavioHD',
      title:
        stream.title ||
        stream.name ||
        'PlavioHD Stream',
      url: stream.url,
      type: stream.type || 'url',
      mimeType: stream.mimeType || null,
      subtitles: Array.isArray(stream.subtitles)
        ? stream.subtitles
        : [],
      behaviorHints: stream.behaviorHints || {}
    }));
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
        console.warn('[PlavioHD] Invalid stream request.');
        return [];
      }

      console.log('[PlavioHD] Looking up:', { type, id });

      const imdbId = await getImdbId(type, id);

      if (!imdbId) {
        console.warn('[PlavioHD] Could not resolve IMDb ID.');
        return [];
      }

      const { season, episode } = getEpisodeDetails(id, context);

      if (
        type === 'series' &&
        (!season || !episode)
      ) {
        console.warn('[PlavioHD] Missing season or episode.');
        return [];
      }

      const endpoint = getStreamEndpoint(
        type,
        imdbId,
        season,
        episode
      );

      console.log('[PlavioHD] Requesting provider:', {
        type,
        imdbId,
        season: season || null,
        episode: episode || null,
        host: endpoint.host
      });

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json'
        },
        signal: AbortSignal.timeout(25000)
      });

      console.log('[PlavioHD] Provider HTTP status:', response.status);

      if (!response.ok) {
        console.error(
          '[PlavioHD] Provider returned HTTP error:',
          response.status
        );
        return [];
      }

      const data = await response.json();
      const streams = normalizeStreams(data);

      console.log('[PlavioHD] Streams returned:', streams.length);

      return streams;

    } catch (error) {
      console.error(
        '[PlavioHD] Provider error:',
        error.message
      );

      return [];
    }
  }
};

export default plavioHdProvider;

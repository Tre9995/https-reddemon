// RedDemon Cinema provider.
// Uses the user's privately configured PenguPlay Stremio manifest.
// The manifest URL is supplied at runtime and is never hardcoded here.

const PROVIDER_NAME = 'RedDemon Cinema';

function getManifestUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('RedDemon Cinema is not connected.');
  }

  const url = new URL(value.trim());

  if (
    url.protocol !== 'https:' ||
    !/(^|\.)pengu\.uk$/i.test(url.hostname) ||
    !url.pathname.endsWith('/manifest.json')
  ) {
    throw new Error('Invalid RedDemon Cinema manifest URL.');
  }

  return url;
}

function buildStreamUrl(manifestUrl, type, id) {
  const basePath = manifestUrl.pathname.slice(
    0,
    -'manifest.json'.length
  );

  const endpoint = new URL(
    `${basePath}stream/${type}/${encodeURIComponent(id)}.json`,
    manifestUrl.origin
  );

  manifestUrl.searchParams.forEach((value, key) => {
    endpoint.searchParams.set(key, value);
  });

  return endpoint;
}

function normalizeStreams(data) {
  let streams = [];

  if (Array.isArray(data)) {
    streams = data;
  } else if (Array.isArray(data?.streams)) {
    streams = data.streams;
  } else if (Array.isArray(data?.result?.streams)) {
    streams = data.result.streams;
  } else if (Array.isArray(data?.data?.streams)) {
    streams = data.data.streams;
  }

  return streams
    .filter((stream) => {
      if (!stream || typeof stream.url !== 'string') {
        return false;
      }

      try {
        const url = new URL(stream.url);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    })
    .map((stream) => ({
      name: PROVIDER_NAME,
      title: stream.title || stream.name || PROVIDER_NAME,
      url: stream.url,
      type: stream.type || 'url',
      mimeType: stream.mimeType || null,
      subtitles: Array.isArray(stream.subtitles)
        ? stream.subtitles
        : [],
      behaviorHints: stream.behaviorHints || {}
    }));
}

export const penguPlayProvider = {
  id: 'penguplay',
  name: PROVIDER_NAME,

  capabilities: [
    'movies',
    'series',
    'private-manifest'
  ],

  async getStreams(context = {}) {
    try {
      const { type, id } = context;

      if (
        !['movie', 'series'].includes(type) ||
        typeof id !== 'string' ||
        !id.trim()
      ) {
        return [];
      }

      const manifestUrl = getManifestUrl(
        context.penguPlayManifestUrl
      );

      let streamId = id.trim();

      if (type === 'series') {
        const parts = streamId.split(':');
        const season = context.season || parts[1];
        const episode = context.episode || parts[2];

        if (!season || !episode) {
          console.warn('[RedDemon Cinema] Missing season or episode.');
          return [];
        }

        streamId = `${parts[0]}:${season}:${episode}`;
      }

      const endpoint = buildStreamUrl(
        manifestUrl,
        type,
        streamId
      );

      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(25000)
      });

      if (!response.ok) {
        console.warn(
          '[RedDemon Cinema] Provider returned HTTP',
          response.status
        );
        return [];
      }

      const data = await response.json();
      const streams = normalizeStreams(data);

      console.log(
        '[RedDemon Cinema] Streams returned:',
        streams.length
      );

      return streams;
    } catch (error) {
      console.error(
        '[RedDemon Cinema] Provider error:',
        error.message
      );
      return [];
    }
  }
};

export default penguPlayProvider;

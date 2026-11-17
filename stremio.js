
import { Router } from 'express';
import crypto from 'node:crypto';

import { getProviderStreams } from './Providers/Registry.js';
import { decryptSecret } from './Providers/security.js';

export const stremioRouter = Router();

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_READ_ACCESS_TOKEN =
  process.env.TMDB_READ_ACCESS_TOKEN ||
  process.env.TMDB_ACCESS_TOKEN;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const PAGE_SIZE = 100;
const TMDB_PAGE_SIZE = 20;
const TMDB_MAX_PAGE = 500;

const CACHE_TTL = 5 * 60 * 1000;
const ID_CACHE_TTL = 12 * 60 * 60 * 1000;

const catalogCache = new Map();
const imdbIdCache = new Map();

const manifest = {
  id: 'org.reddemon.stremio',
  version: '0.3.6',
  name: 'RedDemon',
  description: 'RedDemon movie and TV catalog with secure provider integration',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'reddemon-movies',
      name: 'RedDemon Movies',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'reddemon-series',
      name: 'RedDemon Series',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }
  ],
  idPrefixes: ['tt', 'tmdb:']
};

// --------------------------------------------------
// CACHE HELPERS
// --------------------------------------------------

function getCached(cache, key) {
  const entry = cache.get(key);

  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCached(cache, key, value, ttl) {
  if (cache.size > 2000) {
    const now = Date.now();

    for (const [cacheKey, entry] of cache) {
      if (entry.expiresAt <= now) {
        cache.delete(cacheKey);
      }
    }

    if (cache.size > 2000) {
      cache.clear();
    }
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + ttl
  });
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) return;

      try {
        results[index] = await callback(items[index], index);
      } catch (error) {
        console.error(
          '[RedDemon] Catalog item failed:',
          error.message
        );

        results[index] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

// --------------------------------------------------
// READ STREMIO EXTRAS FROM QUERY OR URL PATH
// --------------------------------------------------

function getCatalogExtra(req, name) {
  const queryValue = req.query?.[name];

  if (queryValue !== undefined && queryValue !== null) {
    return String(queryValue);
  }

  const wildcard = req.params?.[0];

  if (typeof wildcard !== 'string' || !wildcard) {
    return '';
  }

  const pathParts = wildcard.split('/');

  for (const part of pathParts) {
    const cleanPart = part.replace(/\.json$/i, '');
    const separator = cleanPart.indexOf('=');

    if (separator < 0) continue;

    let key;
    let value;

    try {
      key = decodeURIComponent(
        cleanPart.slice(0, separator)
      );

      value = decodeURIComponent(
        cleanPart.slice(separator + 1)
      );
    } catch {
      continue;
    }

    if (key === name) {
      return value;
    }
  }

  return '';
}

// --------------------------------------------------
// ADDON KEY AUTHENTICATION
// --------------------------------------------------

async function findAddonKey(req) {
  const addonKey = req.params.addonKey;

  if (
    typeof addonKey !== 'string' ||
    !/^rd_[a-f0-9]{64}$/i.test(addonKey)
  ) {
    return null;
  }

  if (!req.supabase) {
    throw new Error('Database is not configured.');
  }

  const keyHash = crypto
    .createHash('sha256')
    .update(addonKey)
    .digest('hex');

  const { data, error } = await req.supabase
    .from('addon_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    console.error('Addon key lookup failed:', error);
    throw new Error('Addon key lookup failed.');
  }

  if (!data) return null;

  const { error: updateError } = await req.supabase
    .from('addon_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  if (updateError) {
    console.error(
      'Addon key usage update failed:',
      updateError
    );
  }

  return data;
}

// --------------------------------------------------
// TMDB REQUEST
// --------------------------------------------------

async function tmdbRequest(path, params = {}) {
  if (!TMDB_READ_ACCESS_TOKEN && !TMDB_API_KEY) {
    const error = new Error(
      'TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN is not configured.'
    );

    error.status = 503;
    throw error;
  }

  const url = new URL(TMDB_BASE + path);

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    accept: 'application/json'
  };

  if (TMDB_READ_ACCESS_TOKEN) {
    headers.Authorization =
      'Bearer ' + TMDB_READ_ACCESS_TOKEN;
  } else {
    url.searchParams.set('api_key', TMDB_API_KEY);
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const error = new Error(
      'TMDB request failed with status ' + response.status
    );

    error.status = response.status;
    throw error;
  }

  return response.json();
}

// --------------------------------------------------
// IMDB ID LOOKUP WITH CACHE
// --------------------------------------------------

async function getImdbId(type, tmdbId) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const cacheKey = mediaType + ':' + tmdbId;

  const cached = getCached(imdbIdCache, cacheKey);

  if (cached !== null) {
    return cached;
  }

  const data = await tmdbRequest(
    '/' + mediaType + '/' + tmdbId + '/external_ids'
  );

  const imdbId = data?.imdb_id || null;

  setCached(
    imdbIdCache,
    cacheKey,
    imdbId,
    ID_CACHE_TTL
  );

  return imdbId;
}

// --------------------------------------------------
// CATALOG METADATA
// --------------------------------------------------

function toStremioMeta(item, type, imdbId) {
  const isMovie = type === 'movie';

  const title = isMovie ? item.title : item.name;

  const releaseDate = isMovie
    ? item.release_date
    : item.first_air_date;

  const stremioId = imdbId ||
    `tmdb:${type}:${item.id}`;

  return {
    id: stremioId,
    type,
    name: title || 'Untitled',

    poster: item.poster_path
      ? IMAGE_BASE + item.poster_path
      : undefined,

    background: item.backdrop_path
      ? IMAGE_BASE + item.backdrop_path
      : undefined,

    description: item.overview || undefined,

    releaseInfo: releaseDate
      ? releaseDate.substring(0, 4)
      : undefined,

    imdbRating: item.vote_average
      ? item.vote_average.toFixed(1)
      : undefined
  };
}

// --------------------------------------------------
// FULL MOVIE AND TV DETAILS
// --------------------------------------------------

function toDetailedMeta(item, type, requestedId) {
  const isMovie = type === 'movie';

  const releaseDate = isMovie
    ? item.release_date
    : item.first_air_date;

  const credits = item.credits || {};
  const cast = (credits.cast || []).slice(0, 20);
  const crew = credits.crew || [];

  const directors = crew
    .filter(person => person.job === 'Director')
    .slice(0, 10)
    .map(person => person.name);

  const writers = crew
    .filter(person =>
      person.job === 'Writer' ||
      person.job === 'Screenplay' ||
      person.department === 'Writing'
    )
    .slice(0, 10)
    .map(person => person.name);

  return {
    id: requestedId,
    type,

    name: (isMovie ? item.title : item.name) || 'Untitled',

    poster: item.poster_path
      ? IMAGE_BASE + item.poster_path
      : undefined,

    background: item.backdrop_path
      ? IMAGE_BASE + item.backdrop_path
      : undefined,

    description: item.overview || undefined,

    releaseInfo: releaseDate
      ? releaseDate.substring(0, 4)
      : undefined,

    released: releaseDate || undefined,

    imdbRating: item.vote_average
      ? item.vote_average.toFixed(1)
      : undefined,

    genres: (item.genres || []).map(genre => genre.name),

    runtime: isMovie
      ? item.runtime
      : (item.episode_run_time || [])[0],

    country: isMovie
      ? (item.production_countries || []).map(
          country => country.name
        )
      : (item.origin_country || []),

    director: directors,
    writer: writers,
    cast: cast.map(person => person.name),

    language: item.original_language || undefined,

    imdb_id: isMovie
      ? item.imdb_id || undefined
      : item.external_ids?.imdb_id || undefined
  };
}

async function getDetailedMeta(id, type) {
  if (!['movie', 'series'].includes(type)) {
    throw new Error('Invalid metadata type.');
  }

  let tmdbId;
  const requestedId = id;

  if (/^tt\d+$/i.test(id)) {
    const found = await tmdbRequest(
      '/find/' + encodeURIComponent(id),
      { external_source: 'imdb_id' }
    );

    const results = type === 'movie'
      ? found.movie_results
      : found.tv_results;

    if (!results || !results.length) {
      return null;
    }

    tmdbId = String(results[0].id);

  } else if (id.startsWith('tmdb:')) {
    const parts = id.split(':');

    if (
      parts.length !== 3 ||
      parts[1] !== type ||
      !/^\d+$/.test(parts[2])
    ) {
      throw new Error('Invalid TMDB metadata ID.');
    }

    tmdbId = parts[2];

  } else {
    throw new Error('Unsupported metadata ID.');
  }

  const endpoint = type === 'movie'
    ? '/movie/'
    : '/tv/';

  const details = await tmdbRequest(
    endpoint + encodeURIComponent(tmdbId),
    { append_to_response: 'credits,external_ids' }
  );

  return toDetailedMeta(details, type, requestedId);
}

// --------------------------------------------------
// METADATA ENDPOINT
// --------------------------------------------------

async function getMeta(req, res, addonKeyRequired) {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      meta: null,
      error: 'invalid_type'
    });
  }

  if (addonKeyRequired) {
    try {
      const keyRecord = await findAddonKey(req);

      if (!keyRecord) {
        return res.status(401).json({
          meta: null,
          error: 'invalid_or_revoked_addon_key'
        });
      }
    } catch (error) {
      console.error(
        'Metadata authentication failed:',
        error.message
      );

      return res.status(503).json({
        meta: null,
        error: 'addon_authentication_failed'
      });
    }
  }

  try {
    const meta = await getDetailedMeta(id, type);

    if (!meta) {
      return res.status(404).json({
        meta: null,
        error: 'metadata_not_found'
      });
    }

    return res.json({ meta });

  } catch (error) {
    console.error('TMDB metadata error:', error.message);

    return res.status(error.status || 502).json({
      meta: null,
      error: 'tmdb_metadata_failed',
      message: error.message
    });
  }
}

// --------------------------------------------------
// FETCH A 100-ITEM TMDB BATCH AT ANY OFFSET
// --------------------------------------------------

async function getTmdbCatalogBatch(type, search, skip) {
  if (skip >= TMDB_MAX_PAGE * TMDB_PAGE_SIZE) {
    return [];
  }

  const firstTmdbPage =
    Math.floor(skip / TMDB_PAGE_SIZE) + 1;

  const offsetInFirstPage =
    skip % TMDB_PAGE_SIZE;

  const pagesNeeded = Math.ceil(
    (offsetInFirstPage + PAGE_SIZE) / TMDB_PAGE_SIZE
  );

  const lastTmdbPage = Math.min(
    firstTmdbPage + pagesNeeded - 1,
    TMDB_MAX_PAGE
  );

  const endpoint = search
    ? (
        type === 'movie'
          ? '/search/movie'
          : '/search/tv'
      )
    : (
        type === 'movie'
          ? '/discover/movie'
          : '/discover/tv'
      );

  const pageNumbers = [];

  for (
    let page = firstTmdbPage;
    page <= lastTmdbPage;
    page++
  ) {
    pageNumbers.push(page);
  }

  const pageResults = await Promise.all(
    pageNumbers.map(page => {
      const params = search
        ? {
            query: search,
            page,
            include_adult: false
          }
        : {
            page,
            sort_by: 'vote_count.desc',
            include_adult: false,
            'vote_count.gte': 5
          };

      return tmdbRequest(endpoint, params);
    })
  );

  const allItems = pageResults.flatMap(
    data => data.results || []
  );

  return allItems.slice(
    offsetInFirstPage,
    offsetInFirstPage + PAGE_SIZE
  );
}

// --------------------------------------------------
// CATALOG ENDPOINT
// --------------------------------------------------

async function getCatalog(req, res, addonKeyRequired) {
  const { type, catalogId } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ metas: [] });
  }

  if (addonKeyRequired) {
    try {
      const keyRecord = await findAddonKey(req);

      if (!keyRecord) {
        return res.status(401).json({
          metas: [],
          error: 'invalid_or_revoked_addon_key'
        });
      }
    } catch (error) {
      console.error(
        'Addon authentication error:',
        error.message
      );

      return res.status(503).json({
        metas: [],
        error: 'addon_authentication_failed'
      });
    }
  }

  const expectedCatalog = type === 'movie'
    ? 'reddemon-movies'
    : 'reddemon-series';

  if (catalogId !== expectedCatalog) {
    return res.status(404).json({ metas: [] });
  }

  try {
    const searchValue = getCatalogExtra(req, 'search');
    const search = searchValue.trim();

    const requestedSkip = Number.parseInt(
      getCatalogExtra(req, 'skip') || '0',
      10
    );

    const skip = Number.isFinite(requestedSkip)
      ? Math.max(0, Math.min(requestedSkip, 9999))
      : 0;

    const cacheKey = [
      type,
      catalogId,
      search.toLowerCase(),
      skip
    ].join(':');

    const cachedCatalog = getCached(
      catalogCache,
      cacheKey
    );

    if (cachedCatalog !== null) {
      return res.json({ metas: cachedCatalog });
    }

    const items = await getTmdbCatalogBatch(
      type,
      search,
      skip
    );

    console.log('[RedDemon] TMDB catalog batch:', {
      type,
      skip,
      search: Boolean(search),
      tmdbResults: items.length
    });

    const results = await mapWithConcurrency(
      items,
      4,
      async item => {
        let imdbId = null;

        try {
          imdbId = await getImdbId(type, item.id);
        } catch (error) {
          console.warn(
            '[RedDemon] IMDb lookup failed; using TMDB ID:',
            item.id,
            error.message
          );
        }

        return toStremioMeta(item, type, imdbId);
      }
    );

    const metas = results.filter(Boolean);

    setCached(
      catalogCache,
      cacheKey,
      metas,
      CACHE_TTL
    );

    console.log('[RedDemon] Catalog response:', {
      type,
      skip,
      returned: metas.length,
      imdbIds: metas.filter(
        meta => /^tt\d+$/i.test(meta.id)
      ).length,
      tmdbFallbackIds: metas.filter(
        meta => meta.id.startsWith('tmdb:')
      ).length
    });

    return res.json({ metas });

  } catch (error) {
    console.error('TMDB catalog error:', error.message);

    return res.status(error.status || 502).json({
      metas: [],
      error: 'tmdb_catalog_failed',
      message: error.message
    });
  }
}

// --------------------------------------------------
// MANIFEST ROUTES
// --------------------------------------------------

stremioRouter.get('/manifest.json', (_req, res) => {
  res.json(manifest);
});

stremioRouter.get(
  '/:addonKey/manifest.json',
  async (req, res) => {
    try {
      const keyRecord = await findAddonKey(req);

      if (!keyRecord) {
        return res.status(401).json({
          error: 'invalid_or_revoked_addon_key'
        });
      }

      return res.json(manifest);

    } catch (error) {
      console.error(
        'Manifest authentication error:',
        error.message
      );

      return res.status(503).json({
        error: 'addon_authentication_failed'
      });
    }
  }
);

// --------------------------------------------------
// CATALOG ROUTES
// --------------------------------------------------

// Normal catalog request.
stremioRouter.get(
  '/catalog/:type/:catalogId.json',
  async (req, res) => getCatalog(req, res, false)
);

// Catalog request with Stremio path extras.
stremioRouter.get(
  '/catalog/:type/:catalogId/*',
  async (req, res) => getCatalog(req, res, false)
);

// Personal catalog request.
stremioRouter.get(
  '/:addonKey/catalog/:type/:catalogId.json',
  async (req, res) => getCatalog(req, res, true)
);

// Personal catalog request with Stremio path extras.
stremioRouter.get(
  '/:addonKey/catalog/:type/:catalogId/*',
  async (req, res) => getCatalog(req, res, true)
);

// --------------------------------------------------
// METADATA ROUTES
// --------------------------------------------------

stremioRouter.get(
  '/meta/:type/:id.json',
  async (req, res) => getMeta(req, res, false)
);

stremioRouter.get(
  '/:addonKey/meta/:type/:id.json',
  async (req, res) => getMeta(req, res, true)
);

// --------------------------------------------------
// STREAM RESOLUTION
// --------------------------------------------------

async function resolveStreams(req, res, keyRecord) {
  const { type, id } = req.params;

  console.log(
    '[RedDemon] Stream request received:',
    { type, id }
  );

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      streams: [],
      error: 'invalid_type'
    });
  }

  try {
    const rawLinks =
      req.query.link ?? req.query.links ?? [];

    const links = (
      Array.isArray(rawLinks)
        ? rawLinks
        : [rawLinks]
    )
      .filter(link => {
        if (
          typeof link !== 'string' ||
          link.length > 4096
        ) {
          return false;
        }

        try {
          const parsed = new URL(link);

          return (
            parsed.protocol === 'http:' ||
            parsed.protocol === 'https:'
          );
        } catch {
          return false;
        }
      })
      .slice(0, 20);

    let realDebridAccessToken = null;

    const { data, error } = await req.supabase
      .from('provider_accounts')
      .select('encrypted_access_token')
      .eq('user_id', keyRecord.user_id)
      .eq('provider', 'real_debrid')
      .maybeSingle();

    if (error) {
      console.error(
        'Real-Debrid account lookup failed:',
        error
      );
    } else if (data?.encrypted_access_token) {
      try {
        realDebridAccessToken = decryptSecret(
          data.encrypted_access_token
        );
      } catch (decryptError) {
        console.error(
          'Real-Debrid token decryption failed:',
          decryptError.message
        );
      }
    }

    let season = req.query.season;
    let episode = req.query.episode;

    if (type === 'series') {
      const parts = id.split(':');

      if (
        /^tt\d+$/i.test(parts[0]) &&
        parts.length >= 3
      ) {
        season = season || parts[1];
        episode = episode || parts[2];

      } else if (parts.length >= 5) {
        season = season || parts[3];
        episode = episode || parts[4];
      }
    }

    console.log('[RedDemon] Calling providers:', {
      type,
      id,
      season: season || null,
      episode: episode || null,
      suppliedLinks: links.length,
      realDebridConnected: Boolean(realDebridAccessToken)
    });

    const streams = await getProviderStreams({
      type,
      id,
      season,
      episode,
      query: req.query,
      links,
      realDebridAccessToken
    });

    console.log(
      '[RedDemon] Provider resolution completed:',
      {
        type,
        id,
        returnedStreams:
          Array.isArray(streams) ? streams.length : 0,
        providers: [
          ...new Set(
            (streams || []).map(
              stream =>
                stream.provider ||
                stream.name ||
                'unknown'
            )
          )
        ]
      }
    );

    const compatibleStreams = (streams || [])
      .filter(
        stream =>
          stream &&
          typeof stream.url === 'string'
      )
      .map(stream => ({
        name:
          stream.name ||
          stream.provider ||
          'RedDemon',

        title:
          stream.title ||
          stream.name ||
          'RedDemon Stream',

        url: stream.url,

        ...(stream.behaviorHints
          ? {
              behaviorHints: stream.behaviorHints
            }
          : {}),

        ...(stream.subtitles
          ? {
              subtitles: stream.subtitles
            }
          : {})
      }));

    return res.json({
      streams: compatibleStreams,
      id
    });

  } catch (error) {
    console.error(
      'Stream resolution failed:',
      error.message
    );

    return res.status(error.status || 500).json({
      streams: [],
      error: 'stream_resolution_failed'
    });
  }
}

// --------------------------------------------------
// PUBLIC STREAM ROUTE
// --------------------------------------------------

stremioRouter.get(
  '/stream/:type/:id.json',
  (req, res) => {
    const { type, id } = req.params;

    if (!['movie', 'series'].includes(type)) {
      return res.status(400).json({
        streams: [],
        error: 'invalid_type'
      });
    }

    return res.json({
      streams: [],
      id,
      message:
        'Use your personal RedDemon install URL for provider access.'
    });
  }
);

// --------------------------------------------------
// PRIVATE STREAM ROUTE
// --------------------------------------------------

stremioRouter.get(
  '/:addonKey/stream/:type/:id.json',
  async (req, res) => {
    try {
      const keyRecord = await findAddonKey(req);

      if (!keyRecord) {
        return res.status(401).json({
          streams: [],
          error: 'invalid_or_revoked_addon_key'
        });
      }

      console.log(
        '[RedDemon] Stream request authenticated.'
      );

      return resolveStreams(req, res, keyRecord);

    } catch (error) {
      console.error(
        'Stream authentication error:',
        error.message
      );

      return res.status(503).json({
        streams: [],
        error: 'addon_authentication_failed'
      });
    }
  }
);

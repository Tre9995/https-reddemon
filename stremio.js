
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

const manifest = {
  id: 'org.reddemon.stremio',
  version: '0.3.0',
  name: 'RedDemon',
  description: 'RedDemon movie and TV catalog with secure provider integration',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'reddemon-movies',
      name: 'RedDemon Movies',
      extra: [
        { name: 'search', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'reddemon-series',
      name: 'RedDemon Series',
      extra: [
        { name: 'search', isRequired: false }
      ]
    }
  ],
  idPrefixes: ['tt', 'tmdb:']
};

// Validate a private RedDemon addon key.
// Only the SHA-256 hash is stored in Supabase.
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

  if (!data) {
    return null;
  }

  const { error: updateError } = await req.supabase
    .from('addon_keys')
    .update({
      last_used_at: new Date().toISOString()
    })
    .eq('id', data.id);

  if (updateError) {
    console.error(
      'Addon key usage update failed:',
      updateError
    );
  }

  return data;
}

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
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    accept: 'application/json'
  };

  if (TMDB_READ_ACCESS_TOKEN) {
    headers.Authorization = 'Bearer ' + TMDB_READ_ACCESS_TOKEN;
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

function toStremioMeta(item, type) {
  const isMovie = type === 'movie';

  const title = isMovie
    ? item.title
    : item.name;

  const releaseDate = isMovie
    ? item.release_date
    : item.first_air_date;

  return {
    id: 'tmdb:' + type + ':' + item.id,
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

async function getCatalog(req, res, addonKeyRequired) {
  const { type, catalogId } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ metas: [] });
  }

  if (addonKeyRequired) {
    let keyRecord;

    try {
      keyRecord = await findAddonKey(req);
    } catch (error) {
      console.error('Addon authentication error:', error.message);

      return res.status(503).json({
        metas: [],
        error: 'addon_authentication_failed'
      });
    }

    if (!keyRecord) {
      return res.status(401).json({
        metas: [],
        error: 'invalid_or_revoked_addon_key'
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
    const search = typeof req.query.search === 'string'
      ? req.query.search.trim()
      : '';

    const skip = Math.max(
      0,
      Number.parseInt(req.query.skip || '0', 10) || 0
    );

    const page = Math.min(
      500,
      Math.floor(skip / 20) + 1
    );

    const endpoint = search
      ? (type === 'movie' ? '/search/movie' : '/search/tv')
      : (type === 'movie' ? '/discover/movie' : '/discover/tv');

    const params = search
      ? {
          query: search,
          page,
          include_adult: false
        }
      : {
          page,
          sort_by: 'popularity.desc',
          include_adult: false
        };

    const data = await tmdbRequest(endpoint, params);

    const metas = (data.results || [])
      .map(item => toStremioMeta(item, type));

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

// Public manifest retained for compatibility and testing.
stremioRouter.get('/manifest.json', (_req, res) => {
  res.json(manifest);
});

// Private manifest used by each user's personal install URL.
stremioRouter.get('/:addonKey/manifest.json', async (req, res) => {
  try {
    const keyRecord = await findAddonKey(req);

    if (!keyRecord) {
      return res.status(401).json({
        error: 'invalid_or_revoked_addon_key'
      });
    }

    return res.json(manifest);
  } catch (error) {
    console.error('Manifest authentication error:', error.message);

    return res.status(503).json({
      error: 'addon_authentication_failed'
    });
  }
});

// Public catalog endpoints retained for compatibility.
stremioRouter.get(
  '/catalog/:type/:catalogId.json',
  async (req, res) => {
    return getCatalog(req, res, false);
  }
);

// Private catalog endpoints for keyed installations.
stremioRouter.get(
  '/:addonKey/catalog/:type/:catalogId.json',
  async (req, res) => {
    return getCatalog(req, res, true);
  }
);

// Convert supplied links into provider streams.
async function resolveStreams(req, res, keyRecord) {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      streams: [],
      error: 'invalid_type'
    });
  }

  try {
    const rawLinks =
      req.query.link ??
      req.query.links ??
      [];

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

    if (links.length === 0) {
      return res.json({
        streams: [],
        id,
        message:
          'No source links were supplied. Automatic source discovery is not configured.'
      });
    }

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

    // Accept series IDs such as tmdb:series:123:2:5.
    if (type === 'series') {
      const parts = id.split(':');

      if (parts.length >= 5) {
        season = season || parts[3];
        episode = episode || parts[4];
      }
    }

    const streams = await getProviderStreams({
      type,
      id,
      season,
      episode,
      query: req.query,
      links,
      realDebridAccessToken
    });

    const compatibleStreams = (streams || [])
      .filter(stream => stream && typeof stream.url === 'string')
      .map(stream => ({
        name: stream.name || stream.provider || 'RedDemon',
        title: stream.title || stream.name || 'RedDemon Stream',
        url: stream.url,
        ...(stream.behaviorHints
          ? { behaviorHints: stream.behaviorHints }
          : {}),
        ...(stream.subtitles
          ? { subtitles: stream.subtitles }
          : {})
      }));

    return res.json({
      streams: compatibleStreams,
      id
    });

  } catch (error) {
    console.error('Stream resolution failed:', error.message);

    return res.status(error.status || 500).json({
      streams: [],
      error: 'stream_resolution_failed'
    });
  }
}

// Public stream endpoint retained for compatibility.
// Private user installs should use the keyed endpoint below.
stremioRouter.get('/stream/:type/:id.json', (req, res) => {
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
    message: 'Use your personal RedDemon install URL for provider access.'
  });
});

// Private stream endpoint.
// The addon key determines which user's provider accounts are used.
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

      return resolveStreams(req, res, keyRecord);

    } catch (error) {
      console.error('Stream authentication error:', error.message);

      return res.status(503).json({
        streams: [],
        error: 'addon_authentication_failed'
      });
    }
  }
);

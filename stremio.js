
import { Router } from 'express';

export const stremioRouter = Router();

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_READ_ACCESS_TOKEN =
  process.env.TMDB_READ_ACCESS_TOKEN ||
  process.env.TMDB_ACCESS_TOKEN;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const manifest = {
  id: 'org.reddemon.stremio',
  version: '0.2.0',
  name: 'RedDemon',
  description: 'RedDemon movie and TV catalog powered by TMDB',
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

async function tmdbRequest(path, params = {}) {
  if (!TMDB_READ_ACCESS_TOKEN && !TMDB_API_KEY) {
    const error = new Error('TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN is not configured.');
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
    const error = new Error('TMDB request failed with status ' + response.status);
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

stremioRouter.get('/manifest.json', (_req, res) => {
  res.json(manifest);
});

stremioRouter.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ metas: [] });
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
});

// Stream discovery will be connected separately.
// TMDB supplies catalog information, not playable video links.
stremioRouter.get('/stream/:type/:id.json', (req, res) => {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ streams: [] });
  }

  return res.json({
    streams: [],
    message: 'Catalog is connected. Stream providers will be connected separately.',
    id
  });
});

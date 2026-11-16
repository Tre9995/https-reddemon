
import { Router } from 'express';
import {
  getProviderStreams,
  listProviders
} from './Providers/Registry.js';

export const apiRouter = Router();

const manifest = {
  id: 'org.reddemon.plugin',
  name: 'RedDemon',
  version: '0.1.0',
  description: 'Universal provider plugin API',
  capabilities: [
    'catalog',
    'stream-resolution',
    'subtitles',
    'user-authentication'
  ],
  supportedMedia: ['movie', 'series']
};

// Manifest
apiRouter.get('/manifest', (_req, res) => {
  res.json(manifest);
});

// Verify signed-in Supabase user
apiRouter.get('/me', async (req, res) => {
  if (!req.supabase) {
    return res.status(503).json({
      error: 'database_not_configured'
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: 'authentication_required'
    });
  }

  try {
    const { data, error } =
      await req.supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        error: 'invalid_session'
      });
    }

    return res.json({
      authenticated: true,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    });
  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(500).json({
      error: 'authentication_failed'
    });
  }
});

// Catalog
apiRouter.get('/catalog', (req, res) => {
  const type = req.query.type || 'movie';

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      error: 'invalid_type',
      allowed: ['movie', 'series']
    });
  }

  return res.json({
    type,
    items: [],
    providers: listProviders(),
    message: 'Provider registry connected. Catalog providers are not configured yet.'
  });
});

// Streams
apiRouter.get('/streams/:type/:id', async (req, res) => {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      error: 'invalid_type'
    });
  }

  try {
    const streams = await getProviderStreams({
      type,
      id,
      query: req.query
    });

    return res.json({
      type,
      id,
      streams,
      providers: listProviders()
    });
  } catch (error) {
    console.error('Stream lookup failed:', error);

    return res.status(500).json({
      error: 'stream_lookup_failed'
    });
  }
});

// Subtitles
apiRouter.get('/subtitles/:type/:id', (req, res) => {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      error: 'invalid_type'
    });
  }

  return res.json({
    type,
    id,
    subtitles: []
  });
});

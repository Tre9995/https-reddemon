
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
  capabilities: ['catalog', 'stream-resolution', 'subtitles'],
  supportedMedia: ['movie', 'series']
};

apiRouter.get('/manifest', (_req, res) => res.json(manifest));

apiRouter.get('/catalog', (req, res) => {
  const type = req.query.type || 'movie';

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      error: 'invalid_type',
      allowed: ['movie', 'series']
    });
  }

  res.json({
    type,
    items: [],
    providers: listProviders(),
    message: 'Provider registry connected. Catalog providers are not configured yet.'
  });
});

apiRouter.get('/streams/:type/:id', async (req, res) => {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  try {
    const streams = await getProviderStreams({
      type,
      id,
      query: req.query
    });

    res.json({
      type,
      id,
      streams,
      providers: listProviders()
    });
  } catch (error) {
    console.error('RedDemon stream lookup failed:', error);
    res.status(500).json({ error: 'stream_lookup_failed' });
  }
});

apiRouter.get('/subtitles/:type/:id', (req, res) => {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ error: 'invalid_type' });
  }

  res.json({ type, id, subtitles: [] });
});
  

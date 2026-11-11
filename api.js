import { Router } from 'express';

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
    return res.status(400).json({ error: 'invalid_type', allowed: ['movie', 'series'] });
  }
  // Catalog providers will be added through provider modules.
  res.json({ type, items: [], providers: [], message: 'No catalog providers configured yet.' });
});

apiRouter.get('/streams/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ error: 'invalid_type' });
  }
  // Only return playable URLs supplied by authorized, configured providers.
  res.json({ type, id, streams: [], message: 'No authorized stream providers configured yet.' });
});

apiRouter.get('/subtitles/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ error: 'invalid_type' });
  }
  res.json({ type, id, subtitles: [] });
});

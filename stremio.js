import { Router } from 'express';

export const stremioRouter = Router();

const manifest = {
  id: 'org.reddemon.stremio',
  version: '0.1.0',
  name: 'RedDemon',
  description: 'RedDemon provider adapter',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'reddemon-movies', name: 'RedDemon Movies' },
    { type: 'series', id: 'reddemon-series', name: 'RedDemon Series' }
  ],
  idPrefixes: ['tt']
};

stremioRouter.get('/manifest.json', (_req, res) => res.json(manifest));

stremioRouter.get('/catalog/:type/:catalogId.json', (req, res) => {
  const { type } = req.params;
  if (!['movie', 'series'].includes(type)) return res.status(400).json({ metas: [] });
  res.json({ metas: [] });
});

stremioRouter.get('/stream/:type/:id.json', (req, res) => {
  const { type, id } = req.params;
  if (!['movie', 'series'].includes(type)) return res.status(400).json({ streams: [] });
  res.json({ streams: [] });
});

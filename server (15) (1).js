import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';
import { stremioRouter } from './adapters/stremio.js';

const app = express();
const port = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'RedDemon', version: '0.1.0' });
});

app.use('/api/v1', apiRouter);
app.use('/stremio', stremioRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`RedDemon listening on port ${port}`);
});

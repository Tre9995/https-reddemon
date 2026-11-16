
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { apiRouter } from './api.js';
import { stremioRouter } from './stremio.js';

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

const supabase = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  req.supabase = supabase;
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'RedDemon',
    version: '0.1.0',
    databaseConfigured: Boolean(supabase)
  });
});

app.use('/api/v1', apiRouter);
app.use('/stremio', stremioRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`RedDemon listening on port ${port}`);
});

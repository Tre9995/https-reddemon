
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

import {
  getProviderStreams,
  listProviders
} from './Providers/Registry.js';

export const apiRouter = Router();

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

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

// Register a new user
apiRouter.post('/auth/register', async (req, res) => {
  if (!authClient) {
    return res.status(503).json({
      error: 'authentication_not_configured'
    });
  }

  const { email, password } = req.body || {};

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !email.trim() ||
    password.length < 8
  ) {
    return res.status(400).json({
      error: 'invalid_input',
      message: 'A valid email and password of at least 8 characters are required.'
    });
  }

  try {
    const { data, error } = await authClient.auth.signUp({
      email: email.trim(),
      password
    });

    if (error) {
      return res.status(400).json({
        error: 'registration_failed',
        message: error.message
      });
    }

    return res.status(data.session ? 201 : 202).json({
      registered: true,
      email: data.user?.email,
      emailConfirmationRequired: !data.session,
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      } : null
    });

  } catch (error) {
    console.error('Registration error:', error);

    return res.status(500).json({
      error: 'registration_failed'
    });
  }
});

// Sign in an existing user
apiRouter.post('/auth/login', async (req, res) => {
  if (!authClient) {
    return res.status(503).json({
      error: 'authentication_not_configured'
    });
  }

  const { email, password } = req.body || {};

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({
      error: 'invalid_input'
    });
  }

  try {
    const { data, error } =
      await authClient.auth.signInWithPassword({
        email: email.trim(),
        password
      });

    if (error || !data.session) {
      return res.status(401).json({
        error: 'invalid_login',
        message: 'Email or password is incorrect, or email confirmation is required.'
      });
    }

    return res.json({
      authenticated: true,
      user: {
        id: data.user.id,
        email: data.user.email
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });

  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      error: 'login_failed'
    });
  }
});

// Verify signed-in user
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

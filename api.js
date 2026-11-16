
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

import {
  getProviderStreams,
  listProviders
} from './Providers/Registry.js';

import {
  encryptSecret,
  decryptSecret
} from './Providers/security.js';

import {
  getRealDebridUser
} from './Providers/real-debrid.js';

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

const supportedProviders = ['real_debrid', 'torbox'];

const manifest = {
  id: 'org.reddemon.plugin',
  name: 'RedDemon',
  version: '0.1.0',
  description: 'Universal provider plugin API',
  capabilities: [
    'catalog',
    'stream-resolution',
    'subtitles',
    'user-authentication',
    'secure-provider-accounts'
  ],
  supportedMedia: ['movie', 'series'],
  supportedProviders
};

// Authenticate every private account operation.
async function getAuthenticatedUser(req) {
  if (!req.supabase) {
    return {
      error: 'database_not_configured',
      status: 503
    };
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!token) {
    return {
      error: 'authentication_required',
      status: 401
    };
  }

  const { data, error } =
    await req.supabase.auth.getUser(token);

  if (error || !data.user) {
    return {
      error: 'invalid_session',
      status: 401
    };
  }

  return { user: data.user };
}

// Manifest
apiRouter.get('/manifest', (_req, res) => {
  res.json(manifest);
});

// Register
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

// Login
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
  try {
    const auth = await getAuthenticatedUser(req);

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error
      });
    }

    return res.json({
      authenticated: true,
      user: {
        id: auth.user.id,
        email: auth.user.email
      }
    });
  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(500).json({
      error: 'authentication_failed'
    });
  }
});

// List connected accounts without exposing credentials.
apiRouter.get('/provider-accounts', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req);

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error
      });
    }

    const { data, error } = await req.supabase
      .from('provider_accounts')
      .select('provider, token_expires_at, created_at, updated_at')
      .eq('user_id', auth.user.id);

    if (error) {
      console.error('Provider account lookup failed:', error);

      return res.status(500).json({
        error: 'provider_accounts_lookup_failed'
      });
    }

    return res.json({
      accounts: data || []
    });
  } catch (error) {
    console.error('Provider account error:', error);

    return res.status(500).json({
      error: 'provider_accounts_failed'
    });
  }
});

// Check the existing saved Real-Debrid account.
apiRouter.get(
  '/provider-accounts/real_debrid/check',
  async (req, res) => {
    try {
      const auth = await getAuthenticatedUser(req);

      if (auth.error) {
        return res.status(auth.status).json({
          error: auth.error
        });
      }

      const { data, error } = await req.supabase
        .from('provider_accounts')
        .select('encrypted_access_token')
        .eq('user_id', auth.user.id)
        .eq('provider', 'real_debrid')
        .maybeSingle();

      if (error) {
        console.error('Real-Debrid lookup failed:', error);

        return res.status(500).json({
          error: 'provider_account_lookup_failed'
        });
      }

      if (!data?.encrypted_access_token) {
        return res.status(404).json({
          connected: false,
          error: 'real_debrid_account_not_found'
        });
      }

      const accessToken = decryptSecret(
        data.encrypted_access_token
      );

      const account = await getRealDebridUser(accessToken);

      return res.json({
        connected: true,
        provider: 'real_debrid',
        account
      });
    } catch (error) {
      console.error(
        'Real-Debrid account check failed:',
        error.message
      );

      return res.status(error.status === 401 ? 401 : 500).json({
        connected: false,
        error: error.message ===
          'real_debrid_authentication_failed'
          ? 'real_debrid_authentication_failed'
          : 'real_debrid_account_check_failed'
      });
    }
  }
);

// Save or update an encrypted provider account.
apiRouter.post('/provider-accounts/:provider', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req);

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error
      });
    }

    const provider = req.params.provider;

    if (!supportedProviders.includes(provider)) {
      return res.status(400).json({
        error: 'unsupported_provider',
        supportedProviders
      });
    }

    const {
      accessToken,
      refreshToken,
      expiresAt
    } = req.body || {};

    if (
      typeof accessToken !== 'string' ||
      !accessToken.trim()
    ) {
      return res.status(400).json({
        error: 'invalid_access_token'
      });
    }

    if (
      refreshToken !== undefined &&
      refreshToken !== null &&
      typeof refreshToken !== 'string'
    ) {
      return res.status(400).json({
        error: 'invalid_refresh_token'
      });
    }

    let tokenExpiry = null;

    if (expiresAt !== undefined && expiresAt !== null) {
      const parsedExpiry = new Date(expiresAt);

      if (Number.isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({
          error: 'invalid_expiry_date'
        });
      }

      tokenExpiry = parsedExpiry.toISOString();
    }

    let encryptedAccessToken;
    let encryptedRefreshToken = null;

    try {
      encryptedAccessToken = encryptSecret(
        accessToken.trim()
      );

      if (refreshToken) {
        encryptedRefreshToken = encryptSecret(refreshToken);
      }
    } catch (error) {
      console.error(
        'Token encryption configuration error:',
        error
      );

      return res.status(503).json({
        error: 'token_encryption_not_configured'
      });
    }

    const { error } = await req.supabase
      .from('provider_accounts')
      .upsert({
        user_id: auth.user.id,
        provider,
        encrypted_access_token: encryptedAccessToken,
        encrypted_refresh_token: encryptedRefreshToken,
        token_expires_at: tokenExpiry,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,provider'
      });

    if (error) {
      console.error('Provider account save failed:', error);

      return res.status(500).json({
        error: 'provider_account_save_failed'
      });
    }

    return res.json({
      saved: true,
      provider,
      message: 'Provider account securely saved.'
    });
  } catch (error) {
    console.error('Provider account save error:', error);

    return res.status(500).json({
      error: 'provider_account_save_failed'
    });
  }
});

// Disconnect a provider account.
apiRouter.delete('/provider-accounts/:provider', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req);

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error
      });
    }

    const provider = req.params.provider;

    if (!supportedProviders.includes(provider)) {
      return res.status(400).json({
        error: 'unsupported_provider',
        supportedProviders
      });
    }

    const { data, error } = await req.supabase
      .from('provider_accounts')
      .delete()
      .eq('user_id', auth.user.id)
      .eq('provider', provider)
      .select('provider');

    if (error) {
      console.error('Provider account deletion failed:', error);

      return res.status(500).json({
        error: 'provider_account_delete_failed'
      });
    }

    return res.json({
      deleted: Boolean(data?.length),
      provider
    });
  } catch (error) {
    console.error('Provider account delete error:', error);

    return res.status(500).json({
      error: 'provider_account_delete_failed'
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

// Resolve supplied links using Direct HTTPS and connected providers.
// Real-Debrid is optional for this route.
apiRouter.get('/streams/:type/:id', async (req, res) => {
  const { type, id } = req.params;

  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({
      error: 'invalid_type'
    });
  }

  try {
    const auth = await getAuthenticatedUser(req);

    if (auth.error) {
      return res.status(auth.status).json({
        error: auth.error
      });
    }

    const rawLinks = req.query.link ?? req.query.links ?? [];

    const links = (Array.isArray(rawLinks) ? rawLinks : [rawLinks])
      .filter((link) => {
        if (typeof link !== 'string' || link.length > 4096) {
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
        type,
        id,
        streams: [],
        providers: listProviders(),
        message: 'No source links were supplied. Direct HTTPS requires a valid media URL.'
      });
    }

    // Real-Debrid is optional. Direct HTTPS works without it.
    let realDebridAccessToken = null;

    const { data, error } = await req.supabase
      .from('provider_accounts')
      .select('encrypted_access_token')
      .eq('user_id', auth.user.id)
      .eq('provider', 'real_debrid')
      .maybeSingle();

    if (error) {
      console.error('Optional Real-Debrid lookup failed:', error);
    } else if (data?.encrypted_access_token) {
      try {
        realDebridAccessToken = decryptSecret(
          data.encrypted_access_token
        );
      } catch (decryptError) {
        console.error(
          'Real-Debrid token could not be decrypted:',
          decryptError.message
        );
      }
    }

    const streams = await getProviderStreams({
      type,
      id,
      query: req.query,
      links,
      realDebridAccessToken
    });

    return res.json({
      type,
      id,
      streams,
      providers: listProviders()
    });
  } catch (error) {
    console.error('Stream lookup failed:', error.message);

    return res.status(error.status === 401 ? 401 : 500).json({
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


// RedDemon Real-Debrid provider adapter.
// Uses the user's Real-Debrid token at runtime.
// Never store account tokens in this file.

const API_BASE = 'https://api.real-debrid.com/rest/1.0';

function requireToken(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('real_debrid_token_missing');
  }

  return accessToken.trim();
}

async function rdRequest(accessToken, path, options = {}) {
  const token = requireToken(accessToken);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(15000)
  });

  const bodyText = await response.text();

  let body = null;

  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = new Error(
      response.status === 401
        ? 'real_debrid_authentication_failed'
        : `real_debrid_api_error_${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  return body;
}

// Check the connected Real-Debrid account.
export async function getRealDebridUser(accessToken) {
  const user = await rdRequest(accessToken, '/user');

  return {
    username: user?.username || null,
    type: user?.type || null,
    expiration: user?.expiration || null,
    points: Number.isFinite(user?.points)
      ? user.points
      : null
  };
}

// Resolve a supported host link through Real-Debrid.
export async function unrestrictRealDebridLink(accessToken, link) {
  if (
    typeof link !== 'string' ||
    !/^https?:\/\//i.test(link)
  ) {
    throw new Error('real_debrid_invalid_link');
  }

  const form = new URLSearchParams({ link });

  const result = await rdRequest(
    accessToken,
    '/unrestrict/link',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    }
  );

  if (!result || typeof result.download !== 'string') {
    throw new Error('real_debrid_no_download_url');
  }

  return {
    name: result.filename || 'Real-Debrid',
    title: result.filename || 'Real-Debrid stream',
    url: result.download,
    type: 'url',
    mimeType: result.mimeType || null,
    behaviorHints: {
      notWebReady: false
    }
  };
}

// RedDemon provider registry adapter.
// Real-Debrid resolves links; it does not provide
// a movie or television search catalog.
export const realDebridProvider = {
  id: 'real_debrid',
  name: 'Real-Debrid',

  capabilities: [
    'account-check',
    'link-unrestriction'
  ],

  async getStreams(context = {}) {
    const accessToken = context.realDebridAccessToken;

    const links = Array.isArray(context.links)
      ? context.links
      : [];

    if (!accessToken || links.length === 0) {
      return [];
    }

    const results = await Promise.allSettled(
      links.map((link) =>
        unrestrictRealDebridLink(accessToken, link)
      )
    );

    return results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
  }
};

export default realDebridProvider;

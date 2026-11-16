// Resolve supplied links using Direct HTTPS and any connected providers.
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

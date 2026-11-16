
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

    res.json({
      authenticated: true,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'authentication_failed'
    });
  }
});

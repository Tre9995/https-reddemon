
// RedDemon direct HTTPS provider.
// Accepts direct media URLs supplied by the caller.
// It does not scrape websites or discover movie sources.

function getMimeType(url) {
  const path = new URL(url).pathname.toLowerCase();

  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.mpd')) return 'application/dash+xml';
  if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mkv')) return 'video/x-matroska';

  return null;
}

export const directHttpsProvider = {
  id: 'direct_https',
  name: 'Direct HTTPS',

  capabilities: [
    'direct-playback',
    'https-streams'
  ],

  async getStreams(context = {}) {
    const links = Array.isArray(context.links)
      ? context.links
      : [];

    return links
      .filter((link) => {
        if (typeof link !== 'string' || link.length > 4096) {
          return false;
        }

        try {
          return new URL(link).protocol === 'https:';
        } catch {
          return false;
        }
      })
      .map((url, index) => ({
        name: 'Direct HTTPS',
        title: 'Direct HTTPS stream ' + (index + 1),
        url,
        type: 'url',
        mimeType: getMimeType(url),
        behaviorHints: {
          notWebReady: false
        }
      }));
  }
};

export default directHttpsProvider;

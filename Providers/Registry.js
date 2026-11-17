// RedDemon provider registry.
// Provider credentials are supplied at runtime, never stored here.

import { realDebridProvider } from './real-debrid.js';
import { directHttpsProvider } from './direct-https.js';
import { plavioHdProvider } from './plavido.js';
import { penguPlayProvider } from './penguplay.js';

const providers = new Map();

export function registerProvider(provider) {
  if (
    !provider ||
    typeof provider.id !== 'string' ||
    typeof provider.getStreams !== 'function'
  ) {
    throw new TypeError(
      'Provider must have an id and getStreams(context) function'
    );
  }

  providers.set(provider.id, provider);
}

export function listProviders() {
  return [...providers.values()].map(
    ({ id, name, capabilities = [] }) => ({
      id,
      name: name || id,
      capabilities
    })
  );
}

export async function getProviderStreams(context = {}) {
  const results = await Promise.allSettled(
    [...providers.values()].map(async (provider) => {
      const streams = await provider.getStreams(context);

      return (Array.isArray(streams) ? streams : [])
        .map((stream) => ({
          provider: provider.id,
          name: stream.name || provider.name || provider.id,
          title:
            stream.title ||
            stream.name ||
            provider.name ||
            provider.id,
          url: stream.url,
          type: stream.type || 'url',
          mimeType: stream.mimeType || null,
          subtitles: Array.isArray(stream.subtitles)
            ? stream.subtitles
            : [],
          behaviorHints: stream.behaviorHints || {}
        }))
        .filter(
          (stream) =>
            typeof stream.url === 'string' &&
            /^https?:\/\//i.test(stream.url)
        );
    })
  );

  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );
}

// Register all providers.
registerProvider(realDebridProvider);
registerProvider(directHttpsProvider);
registerProvider(plavioHdProvider);
registerProvider(penguPlayProvider);

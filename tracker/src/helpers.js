// Keep URL privacy rules in one place so page views and API requests agree.
export function normalizeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    const pathname = url.pathname
      .split('/')
      .map((part) => {
        const decoded = decodeURIComponent(part);
        const isNumber = /^\d+$/.test(decoded);
        const isUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          decoded,
        );
        return isNumber || isUuid ? ':id' : part;
      })
      .join('/');

    // Queries, hashes and URL credentials are intentionally never collected.
    return `${url.origin}${pathname}`.slice(0, 2048);
  } catch {
    return null;
  }
}

export function shouldTrackUrl(url, config) {
  const patterns = (config.urlPatterns || []).filter(
    (pattern) => typeof pattern === 'string' && pattern.length > 0,
  );
  const matches = patterns.some((pattern) => url.includes(pattern));
  if (config.urlFilterMode === 'include') return matches;
  if (config.urlFilterMode === 'exclude') return !matches;
  return true;
}

// Browser security rules often hide resource timings. Missing values stay null.
export function readResourceTiming(entry) {
  const elapsed = (start, end) =>
    Number.isFinite(start) && start > 0 && Number.isFinite(end) && end >= start
      ? Math.round((end - start) * 100) / 100
      : null;

  return {
    ttfb: elapsed(entry?.requestStart, entry?.responseStart),
    dns: elapsed(entry?.domainLookupStart, entry?.domainLookupEnd),
    tcp: elapsed(entry?.connectStart, entry?.connectEnd),
    tls: elapsed(entry?.secureConnectionStart, entry?.connectEnd),
  };
}

export function createEventBuffer(maxEvents = 100, maxRetries = 3) {
  const pending = new Map();

  function add(item) {
    if (pending.has(item.event.id)) {
      const newer = pending.get(item.event.id);
      pending.set(item.event.id, {
        event: { ...item.event, ...newer.event },
        retries: Math.max(item.retries, newer.retries),
      });
      return;
    }

    if (pending.size >= maxEvents) pending.delete(pending.keys().next().value);
    pending.set(item.event.id, item);
  }

  return {
    get size() {
      return pending.size;
    },
    enqueue(event) {
      const previous = pending.get(event.id);
      if (previous) {
        pending.set(event.id, {
          event: { ...previous.event, ...event },
          retries: previous.retries,
        });
      } else {
        add({ event: { ...event }, retries: 0 });
      }
    },
    take(limit = 20) {
      const items = Array.from(pending.values()).slice(0, limit);
      items.forEach((item) => pending.delete(item.event.id));
      return items;
    },
    retry(items) {
      items.forEach((item) => {
        if (item.retries < maxRetries) add({ ...item, retries: item.retries + 1 });
      });
    },
    clear() {
      pending.clear();
    },
  };
}

import { onCLS, onFCP, onINP, onLCP } from 'web-vitals';
import {
  createEventBuffer,
  normalizeUrl,
  readResourceTiming,
  shouldTrackUrl,
} from './helpers.js';

// This file builds to one self-contained script. No framework is needed on the host site.
const script = document.currentScript;
const key = script?.dataset.key;
const disabled = () => navigator.doNotTrack === '1' || window.rumCoreDisabled === true;

if (key && key.length <= 200 && !disabled() && !window.__rumCoreStarted) {
  window.__rumCoreStarted = true;
  start(script, key).catch(() => {
    // Monitoring must never break a customer's application or create an unhandled rejection.
  });
}

async function start(scriptElement, projectKey) {
  if (typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch;
  const endpoint = new URL(scriptElement.dataset.endpoint || '/api/ingest', scriptElement.src);
  const configEndpoint = new URL(
    `${endpoint.pathname.replace(/\/$/, '')}/config`,
    endpoint.origin,
  );
  configEndpoint.searchParams.set('key', projectKey);

  const queue = createEventBuffer();
  let config = { collectVitals: true, urlFilterMode: 'all', urlPatterns: [] };
  let configReady = false;
  const environment = getEnvironment();
  let memorySession;
  let sending = false;
  let currentPage;
  let initialPage;
  let lastLocation = window.location.href;

  function makeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  function sessionId() {
    const now = Date.now();
    let session = memorySession;
    try {
      const saved = sessionStorage.getItem('rum-core-session');
      if (saved) session = JSON.parse(saved);
    } catch {
      // Session storage can be blocked in private browsing or by a browser policy.
    }
    if (
      !session ||
      typeof session.id !== 'string' ||
      !Number.isFinite(session.lastActivity) ||
      now - session.lastActivity > 30 * 60 * 1000
    ) {
      session = { id: makeId(), lastActivity: now };
    }
    session.lastActivity = now;
    memorySession = session;
    try {
      sessionStorage.setItem('rum-core-session', JSON.stringify(session));
    } catch {
      /* Use memory. */
    }
    return session.id;
  }

  function enqueue(event) {
    if (disabled()) {
      queue.clear();
      return;
    }
    if (configReady && event.type === 'request' && !shouldTrackUrl(event.url, config)) return;
    queue.enqueue(event);
    if (configReady && queue.size >= 10) void flush();
  }

  function pageView() {
    if (disabled()) {
      queue.clear();
      return;
    }
    const pageUrl = normalizeUrl(window.location.href);
    if (!pageUrl) return;
    currentPage = {
      type: 'page',
      id: makeId(),
      revision: 0,
      sessionId: sessionId(),
      pageUrl,
      url: pageUrl,
      lcp: null,
      fcp: null,
      cls: null,
      inp: null,
      ...environment,
      timestamp: new Date().toISOString(),
    };
    enqueue(currentPage);
  }

  function isOwnRequest(url) {
    try {
      const target = new URL(url, window.location.href);
      return (
        target.origin === endpoint.origin &&
        (target.pathname === endpoint.pathname || target.pathname === configEndpoint.pathname)
      );
    } catch {
      return true;
    }
  }

  function requestDetails(url, method) {
    // The exact URL is transient request metadata used only for browser timing
    // lookup. Queued events receive only the sanitized URL below.
    const absolute = new URL(url, window.location.href).href;
    const cleanUrl = normalizeUrl(absolute);
    if (!cleanUrl || isOwnRequest(absolute)) return null;
    if (configReady && !shouldTrackUrl(cleanUrl, config)) return null;
    return {
      absolute,
      url: cleanUrl,
      method: String(method || 'GET')
        .toUpperCase()
        .slice(0, 15),
      pageUrl: currentPage?.pageUrl || normalizeUrl(window.location.href),
      sessionId: sessionId(),
    };
  }

  function recordRequest(details, startedAt, duration, status) {
    if (!details || disabled()) return;
    try {
      const entries = performance.getEntriesByName?.(details.absolute, 'resource') || [];
      const entry = entries
        .filter((item) => item.startTime >= startedAt - 2)
        .sort(
          (a, b) => Math.abs(a.startTime - startedAt) - Math.abs(b.startTime - startedAt),
        )[0];

      enqueue({
        type: 'request',
        id: makeId(),
        sessionId: details.sessionId,
        pageUrl: details.pageUrl,
        url: details.url,
        method: details.method,
        status,
        duration: Math.round(duration * 100) / 100,
        ...readResourceTiming(entry),
        ...environment,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // An unsupported Performance API must not affect the original request.
    }
  }

  function instrumentFetch() {
    window.fetch = function (...args) {
      if (disabled()) {
        queue.clear();
        return nativeFetch.apply(this, args);
      }
      let details = null;
      try {
        const input = args[0];
        details = requestDetails(
          input instanceof Request ? input.url : String(input),
          args[1]?.method || input?.method,
        );
      } catch {
        /* Invalid fetch arguments are still passed to the native implementation. */
      }

      const startedAt = performance.now();
      return nativeFetch.apply(this, args).then(
        (response) => {
          const duration = performance.now() - startedAt;
          // Let the browser publish resource timing without delaying the caller's Response.
          setTimeout(() => recordRequest(details, startedAt, duration, response.status), 0);
          return response;
        },
        (error) => {
          recordRequest(details, startedAt, performance.now() - startedAt, 0);
          throw error;
        },
      );
    };
  }

  function instrumentXhr() {
    if (!window.XMLHttpRequest) return;
    const metadata = new WeakMap();
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const result = nativeOpen.call(this, method, url, ...rest);
      const cleanUrl = normalizeUrl(url, window.location.href);
      if (disabled() || !cleanUrl || isOwnRequest(url)) metadata.delete(this);
      else metadata.set(this, { method, url: new URL(url, window.location.href).href });
      return result;
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (disabled()) {
        queue.clear();
        metadata.delete(this);
        return nativeSend.apply(this, args);
      }
      const request = metadata.get(this);
      metadata.delete(this);
      let details = null;
      try {
        if (request) details = requestDetails(request.url, request.method);
      } catch {
        /* Native validation below. */
      }
      const startedAt = performance.now();
      const finished = () =>
        recordRequest(details, startedAt, performance.now() - startedAt, this.status);
      this.addEventListener('loadend', finished, { once: true });
      try {
        return nativeSend.apply(this, args);
      } catch (error) {
        this.removeEventListener('loadend', finished);
        throw error;
      }
    };
  }

  async function flush(useBeacon = false) {
    if (disabled()) {
      queue.clear();
      return;
    }
    // Capture immediately, but wait for remote filters before sending anything.
    if (!configReady) return;
    // A hidden-page flush may run while an ordinary batch is already in flight.
    if ((!useBeacon && sending) || queue.size === 0) return;
    // Ten events stay below keepalive's 64 KB limit even with long page and API URLs.
    const batch = queue.take(10);
    const body = JSON.stringify({ key: projectKey, events: batch.map((item) => item.event) });

    if (useBeacon && navigator.sendBeacon) {
      try {
        const accepted = navigator.sendBeacon(
          endpoint.href,
          new Blob([body], { type: 'text/plain;charset=UTF-8' }),
        );
        if (accepted) {
          if (queue.size > 0) void flush(true);
          return;
        }
      } catch {
        /* Some browsers block beacon; use a keepalive request below. */
      }
    }

    sending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await nativeFetch.call(window, endpoint.href, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: true,
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok && (response.status === 429 || response.status >= 500))
        queue.retry(batch);
    } catch {
      // Drop events after three retries. An offline site cannot grow this buffer forever.
      if (!disabled()) queue.retry(batch);
    } finally {
      clearTimeout(timeout);
      sending = false;
    }
  }

  function instrumentNavigation() {
    const changed = () => {
      if (window.location.href === lastLocation) return;
      lastLocation = window.location.href;
      pageView();
    };
    ['pushState', 'replaceState'].forEach((method) => {
      const native = history[method];
      history[method] = function (...args) {
        const result = native.apply(this, args);
        changed();
        return result;
      };
    });
    window.addEventListener('popstate', changed);
  }

  pageView();
  initialPage = currentPage;
  instrumentFetch();
  instrumentXhr();
  instrumentNavigation();
  window.RumCore = { flush: () => flush(), version: '1.0.0' };

  config = await loadConfig();
  if (disabled()) {
    queue.clear();
    return;
  }
  // The queue is bounded to 100 sanitized events. Apply the server's settings to
  // requests captured during startup before opening the transport.
  const captured = queue.take(100);
  for (const { event } of captured) {
    if (event.type === 'page' || shouldTrackUrl(event.url, config)) queue.enqueue(event);
  }
  configReady = true;

  if (config.collectVitals && initialPage) {
    const reportVital = (metric) => {
      if (disabled() || !Number.isFinite(metric.value)) return;
      // Native Web Vitals describe the document load, not individual SPA routes.
      const field = metric.name.toLowerCase();
      const value = Math.round(metric.value * 1000) / 1000;
      if (initialPage[field] === value) return;
      initialPage[field] = value;
      // A final beacon can reach the server before an earlier fetch batch.
      initialPage.revision += 1;
      enqueue(initialPage);
    };
    [onLCP, onFCP, onCLS, onINP].forEach((observe) => {
      try {
        observe(reportVital, { reportAllChanges: true });
      } catch {
        /* Unsupported metric. */
      }
    });
  }

  setInterval(() => {
    void flush();
  }, 10_000);
  document.addEventListener('visibilitychange', () => {
    // web-vitals also finalizes on visibilitychange; flush after its handlers run.
    if (document.visibilityState === 'hidden')
      setTimeout(() => {
        void flush(true);
      }, 0);
  });
  window.addEventListener('pagehide', () => {
    void flush(true);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      pageView();
      initialPage = currentPage;
    }
  });
  // Send the first page promptly so installation can be confirmed from the dashboard.
  void flush();

  async function loadConfig() {
    const defaults = { collectVitals: true, urlFilterMode: 'all', urlPatterns: [] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await nativeFetch.call(window, configEndpoint.href, {
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok) return defaults;
      const saved = await response.json();
      return {
        collectVitals: saved.collectVitals !== false,
        urlFilterMode: ['all', 'include', 'exclude'].includes(saved.urlFilterMode)
          ? saved.urlFilterMode
          : 'all',
        urlPatterns: Array.isArray(saved.urlPatterns)
          ? saved.urlPatterns.filter((item) => typeof item === 'string')
          : [],
      };
    } catch {
      return defaults;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function getEnvironment() {
  const agent = navigator.userAgent;
  let browser = 'Other';
  if (/Edg\//.test(agent)) browser = 'Edge';
  else if (/OPR\//.test(agent)) browser = 'Opera';
  else if (/Firefox\//.test(agent)) browser = 'Firefox';
  else if (/Chrome\//.test(agent)) browser = 'Chrome';
  else if (/Safari\//.test(agent)) browser = 'Safari';

  let os = 'Other';
  if (/Android/.test(agent)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(agent)) os = 'iOS';
  else if (/Windows/.test(agent)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(agent)) os = 'macOS';
  else if (/Linux/.test(agent)) os = 'Linux';

  const device = /iPad|Tablet/.test(agent)
    ? 'Tablet'
    : /Mobi|Android|iPhone/.test(agent)
      ? 'Mobile'
      : 'Desktop';
  return { browser, os, device, connection: navigator.connection?.effectiveType || 'Unknown' };
}

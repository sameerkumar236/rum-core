import { chromium } from 'playwright';
import { AppError } from '../../lib/errors.js';
import { validatePublicTarget, validatePublicUrl } from './security.js';
import { createGuardedProxy } from './proxy.js';
import { addIssue, emptyResult, safeUrl, summarize } from './result.js';

const MAX_REQUESTS = 250;
const MAX_BYTES = 32 * 1024 * 1024;
const rounded = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
const destination = (url) =>
  `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;

// Every check gets a fresh browser and an empty context. The optional dependencies
// are trusted test seams; HTTP routes never pass client input into these options.
export async function scanWebsiteBrowser(input, options = {}) {
  const started = performance.now();
  const timeoutMs = Math.min(options.timeoutMs || 25_000, 25_000);
  const deadline = Date.now() + timeoutMs;
  const result = emptyResult(input, 'browser', Date.now());
  const controller = new AbortController();
  const timeoutError = new Error('Website scan deadline reached.');
  const pending = new Set();
  const records = new Map();
  const pageDestinations = new Set();
  let proxy;
  let browser;
  let context;
  let page;
  let closed = false;
  let navigating = false;
  let scriptErrors = 0;
  let seenRequests = 0;
  let timer;
  let rejectDeadline;

  const deadlineReached = new Promise((_, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  const abortScan = () => {
    controller.abort();
    rejectDeadline(timeoutError);
  };
  options.signal?.addEventListener('abort', abortScan, { once: true });
  const withinDeadline = (operation) => Promise.race([operation, deadlineReached]);
  const remaining = () => Math.max(1, deadline - Date.now());

  // Late launch completion also needs cleanup if the overall timeout wins first.
  async function acquire(operation, assign) {
    const acquisition = Promise.resolve(operation).then(async (resource) => {
      if (closed) {
        await resource.close().catch(() => {});
        throw timeoutError;
      }
      assign(resource);
      return resource;
    });
    return withinDeadline(acquisition);
  }

  function trackRequest(request) {
    if (!/^https?:/i.test(request.url())) return;
    seenRequests += 1;
    if (records.size >= MAX_REQUESTS) {
      result.truncated = true;
      addIssue(
        result,
        'warning',
        `Only the first ${MAX_REQUESTS} requests were captured. Failure and transfer counts cover these captured requests; total requests includes all observed requests.`,
      );
      return;
    }
    pageDestinations.add(destination(new URL(request.url())));
    const row = {
      url: safeUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      statusCode: null,
      durationMs: null,
      transferBytes: null,
      failed: false,
    };
    records.set(request, { row, started: performance.now(), complete: false });
    result.requests.push(row);
  }

  function finishRequest(request, failed) {
    const record = records.get(request);
    if (!record || record.complete) return;
    record.complete = true;
    record.row.durationMs = rounded(performance.now() - record.started);
    record.row.failed = failed || record.row.statusCode >= 400;
    if (failed) {
      const reason = request.failure()?.errorText;
      record.row.error = /^net::[A-Z0-9_]+$/.test(reason || '')
        ? reason
        : 'The request could not finish.';
      return;
    }
    const measurement = request
      .sizes()
      .then((sizes) => {
        record.row.transferBytes = Math.max(
          0,
          sizes.responseBodySize + sizes.responseHeadersSize,
        );
        const timing = request.timing();
        if (timing.responseEnd >= 0) record.row.durationMs = rounded(timing.responseEnd);
      })
      .catch(() => {
        // A response closed during cleanup can have no size data.
      });
    pending.add(measurement);
    measurement.finally(() => pending.delete(measurement));
  }

  try {
    if (options.signal?.aborted) abortScan();
    // Validate before starting any browser process. The proxy repeats resolution
    // for every connection and pins sockets to the vetted IP, including redirects.
    const target = await withinDeadline(
      validatePublicTarget(input, options.lookup, { signal: controller.signal }),
    );
    await acquire(
      (options.createProxy || createGuardedProxy)({
        lookup: options.lookup,
        connectSocket: options.connectSocket,
        maxBytes: MAX_BYTES,
        maxConnections: 300,
        maxRequests: MAX_REQUESTS,
        onBlocked(url) {
          // Chrome can probe background services before a page is opened. They
          // are still blocked by the proxy, but are not findings about this site.
          if (!navigating || closed) return;
          // Background Chrome probes can finish after goto starts. Attribute a
          // destination-specific warning only when this page actually requested it.
          if (url) {
            try {
              const blocked = new URL(url.includes('://') ? url : `https://${url}`);
              if (!pageDestinations.has(destination(blocked))) return;
            } catch {
              return;
            }
          }
          addIssue(
            result,
            'warning',
            'A network connection was blocked by the public-network or scan-size limits.',
          );
        },
      }),
      (value) => {
        proxy = value;
      },
    );

    const channel = process.env.CHECK_BROWSER_CHANNEL || 'chrome';
    try {
      await acquire(
        (options.launchBrowser || ((settings) => chromium.launch(settings)))({
          ...(channel === 'chromium' ? {} : { channel }),
          headless: true,
          chromiumSandbox: true,
          timeout: remaining(),
          proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: '<-loopback>' },
          args: [
            '--disable-quic',
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
          ],
        }),
        (value) => {
          browser = value;
        },
      );
    } catch (error) {
      if (error === timeoutError || controller.signal.aborted) throw timeoutError;
      throw new AppError(
        503,
        'Browser scanning is unavailable. Install the configured Chrome/Chromium browser on the server, or use HTTP mode.',
      );
    }

    await acquire(
      browser.newContext({
        viewport: { width: 1365, height: 768 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        serviceWorkers: 'block',
        acceptDownloads: false,
      }),
      (value) => {
        context = value;
      },
    );
    context.setDefaultTimeout(remaining());
    context.on('request', trackRequest);
    context.on('response', (response) => {
      const request = response.request();
      const record = records.get(request);
      if (record) record.row.statusCode = response.status();
      if (page && request.isNavigationRequest() && request.frame() === page.mainFrame())
        result.page.statusCode = response.status();
    });
    context.on('requestfinished', (request) => finishRequest(request, false));
    context.on('requestfailed', (request) => finishRequest(request, true));
    context.on('page', (opened) => {
      if (page && opened !== page) void opened.close().catch(() => {});
    });

    await withinDeadline(
      context.route('**/*', async (route) => {
        try {
          const url = new URL(route.request().url());
          if (['data:', 'blob:'].includes(url.protocol)) return await route.continue();
          validatePublicUrl(url.href);
          if (seenRequests > MAX_REQUESTS) {
            addIssue(
              result,
              'warning',
              `The scan stopped collecting after ${MAX_REQUESTS} requests.`,
            );
            return await route.abort('blockedbyclient');
          }
          await route.continue();
        } catch {
          addIssue(
            result,
            'warning',
            'A page resource was blocked because it is not an allowed public HTTP/HTTPS target.',
          );
          await route.abort('blockedbyclient').catch(() => {});
        }
      }),
    );
    await withinDeadline(
      context.routeWebSocket('**/*', async (socket) => {
        addIssue(
          result,
          'info',
          'WebSocket connections are disabled during this page-load scan.',
        );
        await socket
          .close({ code: 1008, reason: 'WebSockets are disabled during scans.' })
          .catch(() => {});
      }),
    );
    await withinDeadline(context.addInitScript(installMetricObservers));
    page = await withinDeadline(context.newPage());
    page.on('pageerror', () => {
      scriptErrors += 1;
    });
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => {});
    });
    page.on('download', (download) => {
      void download.cancel().catch(() => {});
    });
    navigating = true;
    const response = await withinDeadline(
      page.goto(target.url.href, { waitUntil: 'domcontentloaded', timeout: remaining() }),
    );
    result.page.statusCode = response?.status() ?? null;
    await withinDeadline(
      new Promise((resolve) => setTimeout(resolve, Math.min(options.settleMs ?? 3000, 3000))),
    );
    const snapshot = await withinDeadline(page.evaluate(readPageMetrics));
    result.page.title = String(snapshot.title).slice(0, 200);
    result.finalUrl = safeUrl(page.url()) || result.finalUrl;
    Object.assign(result.metrics, snapshot.metrics);
    await withinDeadline(Promise.allSettled([...pending]));
  } catch (error) {
    if (error === timeoutError || controller.signal.aborted || error.name === 'TimeoutError') {
      result.timedOut = true;
      addIssue(
        result,
        'warning',
        'The page-load scan reached its time limit. Results include only work observed before it stopped.',
      );
    } else if (!navigating) {
      throw error;
    } else {
      addIssue(
        result,
        'error',
        'The browser could not finish loading this page. Check the URL, HTTPS certificate, and public accessibility.',
      );
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortScan);
    controller.abort();
    closed = true;
    if (page && !page.isClosed()) result.finalUrl = safeUrl(page.url()) || result.finalUrl;
    // Closing the context ends pending downloads, requests, popups and page scripts.
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await proxy?.close().catch(() => {});
  }

  for (const { row, started: requestStarted, complete } of records.values()) {
    if (complete) continue;
    row.durationMs = rounded(performance.now() - requestStarted);
    row.failed = true;
    row.error = 'The request did not finish within this page-load scan.';
  }
  if (scriptErrors)
    addIssue(result, 'warning', `The page reported ${scriptErrors} JavaScript error(s).`);
  result.observedRequests = seenRequests;
  result.network.totalRequests = seenRequests;
  addIssue(
    result,
    'info',
    'This is one desktop page-load test from this computer. It does not measure real users, logins, or later interactions.',
  );
  return summarize(result, started);
}

function installMetricObservers() {
  const metrics = { lcpMs: null, cls: null };
  window.__rumWebsiteCheck = metrics;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.lcpMs = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* The metric is unavailable in this browser. */
  }
  try {
    let windowStart = 0;
    let lastShift = 0;
    let windowScore = 0;
    metrics.cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        if (entry.startTime - lastShift > 1000 || entry.startTime - windowStart > 5000) {
          windowStart = entry.startTime;
          windowScore = 0;
        }
        windowScore += entry.value;
        lastShift = entry.startTime;
        metrics.cls = Math.max(metrics.cls, windowScore);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    metrics.cls = null;
  }
}

function readPageMetrics() {
  const navigation = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const measured = (value) =>
    Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  const observed = window.__rumWebsiteCheck || {};
  return {
    title: document.title,
    metrics: {
      // These connection times describe the local proxy, so they are not remote measurements.
      dnsMs: null,
      tcpMs: null,
      tlsMs: null,
      ttfbMs: measured(navigation?.responseStart),
      downloadMs:
        navigation?.responseEnd > 0
          ? Math.round((navigation.responseEnd - navigation.responseStart) * 100) / 100
          : null,
      totalMs: measured(navigation?.responseEnd),
      domContentLoadedMs: measured(navigation?.domContentLoadedEventEnd),
      loadMs: measured(navigation?.loadEventEnd),
      fcpMs: measured(fcp?.startTime),
      lcpMs: measured(observed.lcpMs),
      cls: Number.isFinite(observed.cls) ? Math.round(observed.cls * 10000) / 10000 : null,
      inpMs: null,
    },
  };
}

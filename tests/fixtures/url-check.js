// Deliberate UI fixtures. Real networking and browser scanning are tested in server/tests.
export function urlCheckResult(mode, overrides = {}) {
  const browser = mode === 'browser';
  const url = browser ? 'https://shop.example.org/' : 'https://api.example.org/products';
  const document = {
    url,
    method: 'GET',
    resourceType: 'document',
    statusCode: 200,
    durationMs: 240,
    transferBytes: 1024,
    failed: false,
  };
  const apiCall = {
    url: 'https://shop.example.org/api/products',
    method: 'GET',
    resourceType: 'fetch',
    statusCode: 200,
    durationMs: 85,
    transferBytes: 256,
    failed: false,
  };
  return {
    requestedUrl: url,
    finalUrl: url,
    checkedAt: new Date().toISOString(),
    durationMs: 450,
    mode,
    page: { title: browser ? 'Website scan fixture' : 'API check fixture', statusCode: 200 },
    metrics: {
      dnsMs: browser ? null : 12,
      tcpMs: browser ? null : 18,
      tlsMs: browser ? null : 23,
      ttfbMs: 90,
      downloadMs: 40,
      totalMs: 240,
      domContentLoadedMs: browser ? 200 : null,
      loadMs: browser ? 240 : null,
      fcpMs: browser ? 100 : null,
      lcpMs: browser ? 180 : null,
      cls: browser ? 0.01 : null,
      inpMs: null,
    },
    network: {
      totalRequests: browser ? 2 : 1,
      failedRequests: 0,
      transferredBytes: browser ? 1280 : 1024,
    },
    requests: browser ? [document, apiCall] : [document],
    issues: [],
    environment: {
      device: 'desktop',
      viewport: '1365x768',
      source: 'single-page test from this computer',
    },
    timedOut: false,
    ...overrides,
  };
}

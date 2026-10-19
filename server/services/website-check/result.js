export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href.slice(0, 4096);
  } catch {
    return '';
  }
}

export function emptyResult(url, mode, started) {
  return {
    requestedUrl: safeUrl(url),
    finalUrl: safeUrl(url),
    checkedAt: new Date(started).toISOString(),
    durationMs: 0,
    mode,
    page: { title: '', statusCode: null },
    metrics: {
      dnsMs: null,
      tcpMs: null,
      tlsMs: null,
      ttfbMs: null,
      downloadMs: null,
      totalMs: null,
      domContentLoadedMs: null,
      loadMs: null,
      fcpMs: null,
      lcpMs: null,
      cls: null,
      inpMs: null,
    },
    network: { totalRequests: 0, failedRequests: 0, transferredBytes: 0 },
    requests: [],
    issues: [],
    environment: {
      device: 'desktop',
      viewport: '1365x768',
      source: 'single-page test from this computer',
    },
    timedOut: false,
  };
}

export function addIssue(result, severity, message) {
  const bounded = String(message)
    .replace(/[\u0000-\u001f]/g, ' ')
    .slice(0, 500);
  if (result.issues.length < 24 && !result.issues.some((issue) => issue.message === bounded))
    result.issues.push({ severity, message: bounded });
}

export function summarize(result, start) {
  result.durationMs = Math.round(performance.now() - start);
  result.requestedUrl = safeUrl(result.requestedUrl);
  result.finalUrl = safeUrl(result.finalUrl);
  result.requests = result.requests.map((request) => ({
    ...request,
    url: safeUrl(request.url),
  }));
  const observed = Number.isSafeInteger(result.observedRequests) ? result.observedRequests : 0;
  const previousTotal = Number.isSafeInteger(result.network.totalRequests)
    ? result.network.totalRequests
    : 0;
  result.network.totalRequests = Math.max(result.requests.length, observed, previousTotal);
  if (result.network.totalRequests > result.requests.length) {
    result.truncated = true;
    addIssue(
      result,
      'warning',
      'The request list was truncated. Failure and transfer totals include only the captured requests.',
    );
  }
  result.network.failedRequests = result.requests.filter((request) => request.failed).length;
  result.network.transferredBytes = result.requests.reduce(
    (total, request) => total + (request.transferBytes || 0),
    0,
  );
  if (result.page.statusCode >= 400)
    addIssue(result, 'error', `The page responded with HTTP ${result.page.statusCode}.`);
  if (result.network.failedRequests)
    addIssue(
      result,
      'warning',
      `${result.network.failedRequests} requests failed or returned an HTTP error.`,
    );
  return result;
}

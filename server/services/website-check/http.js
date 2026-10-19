import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { AppError } from '../../lib/errors.js';
import { validatePublicTarget, validatePublicUrl } from './security.js';
import { addIssue, emptyResult, summarize, safeUrl } from './result.js';

export const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const rounded = (value) => (value === null ? null : Math.round(value * 100) / 100);

// The connection uses a vetted literal IP; DNS is never repeated by the transport.
export function pinnedHttpRequest(target, { signal, maxBytes = MAX_HTTP_BODY_BYTES }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const address = target.addresses.find((item) => item.family === 4) || target.addresses[0];
    const hostname = target.url.hostname.replace(/^\[|\]$/g, '');
    const timings = {
      dnsMs: target.dnsMs ?? null,
      tcpMs: null,
      tlsMs: null,
      ttfbMs: null,
      downloadMs: null,
      totalMs: null,
    };
    let connectedAt;
    let firstByte;
    let settled = false;
    const outgoing = (target.url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        hostname: address.address,
        family: address.family,
        ...(isIP(hostname) ? {} : { servername: hostname }),
        port: Number(target.url.port || (target.url.protocol === 'https:' ? 443 : 80)),
        path: target.url.pathname + target.url.search,
        method: 'GET',
        agent: false,
        signal,
        headers: {
          Host: target.url.host,
          'User-Agent': 'RUM-Core-Website-Check/1.0',
          Accept: 'text/html,application/json,*/*;q=0.8',
          'Accept-Encoding': 'identity',
        },
      },
      (incoming) => {
        firstByte = performance.now();
        timings.ttfbMs = firstByte - start + (target.dnsMs || 0);
        const chunks = [];
        let bytes = 0;
        const finish = (truncated) => {
          if (settled) return;
          settled = true;
          const end = performance.now();
          timings.downloadMs = end - firstByte;
          timings.totalMs = end - start + (target.dnsMs || 0);
          resolve({
            statusCode: incoming.statusCode || 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            transferredBytes: bytes,
            truncated,
            timings: Object.fromEntries(
              Object.entries(timings).map(([key, value]) => [key, rounded(value)]),
            ),
          });
        };
        incoming.on('data', (chunk) => {
          const remaining = maxBytes - bytes;
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          bytes += Math.min(chunk.length, Math.max(0, remaining));
          if (chunk.length > remaining) {
            finish(true);
            incoming.destroy();
            outgoing.destroy();
          }
        });
        incoming.once('end', () => finish(false));
        incoming.once('error', (error) => {
          if (!settled) reject(error);
        });
        incoming.once('aborted', () => {
          if (!settled) reject(new Error('The response ended before it completed.'));
        });
      },
    );
    outgoing.once('socket', (socket) => {
      const connectStart = performance.now();
      socket.once('connect', () => {
        connectedAt = performance.now();
        timings.tcpMs = connectedAt - connectStart;
      });
      if (target.url.protocol === 'https:')
        socket.once('secureConnect', () => {
          timings.tlsMs = performance.now() - connectedAt;
        });
    });
    outgoing.once('error', (error) => {
      if (!settled) reject(error);
    });
    outgoing.end();
  });
}

export async function scanWebsiteHttp(input, options = {}) {
  const start = performance.now();
  const url = validatePublicUrl(input);
  const result = emptyResult(url.href, 'http', Date.now());
  addIssue(
    result,
    'info',
    'This is one GET request from the monitoring server. It does not execute JavaScript or discover page API calls.',
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let current = url.href;
  let completed = false;
  try {
    for (let hop = 0; hop <= 8; hop++) {
      const hopStart = performance.now();
      const target = await validatePublicTarget(current, options.lookup, {
        signal: controller.signal,
      });
      const requestStart = performance.now();
      const response = await (options.transport || pinnedHttpRequest)(target, {
        signal: controller.signal,
        maxBytes: MAX_HTTP_BODY_BYTES,
      });
      if (controller.signal.aborted) throw new AppError(504, 'The website check timed out.');
      result.requests.push({
        url: safeUrl(target.url.href),
        method: 'GET',
        resourceType: 'document',
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - requestStart + target.dnsMs),
        transferBytes: response.transferredBytes,
        failed: response.statusCode >= 400,
      });
      result.page.statusCode = response.statusCode;
      Object.assign(result.metrics, response.timings || { ttfbMs: response.ttfbMs ?? null });
      // DNS/TCP/TLS/download describe the final hop. TTFB spans the redirect chain.
      const hopTtfb = response.timings?.ttfbMs ?? response.ttfbMs;
      result.metrics.ttfbMs = Number.isFinite(hopTtfb)
        ? rounded(hopStart - start + hopTtfb)
        : null;
      result.finalUrl = safeUrl(target.url.href);
      if (
        [301, 302, 303, 307, 308].includes(response.statusCode) &&
        response.headers.location
      ) {
        if (hop === 8) {
          addIssue(result, 'warning', 'Stopped after eight redirects.');
          result.truncated = true;
          break;
        }
        try {
          current = new URL(response.headers.location, target.url).href;
        } catch {
          throw new AppError(502, 'The website sent an invalid redirect URL.');
        }
        continue;
      }
      const title = response.body?.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
      result.page.title = title
        .replace(/<[^>]*>/g, '')
        .replace(/[\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      if (response.truncated) {
        result.truncated = true;
        addIssue(result, 'warning', 'Stopped reading after the 2 MiB response limit.');
      }
      completed = true;
      break;
    }
  } catch (error) {
    if (error instanceof AppError && error.status === 400) throw error;
    result.timedOut = controller.signal.aborted;
    addIssue(
      result,
      'error',
      result.timedOut
        ? 'The HTTP check reached its time limit; available results are shown.'
        : 'The URL could not be loaded from this computer. Check the address and TLS certificate.',
    );
    result.requests.push({
      url: safeUrl(current),
      method: 'GET',
      resourceType: 'document',
      statusCode: null,
      durationMs: null,
      transferBytes: 0,
      failed: true,
      error: result.timedOut ? 'Timeout' : 'Connection failed',
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  if (!completed && !result.issues.some((issue) => issue.severity === 'error'))
    addIssue(result, 'warning', 'The final document was not reached.');
  // This is a measured end-to-end span, including DNS and redirects, not a fabricated phase.
  result.metrics.totalMs = rounded(performance.now() - start);
  return summarize(result, start);
}

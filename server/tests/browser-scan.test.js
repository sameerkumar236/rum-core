import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { scanWebsiteBrowser } from '../services/website-check/browser.js';
import { createGuardedProxy } from '../services/website-check/proxy.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('browser scan rejects private DNS before starting a proxy or browser', async () => {
  let launched = false;
  await assert.rejects(
    scanWebsiteBrowser('http://fixture.example.com/', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      createProxy: async () => {
        launched = true;
      },
      launchBrowser: async () => {
        launched = true;
      },
    }),
    (error) => error.status === 400,
  );
  assert.equal(launched, false);
});

test('missing browser returns a helpful 503 and closes its proxy without echoing URL secrets', async () => {
  let closed = 0;
  await assert.rejects(
    scanWebsiteBrowser('http://fixture.example.com/?token=private-secret', {
      lookup: publicLookup,
      createProxy: async () => ({
        port: 12345,
        close: async () => {
          closed += 1;
        },
      }),
      launchBrowser: async (settings) => {
        assert.equal(settings.proxy.bypass, '<-loopback>');
        assert.equal(settings.chromiumSandbox, true);
        assert.ok(settings.args.includes('--disable-quic'));
        throw new Error(
          'Browser executable missing: http://fixture.example.com/?token=private-secret',
        );
      },
    }),
    (error) =>
      error.status === 503 &&
      /HTTP mode/.test(error.message) &&
      !error.message.includes('private-secret'),
  );
  assert.equal(closed, 1);
});

test('deadline closes the proxy and also closes a browser that finishes launching late', async () => {
  let proxyClosed = 0;
  let browserClosed = 0;
  const result = await scanWebsiteBrowser('http://fixture.example.com/?token=private-secret', {
    timeoutMs: 25,
    lookup: publicLookup,
    createProxy: async () => ({
      port: 12345,
      close: async () => {
        proxyClosed += 1;
      },
    }),
    launchBrowser: async () => {
      await wait(75);
      return {
        close: async () => {
          browserClosed += 1;
        },
      };
    },
  });
  assert.equal(result.timedOut, true);
  assert.equal(proxyClosed, 1);
  assert.equal(result.mode, 'browser');
  assert.equal(result.requestedUrl, 'http://fixture.example.com/');
  await wait(100);
  assert.equal(browserClosed, 1);
});

test('context creation failure still closes the browser and proxy', async () => {
  let proxyClosed = 0;
  let browserClosed = 0;
  await assert.rejects(
    scanWebsiteBrowser('http://fixture.example.com/', {
      lookup: publicLookup,
      createProxy: async () => ({
        port: 12345,
        close: async () => {
          proxyClosed += 1;
        },
      }),
      launchBrowser: async () => ({
        newContext: async () => {
          throw new Error('Context creation failed');
        },
        close: async () => {
          browserClosed += 1;
        },
      }),
    }),
    /Context creation failed/,
  );
  assert.equal(proxyClosed, 1);
  assert.equal(browserClosed, 1);
});

test(
  'real Chrome captures page-load APIs through the guarded proxy and blocks private destinations',
  { timeout: 40_000 },
  async () => {
    const received = [];
    const dialed = [];
    const blocked = [];
    let simulateBackgroundProbe = () => {};
    const fixture = createServer((request, response) => {
      received.push(request.url);
      const path = new URL(request.url, 'http://fixture.example.com').pathname;
      if (path === '/never') {
        request.socket.destroy();
        return;
      }
      if (path === '/burst') {
        response.setHeader('Content-Type', 'text/html');
        return response.end(
          '<!doctype html><title>Busy fixture</title><h1>Busy fixture</h1><script>for(let id=0;id<260;id++)fetch("/api/burst/"+id).catch(()=>{});</script>',
        );
      }
      if (path === '/clean') {
        // This callback runs after goto started, rather than during browser launch.
        simulateBackgroundProbe('mtalk.google.com:5228', 'Only ports 80 and 443 are allowed.');
        response.setHeader('Content-Type', 'text/html');
        return response.end(
          '<!doctype html><title>Clean fixture</title><h1>Clean fixture</h1>',
        );
      }
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        return response.end(`<!doctype html><html><head><title>Fixture shop</title>
        <link rel="stylesheet" href="/style.css"></head><body><h1>Fixture shop</h1>
        <p>A real browser loads this fixture and its APIs.</p><script src="/app.js"></script></body></html>`);
      }
      if (path === '/style.css') {
        response.setHeader('Content-Type', 'text/css');
        return response.end('body { font: 20px sans-serif; padding: 30px; }');
      }
      if (path === '/app.js') {
        response.setHeader('Content-Type', 'application/javascript');
        return response.end(`fetch('/api/items?token=private-secret').catch(() => {});
        fetch('/api/error').catch(() => {});
        const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/xhr?secret=private-secret'); xhr.send();
        fetch('http://127.0.0.1/private?secret=private-secret').catch(() => {});
        fetch('/redirect-private').catch(() => {});
        const socket = new WebSocket('ws://127.0.0.1/private'); socket.onerror = () => {};
        try { navigator.serviceWorker.register('/worker.js').catch(() => {}); } catch {}`);
      }
      if (path === '/redirect-private') {
        response.writeHead(302, { Location: 'http://127.0.0.1/private-redirect' });
        return response.end();
      }
      if (path === '/api/error') {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        return response.end('{"privateResponse":"private-secret"}');
      }
      response.setHeader('Content-Type', 'application/json');
      response.end('{"privateResponse":"private-secret"}');
    });
    await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
    let proxyClosed = false;
    try {
      const scannerOptions = {
        lookup: publicLookup,
        settleMs: 600,
        connectSocket: (target) => {
          dialed.push(target);
          return connect({ host: '127.0.0.1', port: fixture.address().port });
        },
        createProxy: async (settings) => {
          simulateBackgroundProbe = settings.onBlocked;
          // Simulate a Chrome startup probe blocked before page navigation.
          settings.onBlocked(
            'background.example.com:5228',
            'Only ports 80 and 443 are allowed.',
          );
          const proxy = await createGuardedProxy({
            ...settings,
            onBlocked: (url, message) => {
              blocked.push({ target: url.split(/[?#]/)[0], message });
              settings.onBlocked(url, message);
            },
          });
          return {
            ...proxy,
            close: async () => {
              await proxy.close();
              proxyClosed = true;
            },
          };
        },
      };
      const result = await scanWebsiteBrowser(
        'http://fixture.example.com/?token=private-secret#private-secret',
        scannerOptions,
      );

      assert.equal(result.mode, 'browser');
      assert.equal(result.timedOut, false);
      assert.equal(result.page.statusCode, 200);
      assert.equal(result.page.title, 'Fixture shop');
      assert.equal(result.requestedUrl, 'http://fixture.example.com/');
      assert.equal(result.finalUrl, 'http://fixture.example.com/');
      assert.ok(result.metrics.domContentLoadedMs > 0);
      assert.ok(result.metrics.ttfbMs > 0);
      assert.equal(result.metrics.dnsMs, null);
      assert.equal(result.metrics.tcpMs, null);
      assert.equal(result.metrics.tlsMs, null);
      assert.equal(result.metrics.inpMs, null);
      assert.ok(
        result.requests.some(
          (row) =>
            row.resourceType === 'fetch' &&
            row.url.endsWith('/api/items') &&
            row.statusCode === 200,
        ),
      );
      assert.ok(
        result.requests.some(
          (row) =>
            row.resourceType === 'xhr' &&
            row.url.endsWith('/api/xhr') &&
            row.statusCode === 200,
        ),
      );
      assert.ok(
        result.requests.some(
          (row) => row.url.endsWith('/api/error') && row.statusCode === 503 && row.failed,
        ),
      );
      assert.ok(
        result.requests.some((row) => row.url.startsWith('http://127.0.0.1/') && row.failed),
      );
      assert.ok(result.issues.some((issue) => /blocked/.test(issue.message)));
      assert.ok(blocked.some((entry) => entry.target === 'http://127.0.0.1/private-redirect'));
      assert.ok(
        result.issues.some((issue) => /A network connection was blocked/.test(issue.message)),
      );
      assert.ok(result.issues.some((issue) => /WebSocket/.test(issue.message)));
      assert.ok(result.network.transferredBytes > 0);
      assert.equal(result.network.totalRequests, result.requests.length);
      assert.equal(
        result.network.failedRequests,
        result.requests.filter((row) => row.failed).length,
      );
      assert.ok(dialed.length > 0);
      assert.ok(
        dialed.every(
          (target) => target.address === '93.184.216.34' && [80, 443].includes(target.port),
        ),
      );
      assert.ok(received.every((url) => !url.startsWith('/private')));
      assert.equal(JSON.stringify(result).includes('private-secret'), false);
      assert.equal(JSON.stringify(result).includes('privateResponse'), false);
      assert.equal(proxyClosed, true);

      const clean = await scanWebsiteBrowser(
        'http://fixture.example.com/clean',
        scannerOptions,
      );
      assert.equal(
        clean.issues.some((issue) => /A network connection was blocked/.test(issue.message)),
        false,
      );

      const burst = await scanWebsiteBrowser(
        'http://fixture.example.com/burst',
        scannerOptions,
      );
      assert.equal(burst.truncated, true);
      assert.equal(burst.requests.length, 250);
      assert.ok(burst.network.totalRequests > burst.requests.length);
      assert.equal(burst.network.totalRequests, burst.observedRequests);
      assert.ok(
        burst.issues.some((issue) => /first 250 requests were captured/.test(issue.message)),
      );

      const failed = await scanWebsiteBrowser(
        'http://fixture.example.com/never?token=private-secret',
        scannerOptions,
      );
      assert.equal(failed.finalUrl, 'http://fixture.example.com/never');
      assert.ok(failed.issues.some((issue) => issue.severity === 'error'));
      assert.equal(JSON.stringify(failed).includes('private-secret'), false);
    } finally {
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
    }
  },
);

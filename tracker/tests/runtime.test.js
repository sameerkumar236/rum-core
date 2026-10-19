import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

// Bundle the real SDK and its helpers just as production does. Only vendor metric
// observers are replaced, so source formatting cannot change how this harness runs.
const bundle = await build({
  absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
  entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  tsconfigRaw: {},
  plugins: [
    {
      name: 'stub-vital-observers',
      setup(builder) {
        builder.onResolve({ filter: /^web-vitals$/ }, () => ({
          path: 'web-vitals',
          namespace: 'test-vitals',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'test-vitals' }, () => ({
          contents: ['CLS', 'FCP', 'INP', 'LCP']
            .map(
              (metric) =>
                `export const on${metric} = (...args) => globalThis.on${metric}(...args);`,
            )
            .join('\n'),
          loader: 'js',
        }));
      },
    },
  ],
});
const source = bundle.outputFiles[0].text;
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function browser(config = {}, extra = {}) {
  const calls = [];
  const callbacks = {};
  const timers = new Map();
  const listeners = new Map();
  const storage = new Map();
  const failure = new Error('Original network failure');
  const response = new Response('Original response', { status: 201 });
  let clock = 10;
  let sequence = 0;
  let releaseConfig;
  const delayedConfig = new Promise((resolve) => {
    releaseConfig = resolve;
  });

  class FakeXhr {
    status = 0;
    listeners = new Map();
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(...args) {
      this.originalArgs = args;
    }
    addEventListener(name, handler) {
      this.listeners.set(name, handler);
    }
    removeEventListener(name) {
      this.listeners.delete(name);
    }
    finish(status) {
      this.status = status;
      this.listeners.get('loadend')?.();
    }
  }

  const context = {
    URL,
    Request,
    AbortController,
    Blob,
    Date,
    Math,
    console,
    document: {
      currentScript: {
        src: 'https://monitor.test/tracker.js',
        dataset: { key: 'public-project-key' },
      },
      visibilityState: 'visible',
      addEventListener(name, handler) {
        listeners.set(name, handler);
      },
    },
    location: new URL('https://shop.test/products/123?email=private#secret'),
    navigator: {
      userAgent: 'Mozilla/5.0 Chrome/130.0 Safari/537.36',
      doNotTrack: '0',
      ...extra.navigator,
    },
    crypto: { randomUUID: () => `event-${++sequence}` },
    performance: { now: () => clock, getEntriesByName: () => [] },
    sessionStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    XMLHttpRequest: FakeXhr,
    fetch: async (...args) => {
      calls.push(args);
      clock += 5;
      if (String(args[0]).includes('/api/ingest/config')) {
        if (extra.delayConfig) await delayedConfig;
        return new Response(JSON.stringify(config));
      }
      if (String(args[0]).includes('/api/ingest')) return new Response('{}', { status: 202 });
      if (String(args[0]).includes('/fail')) throw failure;
      return response;
    },
    setTimeout(handler, delay) {
      const id = ++sequence;
      timers.set(id, { handler, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval() {
      return ++sequence;
    },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    rumCoreDisabled: extra.disabled || false,
  };
  context.history = Object.fromEntries(
    ['pushState', 'replaceState'].map((method) => [
      method,
      (_state, _title, url) => {
        context.location = new URL(url, context.location);
      },
    ]),
  );
  ['LCP', 'FCP', 'CLS', 'INP'].forEach((metric) => {
    context[`on${metric}`] = (handler) => {
      callbacks[metric] = handler;
    };
  });
  context.window = context;
  const originalFetch = context.fetch;
  const originalOpen = FakeXhr.prototype.open;
  const sandbox = vm.createContext(context);
  vm.runInContext(source, sandbox);
  await settle();

  return {
    window: context,
    calls,
    callbacks,
    failure,
    response,
    originalFetch,
    originalOpen,
    async resolveConfig() {
      releaseConfig();
      await settle();
    },
    events: () =>
      calls
        .filter(
          (call) =>
            String(call[0]) === 'https://monitor.test/api/ingest' &&
            call[1]?.method === 'POST',
        )
        .flatMap((call) => JSON.parse(call[1].body).events),
    runTimers() {
      for (const [id, timer] of timers) {
        if (timer.delay === 0) {
          timers.delete(id);
          timer.handler();
        }
      }
    },
    runAgain() {
      vm.runInContext(source, sandbox);
    },
  };
}

test('SDK preserves fetch response, rejection identity, arguments and private URL rules', async () => {
  const page = await browser();
  const options = {
    method: 'POST',
    body: 'private body',
    headers: { Authorization: 'private token' },
  };
  const received = await page.window.fetch(
    'https://shop.test/api/orders/42?token=private#secret',
    options,
  );
  assert.equal(received, page.response);
  assert.equal(page.calls.at(-1)[1], options);
  await assert.rejects(
    page.window.fetch('https://shop.test/fail?secret=1'),
    (error) => error === page.failure,
  );
  page.runTimers();
  await page.window.RumCore.flush();

  const requests = page.events().filter((event) => event.type === 'request');
  assert.equal(requests.length, 2);
  assert.equal(
    requests.find((event) => event.status === 201).url,
    'https://shop.test/api/orders/:id',
  );
  assert.equal(requests.find((event) => event.status === 0).url, 'https://shop.test/fail');
  assert.equal(requests[0].ttfb, null);
  assert.equal(page.events()[0].pageUrl, 'https://shop.test/products/:id');
  assert.equal(JSON.stringify(page.events()).includes('private'), false);
});

test('XHR status and page attribution are captured without changing send arguments', async () => {
  const page = await browser();
  const xhr = new page.window.XMLHttpRequest();
  xhr.open('PUT', '/api/orders/789?secret=1');
  const body = { content: 'private' };
  xhr.send(body);
  xhr.finish(204);
  await page.window.RumCore.flush();
  const request = page.events().find((event) => event.type === 'request');
  assert.equal(xhr.originalArgs[0], body);
  assert.equal(request.method, 'PUT');
  assert.equal(request.status, 204);
  assert.equal(request.url, 'https://shop.test/api/orders/:id');
});

test('concurrent requests that normalize to the same URL keep their own resource timings', async () => {
  const page = await browser();
  // Identical start times make a normalized-path lookup ambiguous.
  page.window.performance.now = () => 100;
  const firstUrl = 'https://shop.test/api/timing/123?token=first-secret';
  const secondUrl = 'https://shop.test/api/timing/456?token=second-secret';
  const entries = new Map([
    [firstUrl, [{ startTime: 100, requestStart: 102, responseStart: 104 }]],
    [secondUrl, [{ startTime: 100, requestStart: 102, responseStart: 110 }]],
  ]);
  const lookups = [];
  page.window.performance.getEntriesByName = (url, type) => {
    assert.equal(type, 'resource');
    lookups.push(url);
    return entries.get(url) || [];
  };
  await Promise.all([page.window.fetch(firstUrl), page.window.fetch(secondUrl)]);
  page.runTimers();
  await page.window.RumCore.flush();
  const requests = page.events().filter((event) => event.type === 'request');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url === 'https://shop.test/api/timing/:id'));
  assert.deepEqual(
    requests.map((request) => request.ttfb),
    [2, 8],
  );
  assert.deepEqual(lookups, [firstUrl, secondUrl]);
  assert.ok(requests.every((request) => request.dns === null && request.tls === null));
  assert.equal(JSON.stringify(page.events()).includes('first-secret'), false);
  assert.equal(JSON.stringify(page.events()).includes('second-secret'), false);
});

test('vitals keep the initial page ID while SPA navigation creates a separate page', async () => {
  const page = await browser();
  const initial = page.events()[0];
  assert.equal(initial.revision, 0);
  page.window.history.pushState({}, '', '/checkout?email=private');
  page.callbacks.LCP({ name: 'LCP', value: 1234.567 });
  page.callbacks.CLS({ name: 'CLS', value: 0.034 });
  await page.window.RumCore.flush();

  const events = page.events();
  const updated = events.find((event) => event.id === initial.id && event.lcp !== null);
  const checkout = events.find((event) => event.pageUrl === 'https://shop.test/checkout');
  assert.equal(updated.lcp, 1234.567);
  assert.equal(updated.cls, 0.034);
  assert.equal(updated.revision, 2);
  assert.equal(updated.timestamp, initial.timestamp);
  assert.equal(checkout.lcp, null);
  assert.equal(checkout.revision, 0);
  assert.notEqual(checkout.id, initial.id);
  assert.equal(checkout.sessionId, initial.sessionId);

  const count = page.events().length;
  page.callbacks.LCP({ name: 'LCP', value: 1234.567 });
  await page.window.RumCore.flush();
  assert.equal(page.events().length, count);
});

test('initialization respects consent, duplicate guards and remote request filters', async () => {
  const optedOut = await browser({}, { navigator: { doNotTrack: '1' } });
  assert.equal(optedOut.calls.length, 0);
  assert.equal(optedOut.window.fetch, optedOut.originalFetch);
  assert.equal(optedOut.window.XMLHttpRequest.prototype.open, optedOut.originalOpen);
  assert.equal(optedOut.window.__rumCoreStarted, undefined);
  const disabled = await browser({}, { disabled: true });
  assert.equal(disabled.calls.length, 0);

  const page = await browser({
    collectVitals: false,
    urlFilterMode: 'exclude',
    urlPatterns: ['/ignore'],
  });
  const wrapped = page.window.fetch;
  page.runAgain();
  assert.equal(page.window.fetch, wrapped);
  assert.equal(Object.keys(page.callbacks).length, 0);
  await page.window.fetch('/ignore?secret=1');
  page.runTimers();
  await page.window.RumCore.flush();
  assert.equal(page.events().filter((event) => event.type === 'request').length, 0);

  page.window.rumCoreDisabled = true;
  await page.window.fetch('/would-have-been-tracked');
  page.runTimers();
  await page.window.RumCore.flush();
  assert.equal(page.events().length, 1);
});

test('startup fetch, XHR and SPA events wait for config, then obey include rules and keep initial-page vitals', async () => {
  const page = await browser(
    { urlFilterMode: 'include', urlPatterns: ['/api/allowed'] },
    { delayConfig: true },
  );
  const received = await page.window.fetch('/api/allowed/123?token=private-secret');
  assert.equal(received, page.response);
  const xhr = new page.window.XMLHttpRequest();
  xhr.open('POST', '/api/allowed/xhr?token=private-secret');
  xhr.send('private body');
  xhr.finish(204);
  await page.window.fetch('/api/blocked?token=private-secret');
  await assert.rejects(
    page.window.fetch('/api/allowed/fail'),
    (error) => error === page.failure,
  );
  page.window.history.pushState({}, '', '/checkout?email=private-secret');
  for (let index = 0; index < 12; index += 1) await page.window.fetch(`/api/allowed/${index}`);
  page.runTimers();
  await page.window.RumCore.flush();
  assert.equal(page.events().length, 0);
  assert.equal(Object.keys(page.callbacks).length, 0);

  await page.resolveConfig();
  await page.window.RumCore.flush();
  const events = page.events();
  const initial = events.find(
    (event) => event.type === 'page' && event.pageUrl === 'https://shop.test/products/:id',
  );
  const checkout = events.find(
    (event) => event.type === 'page' && event.pageUrl === 'https://shop.test/checkout',
  );
  const requests = events.filter((event) => event.type === 'request');
  assert.ok(initial && checkout);
  assert.notEqual(initial.id, checkout.id);
  assert.equal(requests.length, 15);
  assert.ok(requests.every((event) => event.url.includes('/api/allowed')));
  assert.ok(requests.some((event) => event.method === 'POST' && event.status === 204));
  assert.ok(requests.some((event) => event.status === 0));
  assert.ok(requests.some((event) => event.pageUrl === initial.pageUrl));
  assert.ok(requests.some((event) => event.pageUrl === checkout.pageUrl));
  assert.ok(requests.every((event) => event.ttfb === null && event.dns === null));
  assert.equal(JSON.stringify(events).includes('private-secret'), false);
  assert.equal(JSON.stringify(events).includes('private body'), false);

  page.callbacks.LCP({ name: 'LCP', value: 1800 });
  await page.window.RumCore.flush();
  const vital = page.events().find((event) => event.id === initial.id && event.lcp === 1800);
  assert.equal(vital.revision, 1);
  assert.equal(vital.timestamp, initial.timestamp);
});

test('startup requests obey exclude rules and a disabled vitals setting after delayed config', async () => {
  const page = await browser(
    { collectVitals: false, urlFilterMode: 'exclude', urlPatterns: ['/private'] },
    { delayConfig: true },
  );
  await page.window.fetch('/api/private?secret=private-secret');
  const excluded = new page.window.XMLHttpRequest();
  excluded.open('GET', '/api/private/xhr');
  excluded.send();
  excluded.finish(200);
  const allowed = new page.window.XMLHttpRequest();
  allowed.open('GET', '/api/public');
  allowed.send();
  allowed.finish(200);
  page.runTimers();
  await page.window.RumCore.flush();
  assert.equal(page.events().length, 0);
  await page.resolveConfig();
  const requests = page.events().filter((event) => event.type === 'request');
  assert.deepEqual(
    requests.map((event) => event.url),
    ['https://shop.test/api/public'],
  );
  assert.equal(Object.keys(page.callbacks).length, 0);
  assert.equal(page.events().filter((event) => event.type === 'page').length, 1);
});

test('consent withdrawn during config delay clears startup events and sends nothing', async () => {
  const page = await browser({}, { delayConfig: true });
  await page.window.fetch('/api/allowed?secret=private-secret');
  page.runTimers();
  page.window.rumCoreDisabled = true;
  await page.window.RumCore.flush();
  await page.resolveConfig();
  await page.window.RumCore.flush();
  assert.equal(page.events().length, 0);
  assert.equal(Object.keys(page.callbacks).length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEventBuffer,
  normalizeUrl,
  readResourceTiming,
  shouldTrackUrl,
} from '../src/helpers.js';

test('URLs never contain queries, fragments or credentials; identifiers are grouped', () => {
  assert.equal(
    normalizeUrl('https://user:secret@shop.test/orders/123?email=private#token'),
    'https://shop.test/orders/:id',
  );
  assert.equal(
    normalizeUrl('/users/0e1b9160-e611-4bd7-8460-198276613ed0', 'https://shop.test'),
    'https://shop.test/users/:id',
  );
  assert.equal(normalizeUrl('data:text/plain,secret'), null);
  assert.equal(normalizeUrl('https://shop.test/%zz'), null);
});

test('URL rules use literal substring matching on sanitized URLs', () => {
  const url = 'https://shop.test/api/orders/:id';
  assert.equal(shouldTrackUrl(url, { urlFilterMode: 'all' }), true);
  assert.equal(
    shouldTrackUrl(url, { urlFilterMode: 'include', urlPatterns: ['/api/orders'] }),
    true,
  );
  assert.equal(shouldTrackUrl(url, { urlFilterMode: 'include', urlPatterns: [] }), false);
  assert.equal(
    shouldTrackUrl(url, { urlFilterMode: 'exclude', urlPatterns: ['/api/'] }),
    false,
  );
  assert.equal(shouldTrackUrl(url, { urlFilterMode: 'include', urlPatterns: ['.*'] }), false);
});

test('timings hidden by browser security remain missing, never fake zeros', () => {
  assert.deepEqual(readResourceTiming(), { ttfb: null, dns: null, tcp: null, tls: null });
  assert.deepEqual(readResourceTiming({ requestStart: 0, responseStart: 0 }), {
    ttfb: null,
    dns: null,
    tcp: null,
    tls: null,
  });
  assert.deepEqual(
    readResourceTiming({
      requestStart: 20,
      responseStart: 35,
      domainLookupStart: 2,
      domainLookupEnd: 2,
      connectStart: 4,
      connectEnd: 10,
      secureConnectionStart: 6,
    }),
    {
      ttfb: 15,
      dns: 0,
      tcp: 6,
      tls: 4,
    },
  );
});

test('vital updates replace a pending page and a retry cannot overwrite a newer update', () => {
  const buffer = createEventBuffer();
  buffer.enqueue({ id: 'page-1', lcp: null, cls: null });
  buffer.enqueue({ id: 'page-1', lcp: 1200 });
  const inFlight = buffer.take();
  assert.equal(inFlight[0].event.lcp, 1200);
  buffer.enqueue({ id: 'page-1', lcp: 1500, cls: 0.02 });
  buffer.retry(inFlight);
  assert.equal(buffer.size, 1);
  assert.deepEqual(buffer.take()[0].event, { id: 'page-1', lcp: 1500, cls: 0.02 });
});

test('a failed older page snapshot cannot replace the newest revision', () => {
  const buffer = createEventBuffer();
  buffer.enqueue({ id: 'page-1', revision: 1, inp: 600 });
  const older = buffer.take();
  buffer.enqueue({ id: 'page-1', revision: 2, inp: 400 });
  buffer.retry(older);
  assert.deepEqual(buffer.take()[0].event, { id: 'page-1', revision: 2, inp: 400 });
});

test('offline buffering and retries are bounded', () => {
  const buffer = createEventBuffer(2, 1);
  buffer.enqueue({ id: 'old' });
  buffer.enqueue({ id: 'next' });
  buffer.enqueue({ id: 'new' });
  assert.deepEqual(
    buffer.take(1).map((item) => item.event.id),
    ['next'],
  );
  const batch = buffer.take();
  buffer.retry(batch);
  assert.equal(buffer.size, 1);
  buffer.retry(buffer.take());
  assert.equal(buffer.size, 0);
});

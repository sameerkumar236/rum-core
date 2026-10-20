import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import {
  isPublicAddress,
  validatePublicUrl,
  validatePublicTarget,
} from '../services/website-check/security.js';
import { pinnedHttpRequest, scanWebsiteHttp } from '../services/website-check/http.js';
import { createGuardedProxy } from '../services/website-check/proxy.js';
import { safeUrl } from '../services/website-check/result.js';
import { emptyResult, summarize } from '../services/website-check/result.js';
import mongoose from 'mongoose';
import request from 'supertest';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { Event, User, Session, Project } from '../models/index.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function proxyGet(port, url) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { hostname: '127.0.0.1', port, path: url, agent: false },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.once('end', () => resolve({ status: response.statusCode, body }));
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

test('website guard rejects private, special-use, mapped and transition addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
    'not-an-address',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of [
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.15.255.254',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test('website guard handles alternate IPv4 representations, credentials and unsafe ports', () => {
  for (const url of [
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://[::ffff:127.0.0.1]/',
    'http://LOCALHOST./',
    'http://metadata.internal/',
    'https://host.local/',
    'file:///etc/passwd',
    'data:text/html,hi',
    'ftp://public.example.com/',
    'https://user:password@public.example.com/',
    'https://public.example.com:22/',
    'http://public.example.com:8080/',
    'https://public.example.com:27017/',
  ]) {
    assert.throws(() => validatePublicUrl(url), { status: 400 }, url);
  }
  assert.equal(
    validatePublicUrl('https://public.example.com/path?token=private#fragment').href,
    'https://public.example.com/path?token=private',
  );
  assert.equal(
    safeUrl('https://name:secret@public.example.com/path?token=private#fragment'),
    'https://public.example.com/path',
  );
  assert.equal(safeUrl('data:text/html,private-inline-body'), '');
  assert.equal(safeUrl('blob:https://public.example.com/private-inline-id'), '');
});

test('all DNS answers must be public and the vetted addresses are returned for pinning', async () => {
  await assert.rejects(
    validatePublicTarget('https://mixed.example.com/', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    { status: 400 },
  );
  await assert.rejects(
    validatePublicTarget('https://mapped.example.com/', async () => [
      { address: '::ffff:192.168.1.1', family: 6 },
    ]),
    { status: 400 },
  );
  await assert.rejects(
    validatePublicTarget('https://empty.example.com/', async () => []),
    { status: 502 },
  );
  const target = await validatePublicTarget('https://pinned.example.com/path', publicLookup);
  assert.deepEqual(target.addresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('HTTP redirects are checked again, including a hostname that rebinds to a private address', async () => {
  let resolutions = 0;
  let transports = 0;
  await assert.rejects(
    scanWebsiteHttp('https://rebind.example.com/start', {
      lookup: async () => [
        { address: ++resolutions === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 },
      ],
      transport: async (target) => {
        transports++;
        assert.equal(target.addresses[0].address, '93.184.216.34');
        return {
          statusCode: 302,
          headers: { location: '/next' },
          body: '',
          transferredBytes: 0,
        };
      },
    }),
    { status: 400 },
  );
  assert.equal(resolutions, 2);
  assert.equal(transports, 1);
  await assert.rejects(
    scanWebsiteHttp('https://public.example.com/', {
      lookup: publicLookup,
      transport: async () => ({
        statusCode: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
        body: '',
        transferredBytes: 0,
      }),
    }),
    { status: 400 },
  );
});

test('HTTP checks bound redirects, redact query strings, and never claim browser or interaction metrics', async () => {
  let calls = 0;
  const result = await scanWebsiteHttp('https://public.example.com/?token=secret', {
    lookup: publicLookup,
    transport: async () => {
      calls++;
      return {
        statusCode: 302,
        headers: { location: '/next?token=secret' },
        body: '',
        transferredBytes: 12,
      };
    },
  });
  assert.equal(calls, 9);
  assert.equal(result.requests.length, 9);
  assert.equal(result.truncated, true);
  assert.equal(result.mode, 'http');
  assert.equal(result.metrics.lcpMs, null);
  assert.equal(result.metrics.inpMs, null);
  assert.doesNotMatch(JSON.stringify(result), /token=secret/);
});

test('HTTP deadline includes initial DNS lookup', async () => {
  const started = performance.now();
  const result = await scanWebsiteHttp('https://slow.example.com/', {
    timeoutMs: 20,
    lookup: () => new Promise(() => {}),
  });
  assert.equal(result.timedOut, true);
  assert.ok(performance.now() - started < 1000);
  assert.equal(result.network.failedRequests, 1);
});

test('already-cancelled HTTP checks perform no DNS lookup or outbound request', async () => {
  const controller = new AbortController();
  controller.abort();
  let lookups = 0;
  let requests = 0;
  const result = await scanWebsiteHttp('https://cancelled.example.com/', {
    signal: controller.signal,
    lookup: async () => {
      lookups++;
      return publicLookup();
    },
    transport: async () => {
      requests++;
      throw new Error('Must not send a request.');
    },
  });
  assert.equal(lookups, 0);
  assert.equal(requests, 0);
  assert.equal(result.timedOut, true);
});

test('summary preserves observed request counts and clearly marks captured-only totals', () => {
  const result = emptyResult('https://public.example.com/', 'browser', Date.now());
  result.observedRequests = 300;
  result.requests.push({
    url: 'https://public.example.com/api?secret=1',
    failed: true,
    transferBytes: 123,
  });
  const summarized = summarize(result, performance.now());
  assert.equal(summarized.network.totalRequests, 300);
  assert.equal(summarized.network.failedRequests, 1);
  assert.equal(summarized.network.transferredBytes, 123);
  assert.equal(summarized.truncated, true);
  assert.match(summarized.issues.map((issue) => issue.message).join(' '), /captured requests/);
  assert.doesNotMatch(JSON.stringify(summarized), /secret=1/);
});

test('HTTP total and final-response TTFB include time spent following redirects', async () => {
  let count = 0;
  const result = await scanWebsiteHttp('https://public.example.com/start', {
    lookup: publicLookup,
    transport: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      count++;
      return {
        statusCode: count === 1 ? 302 : 200,
        headers: count === 1 ? { location: '/final' } : {},
        body: '<title>Final page</title>',
        transferredBytes: 25,
        timings: { dnsMs: 1, tcpMs: 2, tlsMs: 3, ttfbMs: 10, downloadMs: 15, totalMs: 25 },
      };
    },
  });
  assert.equal(count, 2);
  assert.ok(result.metrics.totalMs >= 45);
  assert.ok(result.metrics.ttfbMs >= 30);
  assert.equal(result.metrics.tcpMs, 2);
  assert.equal(result.metrics.downloadMs, 15);
  assert.equal(result.page.title, 'Final page');
});

test('pinned HTTP transport records real socket timings and caps response memory', async () => {
  let receivedHost;
  const fixture = createServer((incoming, response) => {
    receivedHost = incoming.headers.host;
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<title>Local fixture</title>' + 'x'.repeat(5000));
  });
  const port = await listen(fixture);
  try {
    // A trusted test-only transport target exercises Node sockets without external networking.
    const target = {
      url: new URL(`http://pinned.example.com:${port}/`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
      dnsMs: 3,
    };
    const result = await pinnedHttpRequest(target, {
      signal: new AbortController().signal,
      maxBytes: 128,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.transferredBytes, 128);
    assert.equal(Buffer.byteLength(result.body), 128);
    assert.equal(result.truncated, true);
    assert.equal(receivedHost, `pinned.example.com:${port}`);
    assert.equal(result.timings.dnsMs, 3);
    assert.ok(result.timings.tcpMs >= 0);
    assert.equal(result.timings.tlsMs, null);
    assert.ok(result.timings.ttfbMs >= 3);
    assert.ok(result.timings.totalMs >= result.timings.ttfbMs);
  } finally {
    await close(fixture);
  }
});

test('browser proxy pins public DNS results, preserves Host and blocks private requests', async () => {
  let host;
  const fixture = createServer((incoming, response) => {
    host = incoming.headers.host;
    response.end('public fixture');
  });
  const port = await listen(fixture);
  const connections = [];
  const proxy = await createGuardedProxy({
    lookup: async (hostname) => [
      {
        address: hostname === 'private.example.com' ? '127.0.0.1' : '93.184.216.34',
        family: 4,
      },
    ],
    connectSocket: (target) => {
      connections.push(target);
      return connect({ host: '127.0.0.1', port });
    },
  });
  try {
    assert.equal(
      (await proxyGet(proxy.port, 'http://pinned.example.com/path')).body,
      'public fixture',
    );
    assert.equal(host, 'pinned.example.com');
    assert.deepEqual(connections, [{ address: '93.184.216.34', family: 4, port: 80 }]);
    assert.equal((await proxyGet(proxy.port, 'http://private.example.com/')).status, 403);
    assert.equal((await proxyGet(proxy.port, 'http://pinned.example.com:22/')).status, 403);
    assert.equal(connections.length, 1);
  } finally {
    await proxy.close();
    await close(fixture);
  }
});

test('browser proxy CONNECT validates a destination before any socket is dialed', async () => {
  let dialed = false;
  const proxy = await createGuardedProxy({
    lookup: publicLookup,
    connectSocket: () => {
      dialed = true;
      throw new Error('Must not connect');
    },
  });
  try {
    const status = await new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1',
        port: proxy.port,
        method: 'CONNECT',
        path: '169.254.169.254:443',
        agent: false,
      });
      outgoing.once('connect', (response, socket) => {
        socket.destroy();
        resolve(response.statusCode);
      });
      outgoing.once('error', reject);
      outgoing.end();
    });
    assert.equal(status, 403);
    assert.equal(dialed, false);
  } finally {
    await proxy.close();
  }
});

test('closing the browser proxy aborts pending DNS without reporting a blocked resource', async () => {
  let signalLookupStarted;
  const lookupStarted = new Promise((resolve) => {
    signalLookupStarted = resolve;
  });
  const blocked = [];
  const proxy = await createGuardedProxy({
    lookup: () => {
      signalLookupStarted();
      return new Promise(() => {});
    },
    onBlocked: (url, message) => blocked.push({ url, message }),
  });
  const pending = proxyGet(proxy.port, 'http://pending.example.com/').catch(() => null);
  await lookupStarted;
  await proxy.close();
  await pending;
  assert.deepEqual(blocked, []);
});

test('browser proxy enforces the byte budget on uploads even when no response is downloaded', async () => {
  const blocked = [];
  let responseBytes = 0;
  const fixture = createServer((incoming) => {
    // The fixture deliberately sends no response. Only client upload bytes can hit the limit.
    incoming.resume();
  });
  const port = await listen(fixture);
  const proxy = await createGuardedProxy({
    lookup: publicLookup,
    maxBytes: 512,
    onBlocked: (url, message) => blocked.push(message),
    connectSocket: () => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.on('data', (chunk) => {
        responseBytes += chunk.length;
      });
      return socket;
    },
  });
  try {
    const closedByProxy = await new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1',
        port: proxy.port,
        path: 'http://pinned.example.com/upload',
        method: 'POST',
        headers: { 'Content-Length': '8192' },
        agent: false,
      });
      outgoing.setTimeout(2000, () => {
        outgoing.destroy();
        reject(new Error('The upload was not stopped.'));
      });
      outgoing.once('error', () => resolve(true));
      outgoing.once('response', () => reject(new Error('Unexpected fixture response.')));
      outgoing.end(Buffer.alloc(8192, 'x'));
    });
    assert.equal(closedByProxy, true);
    assert.equal(responseBytes, 0);
    assert.ok(blocked.some((message) => /transfer limit/.test(message)));
  } finally {
    await proxy.close();
    await close(fixture);
  }
});

test('website check route requires login, limits concurrency and quotas, and does not persist scans', async () => {
  const database = await MongoMemoryServer.create({
    binary: { downloadDir: path.resolve('.cache/mongodb-binaries') },
  });
  let releaseScans;
  let started = 0;
  const gate = new Promise((resolve) => {
    releaseScans = resolve;
  });
  try {
    await mongoose.connect(database.getUri());
    await Promise.all([User.init(), Session.init(), Project.init(), Event.init()]);
    const app = createApp({
      websiteCheck: {
        scanHttp: async (url) => {
          if (url.endsWith('/hold')) {
            started++;
            await gate;
          }
          return emptyResult(url, 'http', Date.now());
        },
      },
    });
    await request(app)
      .post('/api/website-check')
      .send({ url: 'https://public.example.com/' })
      .expect(401);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const agent = request.agent(app);
      await agent
        .post('/api/auth/register')
        .send({ name: `Tester ${i}`, email: `scan${i}@example.com`, password: 'GoodPass123!' })
        .expect(201);
      users.push(agent);
    }
    const first = users[0]
      .post('/api/website-check')
      .send({ url: 'https://public.example.com/hold' })
      .then((response) => response);
    while (started < 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await users[0]
      .post('/api/website-check')
      .send({ url: 'https://public.example.com/' })
      .expect(429);
    const second = users[1]
      .post('/api/website-check')
      .send({ url: 'https://public.example.com/hold' })
      .then((response) => response);
    while (started < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    await users[2]
      .post('/api/website-check')
      .send({ url: 'https://public.example.com/' })
      .expect(429);
    releaseScans();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    for (let i = 0; i < 10; i++) {
      await users[3]
        .post('/api/website-check')
        .send({ url: 'https://public.example.com/', mode: 'http' })
        .expect(200);
    }
    await users[3]
      .post('/api/website-check')
      .send({ url: 'https://public.example.com/' })
      .expect(429);
    await users[0]
      .post('/api/website-check')
      .set('Origin', 'https://attacker.example')
      .send({ url: 'https://public.example.com/' })
      .expect(403);
    await users[0].post('/api/website-check').send({ url: 'http://127.0.0.1/' }).expect(400);
    assert.equal(await Event.countDocuments(), 0);
    assert.equal(await Project.countDocuments(), 0);
  } finally {
    releaseScans();
    await mongoose.disconnect();
    await database.stop();
  }
});

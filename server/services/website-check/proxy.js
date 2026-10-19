import { Agent, createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { AppError } from '../../lib/errors.js';
import { validatePublicTarget } from './security.js';

// All browser TCP destinations pass through this loopback proxy. It dials vetted IPs,
// rather than resolving the hostname again after the public-address check.
export async function createGuardedProxy(options = {}) {
  const sockets = new Set();
  const controller = new AbortController();
  let closed = false;
  let transferred = 0;
  let connections = 0;
  let requests = 0;
  const maxBytes = options.maxBytes || 32 * 1024 * 1024;
  const maxConnections = options.maxConnections || 350;
  const maxRequests = options.maxRequests || 300;
  const report = (url, message) => {
    // Closing the scan aborts pending resolutions. That cleanup is not a blocked resource.
    if (!closed) options.onBlocked?.(url, message);
  };

  function stopSockets() {
    for (const socket of sockets) socket.destroy();
  }

  function track(socket) {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(25000, () => socket.destroy());
    // Client data is upload traffic; upstream data is download traffic. Count each once.
    socket.on('data', (chunk) => {
      transferred += chunk.length;
      if (transferred > maxBytes) {
        report('', 'The page scan reached its transfer limit.');
        closed = true;
        controller.abort();
        stopSockets();
      }
    });
  }

  function permitRequest() {
    if (closed || ++requests > maxRequests) {
      report('', 'The page scan reached its request limit.');
      throw new AppError(429, 'The page scan reached its request limit.');
    }
  }

  function dial(target) {
    const socket = options.connectSocket
      ? options.connectSocket(target)
      : connect({ host: target.address, family: target.family, port: target.port });
    track(socket);
    return socket;
  }

  const server = createServer(async (incoming, outgoing) => {
    try {
      permitRequest();
      const target = await validatePublicTarget(incoming.url || '', options.lookup, {
        signal: controller.signal,
      });
      if (target.url.protocol !== 'http:')
        throw new AppError(400, 'HTTPS must use a CONNECT tunnel.');
      if (closed || incoming.destroyed) return;
      const address =
        target.addresses.find((item) => item.family === 4) || target.addresses[0];
      const headers = { ...incoming.headers, host: target.url.host, connection: 'close' };
      for (const name of [
        'proxy-authorization',
        'proxy-connection',
        'upgrade',
        'keep-alive',
        'te',
        'trailer',
      ])
        delete headers[name];
      const agent = new Agent({ keepAlive: false });
      agent.createConnection = () =>
        dial({
          address: address.address,
          family: address.family,
          port: Number(target.url.port || 80),
        });
      const upstream = httpRequest(
        {
          hostname: address.address,
          family: address.family,
          port: Number(target.url.port || 80),
          path: target.url.pathname + target.url.search,
          method: incoming.method,
          headers,
          agent,
          signal: controller.signal,
          timeout: 20000,
        },
        (response) => {
          if (outgoing.destroyed) {
            response.destroy();
            return;
          }
          const responseHeaders = { ...response.headers, connection: 'close' };
          delete responseHeaders['proxy-authenticate'];
          outgoing.writeHead(response.statusCode || 502, responseHeaders);
          response.pipe(outgoing);
        },
      );
      upstream.once('timeout', () => upstream.destroy(new Error('Upstream timeout')));
      upstream.once('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.once('aborted', () => upstream.destroy());
      outgoing.once('close', () => {
        upstream.destroy();
        agent.destroy();
      });
      incoming.pipe(upstream);
    } catch (error) {
      if (error instanceof AppError) report(incoming.url || '', error.message);
      if (!outgoing.headersSent)
        outgoing.writeHead(error instanceof AppError ? 403 : 502, {
          'Content-Type': 'text/plain',
          Connection: 'close',
        });
      outgoing.end('The scan proxy blocked or could not reach this destination.');
    }
  });

  server.on('connection', (socket) => {
    if (closed || ++connections > maxConnections) {
      report('', 'The page scan reached its connection limit.');
      socket.destroy();
      return;
    }
    track(socket);
  });

  server.on('connect', async (incoming, client, head) => {
    try {
      permitRequest();
      const authority = incoming.url || '';
      if (!authority || /[\/\\?#@\s]/.test(authority))
        throw new AppError(400, 'Invalid CONNECT destination.');
      const target = await validatePublicTarget(`https://${authority}/`, options.lookup, {
        signal: controller.signal,
      });
      if (closed || client.destroyed) return;
      const address =
        target.addresses.find((item) => item.family === 4) || target.addresses[0];
      const upstream = dial({
        address: address.address,
        family: address.family,
        port: Number(target.url.port || 443),
      });
      upstream.once('connect', () => {
        if (closed || client.destroyed) {
          upstream.destroy();
          return;
        }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.once('error', () => client.destroy());
      client.once('error', () => upstream.destroy());
      client.once('close', () => upstream.destroy());
    } catch (error) {
      if (error instanceof AppError) report(incoming.url || '', error.message);
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  });

  server.on('upgrade', (request, socket) => socket.destroy());
  server.on('clientError', (error, socket) => socket.destroy());
  server.maxConnections = maxConnections;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    port: server.address().port,
    close: async () => {
      closed = true;
      controller.abort();
      stopSockets();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

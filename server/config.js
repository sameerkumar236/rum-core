import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '127.0.0.1',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rum_core',
  mongoDnsServers: (process.env.MONGODB_DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  production: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',
  trustCloudflare: process.env.TRUST_CLOUDFLARE === 'true',
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('PORT must be a number between 1 and 65535.');
}
if (!['http:', 'https:'].includes(new URL(config.clientOrigin).protocol)) {
  throw new Error('CLIENT_ORIGIN must be an HTTP or HTTPS origin.');
}

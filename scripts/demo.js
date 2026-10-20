import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const root = fileURLToPath(new URL('../', import.meta.url));
const cacheDirectory = fileURLToPath(new URL('../.cache/mongodb-binaries', import.meta.url));
const databaseDirectory = fileURLToPath(new URL('../.local/demo-mongodb', import.meta.url));
const port = process.env.DEMO_PORT || '4000';
const ephemeral = process.env.DEMO_EPHEMERAL === '1';

// This is a real local MongoDB process, reserved for the explicitly selected demo.
// Normal `npm run dev` and `npm start` always use your MONGODB_URI instead.
await mkdir(cacheDirectory, { recursive: true });
await mkdir(databaseDirectory, { recursive: true });
console.log('Starting local demo MongoDB. The first run downloads MongoDB binaries.');

let database;
let server;
let seed;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of [server, seed]) {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
  await database?.stop();
}

process.once('SIGINT', () => stop().then(() => process.exit(0)));
process.once('SIGTERM', () => stop().then(() => process.exit(0)));

try {
  database = await MongoMemoryServer.create({
    binary: { downloadDir: cacheDirectory },
    instance: {
      ip: '127.0.0.1',
      dbName: 'rum_core_demo',
      storageEngine: 'wiredTiger',
      ...(ephemeral ? {} : { dbPath: databaseDirectory }),
    },
  });

  const environment = {
    ...process.env,
    MONGODB_URI: database.getUri(),
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: port,
    CLIENT_ORIGIN: `http://127.0.0.1:${port}`,
    TRUST_PROXY: 'false',
    TRUST_CLOUDFLARE: 'false',
  };

  seed = spawn(process.execPath, ['server/seed.js'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  const seedCode = await new Promise((resolve, reject) => {
    seed.once('error', reject);
    seed.once('exit', resolve);
  });
  if (seedCode !== 0) throw new Error('Demo seed failed. See the error above.');

  server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  console.log(`\nDemo: http://127.0.0.1:${port}`);
  console.log('Sign in: demo@rumcore.dev / DemoPass123!\n');
  const exitCode = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', resolve);
  });
  if (!stopping) {
    await stop();
    process.exitCode = exitCode || 0;
  }
} catch (error) {
  console.error(error.message);
  await stop();
  process.exitCode = 1;
}

import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { connectDatabase } from './db.js';
import { User, Session, Project, Event } from './models/index.js';
import { hashPassword } from './lib/password.js';
import { newProjectKey } from './routes/projects.js';

// Seed is explicit and additive. It never deletes accounts, projects, or live telemetry.
export async function seedDemo() {
  await Promise.all([User.init(), Session.init(), Project.init(), Event.init()]);
  const user = await User.findOneAndUpdate(
    { email: 'demo@rumcore.dev' },
    {
      $setOnInsert: {
        name: 'Alex Morgan',
        email: 'demo@rumcore.dev',
        passwordHash: await hashPassword('DemoPass123!'),
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  const definitions = [
    { name: 'Acme Store · Demo', origin: 'https://demo.acme.store', count: 3200 },
    { name: 'Acme Docs · Demo', origin: 'https://docs.demo.acme.store', count: 550 },
  ];
  let state = 42;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const choose = (items) => items[Math.floor(random() * items.length)];
  const regions = [
    ['US', 'California', 'San Francisco'],
    ['US', 'New York', 'New York'],
    ['IN', 'Maharashtra', 'Mumbai'],
    ['GB', 'England', 'London'],
    ['DE', 'Berlin', 'Berlin'],
    ['JP', 'Tokyo', 'Tokyo'],
    ['CA', 'Ontario', 'Toronto'],
  ];
  const now = Date.now();
  for (const definition of definitions) {
    const project = await Project.findOneAndUpdate(
      { owner: user._id, origin: definition.origin },
      {
        $setOnInsert: {
          owner: user._id,
          name: definition.name,
          origin: definition.origin,
          key: newProjectKey(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const operations = [];
    for (let i = 0; i < definition.count; i++) {
      const type = i % 4 === 0 ? 'page' : 'request';
      const pageUrl = `${definition.origin}${choose(['/', '/products', '/products/:id', '/checkout', '/cart', '/account', '/collections/summer'])}`;
      const [country, region, city] = choose(regions);
      const mobile = random() < 0.46;
      const base = mobile ? 1700 : 950;
      const event = {
        project: project._id,
        eventId: `demo_${i}`,
        type,
        sessionId: `demo_session_${Math.floor(i / 8)}`,
        pageUrl,
        country,
        region,
        city,
        demo: true,
        device: mobile ? 'Mobile' : choose(['Desktop', 'Desktop', 'Tablet']),
        browser: choose(['Chrome', 'Chrome', 'Chrome', 'Safari', 'Firefox', 'Edge']),
        os: mobile ? choose(['iOS', 'Android']) : choose(['Windows', 'macOS', 'Linux']),
        connection: choose(['4g', '4g', '4g', '3g', 'Unknown']),
        timestamp: new Date(now - Math.floor(random() * 7 * 86400000)),
      };
      if (type === 'page')
        Object.assign(event, {
          lcp: Math.round(base + random() * 1800),
          fcp: Math.round(base * 0.6 + random() * 900),
          cls: Math.round(random() * 160) / 1000,
          inp: Math.round(60 + random() * 230),
        });
      else {
        const endpoint = choose([
          '/api/products',
          '/api/products/:id',
          '/api/cart',
          '/api/checkout',
          '/api/search',
          '/api/recommendations',
          '/api/user',
        ]);
        const failing = random() < (endpoint === '/api/checkout' ? 0.12 : 0.018);
        const duration = Math.round(
          65 + random() * (endpoint === '/api/checkout' ? 1100 : 420),
        );
        Object.assign(event, {
          url: `${definition.origin}${endpoint}`,
          method: ['/api/cart', '/api/checkout'].includes(endpoint) ? 'POST' : 'GET',
          status: failing ? choose([400, 500, 503]) : 200,
          duration,
          ttfb: Math.round(duration * 0.68),
          dns: Math.round(random() * 12),
          tcp: Math.round(random() * 25),
          tls: Math.round(random() * 35),
        });
      }
      operations.push({
        updateOne: {
          filter: { project: project._id, type, eventId: event.eventId },
          update: { $setOnInsert: event },
          upsert: true,
        },
      });
      // Refresh sample dates on an explicit seed, while leaving live telemetry untouched.
      operations.push({
        updateOne: {
          filter: { project: project._id, type, eventId: event.eventId, demo: true },
          update: { $set: { timestamp: event.timestamp } },
        },
      });
    }
    const result = await Event.bulkWrite(operations);
    console.log(
      `${definition.name}: added ${result.upsertedCount} generated demo events; sample dates refreshed.`,
    );
  }
  console.log('Demo account: demo@rumcore.dev / DemoPass123!');
  console.log('These projects contain generated example telemetry, not real visitor data.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await connectDatabase(config.mongoUri);
    await seedDemo();
  } catch (error) {
    console.error(`Demo seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

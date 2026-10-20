import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDatabase } from './db.js';
import { User, Session, Project, Event } from './models/index.js';
import { createApp } from './app.js';

let server;
try {
  await connectDatabase(config.mongoUri);
  await Promise.all([User.init(), Session.init(), Project.init(), Event.init()]);
  server = createApp().listen(config.port, config.host, () => {
    console.log(`rum-core is running at http://${config.host}:${config.port}`);
  });
  server.on('error', async (error) => {
    console.error(`Could not start the HTTP server: ${error.message}`);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
} catch (error) {
  console.error(`Could not start rum-core: ${error.message}`);
  console.error(
    'Check MONGODB_URI and make sure MongoDB is running. No fallback database is used.',
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}

async function shutdown() {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

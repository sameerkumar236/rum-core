import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { config as defaults } from './config.js';
import { AppError, errorHandler } from './lib/errors.js';
import { dashboardOrigin } from './middleware/origin.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { ingestRoutes } from './routes/ingest.js';
import { usageRoutes } from './routes/usage.js';
import { websiteCheckRoutes } from './routes/website-check.js';

const directory = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const config = { ...defaults, ...options };
  const app = express();
  app.set("trust proxy", 1);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(express.json({ limit: '256kb', type: ['application/json', 'text/plain'] }));
  app.use((request, response, next) => {
    request.body ??= {};
    if (typeof request.body !== 'object' || Array.isArray(request.body)) {
      return next(new AppError(400, 'Send a JSON object as the request body.'));
    }
    next();
  });
  app.use(cookieParser());
  app.get('/api/health', (request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected',
    });
  });
  app.get('/tracker.js', (request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    response.sendFile(path.join(directory, 'public/tracker.js'));
  });
  app.use('/api/ingest', ingestRoutes(config));
  app.use('/api', dashboardOrigin(config));
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 2000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { message: 'Too many requests. Please try again shortly.' },
    }),
  );
  app.use('/api/auth', authRoutes(config));
  app.use('/api/projects', projectRoutes());
  app.use('/api/usage', usageRoutes());
  app.use('/api/website-check', websiteCheckRoutes(options.websiteCheck));
  app.use('/api', (request, response) =>
    response.status(404).json({ message: 'API route not found.' }),
  );

  const clientDirectory = options.clientDirectory || path.resolve(directory, '../client/dist');
  if (existsSync(path.join(clientDirectory, 'index.html'))) {
    app.use(express.static(clientDirectory));
    app.get('/{*path}', (request, response) =>
      response.sendFile(path.join(clientDirectory, 'index.html')),
    );
  }
  app.use((request, response) => response.status(404).json({ message: 'Route not found.' }));
  app.use(errorHandler);
  return app;
}

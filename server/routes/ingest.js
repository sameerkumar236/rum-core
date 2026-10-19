import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Project } from '../models/index.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { ingestEvents } from '../services/ingestion.js';

function allowOrigin(response, origin) {
  response.set('Access-Control-Allow-Origin', origin);
  response.set('Vary', 'Origin');
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  response.set('Access-Control-Max-Age', '600');
}

export function ingestRoutes(config) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { message: 'Collector rate limit reached. Try again shortly.' },
    }),
  );
  router.options(
    ['/', '/config'],
    asyncRoute(async (request, response) => {
      const origin = request.get('origin');
      if (!origin || !(await Project.exists({ origin })))
        throw new AppError(403, 'This website origin is not registered.');
      allowOrigin(response, origin);
      response.sendStatus(204);
    }),
  );
  router.get(
    '/config',
    asyncRoute(async (request, response) => {
      if (typeof request.query.key !== 'string' || request.query.key.length > 100)
        throw new AppError(400, 'A project key is required.');
      const project = await Project.findOne({ key: request.query.key });
      if (!project) throw new AppError(404, 'Project key not found.');
      const origin = request.get('origin');
      if (origin && origin !== project.origin)
        throw new AppError(403, 'This website origin does not match the project.');
      if (origin) allowOrigin(response, origin);
      response.set('Cache-Control', 'no-store');
      response.json({
        collectVitals: project.collectVitals,
        urlFilterMode: project.urlFilterMode,
        urlPatterns: project.urlPatterns,
      });
    }),
  );
  router.post(
    '/',
    asyncRoute(async (request, response) => {
      if (typeof request.body.key !== 'string' || request.body.key.length > 100)
        throw new AppError(400, 'A project key is required.');
      const project = await Project.findOne({ key: request.body.key });
      if (!project) throw new AppError(404, 'Project key not found.');
      const origin = request.get('origin');
      if (!origin || origin !== project.origin)
        throw new AppError(403, 'This website origin does not match the project.');
      allowOrigin(response, origin);
      const result = await ingestEvents(project, request.body.events, request, config);
      response.status(202).json(result);
    }),
  );
  return router;
}

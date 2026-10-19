import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { Event, Project, publicProject } from '../models/index.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { projectInput } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { getAnalytics } from '../services/analytics.js';
import { exportEvents } from '../services/export.js';

export const newProjectKey = () => `rum_${randomBytes(24).toString('hex')}`;

export function projectRoutes() {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/',
    asyncRoute(async (request, response) => {
      const projects = await Project.find({ owner: request.user._id }).sort({ createdAt: 1 });
      response.json({ projects: projects.map(publicProject) });
    }),
  );
  router.post(
    '/',
    asyncRoute(async (request, response) => {
      const input = projectInput(request.body);
      const project = await Project.create({
        ...input,
        owner: request.user._id,
        key: newProjectKey(),
      });
      response.status(201).json({ project: publicProject(project) });
    }),
  );
  router.use(
    '/:id',
    asyncRoute(async (request, response, next) => {
      if (!mongoose.isObjectIdOrHexString(request.params.id))
        throw new AppError(404, 'Project not found.');
      const project = await Project.findOne({
        _id: request.params.id,
        owner: request.user._id,
      });
      if (!project) throw new AppError(404, 'Project not found.');
      request.project = project;
      next();
    }),
  );
  router.get('/:id', (request, response) =>
    response.json({ project: publicProject(request.project) }),
  );
  router.patch(
    '/:id',
    asyncRoute(async (request, response) => {
      Object.assign(request.project, projectInput(request.body, true));
      await request.project.save();
      response.json({ project: publicProject(request.project) });
    }),
  );
  router.delete(
    '/:id',
    asyncRoute(async (request, response) => {
      await Event.deleteMany({ project: request.project._id });
      await request.project.deleteOne();
      response.json({ message: 'Project and its telemetry deleted.' });
    }),
  );
  router.post(
    '/:id/rotate-key',
    asyncRoute(async (request, response) => {
      request.project.key = newProjectKey();
      await request.project.save();
      response.json({ project: publicProject(request.project) });
    }),
  );
  router.get(
    '/:id/analytics',
    asyncRoute(async (request, response) => {
      response.json(await getAnalytics(request.project._id, request.query));
    }),
  );
  router.get(
    '/:id/export',
    asyncRoute(async (request, response) => {
      await exportEvents(request.project, request.query, response);
    }),
  );
  return router;
}

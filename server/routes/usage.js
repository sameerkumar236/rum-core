import { Router } from 'express';
import { Event, Project } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../lib/errors.js';

export function usageRoutes() {
  const router = Router();
  router.get(
    '/',
    requireAuth,
    asyncRoute(async (request, response) => {
      const projects = await Project.find({ owner: request.user._id }).select('_id').lean();
      const [usage] = await Event.aggregate([
        {
          $match: {
            project: { $in: projects.map((project) => project._id) },
            timestamp: { $gte: new Date(Date.now() - 30 * 86400000) },
          },
        },
        {
          $group: {
            _id: null,
            totalEvents: { $sum: 1 },
            requests: { $sum: { $cond: [{ $eq: ['$type', 'request'] }, 1, 0] } },
            pageViews: { $sum: { $cond: [{ $eq: ['$type', 'page'] }, 1, 0] } },
          },
        },
      ]);
      response.json({
        projects: projects.length,
        totalEvents: usage?.totalEvents || 0,
        requests: usage?.requests || 0,
        pageViews: usage?.pageViews || 0,
        retentionDays: 30,
      });
    }),
  );
  return router;
}

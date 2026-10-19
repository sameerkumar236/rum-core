import { Router } from 'express';
import { AppError, asyncRoute } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { scanWebsiteHttp } from '../services/website-check/http.js';
import { validatePublicUrl } from '../services/website-check/security.js';

let activeChecks = 0;
const activeUsers = new Set();
const attempts = new Map();
const windowMs = 15 * 60000;

// Limits are per process. A multi-instance deployment needs a shared rate-limit store.
function reserve(userId) {
  const now = Date.now();
  for (const [id, entries] of attempts) {
    const recent = entries.filter((time) => time > now - windowMs);
    if (recent.length) attempts.set(id, recent);
    else attempts.delete(id);
  }
  const recent = attempts.get(userId) || [];
  if (recent.length >= 10)
    throw new AppError(429, 'You can run 10 website checks every 15 minutes.');
  if (activeChecks >= 2 || activeUsers.has(userId))
    throw new AppError(429, 'A website check is already running. Try again shortly.');
  recent.push(now);
  attempts.set(userId, recent);
  activeChecks++;
  activeUsers.add(userId);
  return () => {
    activeChecks--;
    activeUsers.delete(userId);
  };
}

export function websiteCheckRoutes(options = {}) {
  const router = Router();
  router.post(
    '/',
    requireAuth,
    asyncRoute(async (request, response) => {
      const { url, mode = 'http' } = request.body;
      validatePublicUrl(url);
      if (!['http', 'browser'].includes(mode))
        throw new AppError(400, 'Choose HTTP or browser mode.');
      const release = reserve(String(request.user._id));
      const controller = new AbortController();
      const abort = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.once('close', abort);
      response.set('Cache-Control', 'no-store');
      try {
        const scanner =
          mode === 'http'
            ? options.scanHttp || scanWebsiteHttp
            : options.scanBrowser ||
              (await import('../services/website-check/browser.js')).scanWebsiteBrowser;
        const result = await scanner(url, { signal: controller.signal });
        if (!response.destroyed) response.json(result);
      } finally {
        release();
        response.off('close', abort);
      }
    }),
  );
  return router;
}

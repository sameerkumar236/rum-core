import { AppError } from '../lib/errors.js';

export function dashboardOrigin(config) {
  const clientOrigin = new URL(config.clientOrigin).origin;
  return (request, response, next) => {
    const origin = request.get('origin');
    const ownOrigin = `${request.protocol}://${request.get('host')}`;
    const allowed = origin === clientOrigin || origin === ownOrigin;
    if (origin && allowed) {
      response.set('Access-Control-Allow-Origin', origin);
      response.set('Access-Control-Allow-Credentials', 'true');
      response.set('Vary', 'Origin');
      response.set('Access-Control-Allow-Headers', 'Content-Type');
      response.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      return allowed
        ? response.sendStatus(204)
        : next(new AppError(403, 'This origin cannot access the dashboard.'));
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        (origin && !allowed) ||
        (!origin && request.get('sec-fetch-site') === 'cross-site')
      ) {
        return next(new AppError(403, 'This origin cannot modify the dashboard.'));
      }
      // Non-browser clients may omit Origin. Browsers must identify their origin.
      if (!origin && request.get('sec-fetch-site')) {
        return next(new AppError(403, 'An Origin header is required.'));
      }
    }
    next();
  };
}

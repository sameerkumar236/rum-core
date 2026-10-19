import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { User, publicUser } from '../models/index.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import * as validate from '../lib/validation.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { requireAuth, startSession, endSession } from '../middleware/auth.js';

export function authRoutes(config) {
  const router = Router();
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  router.post(
    '/register',
    limit,
    asyncRoute(async (request, response) => {
      const name = validate.text(request.body.name, 'Name');
      const email = validate.email(request.body.email);
      const password = validate.password(request.body.password);
      const user = await User.create({
        name,
        email,
        passwordHash: await hashPassword(password),
      });
      await endSession(request, response, config);
      await startSession(user._id, response, config);
      response.status(201).json({ user: publicUser(user) });
    }),
  );

  router.post(
    '/login',
    limit,
    asyncRoute(async (request, response) => {
      const email = validate.email(request.body.email);
      const password = validate.password(request.body.password);
      const user = await User.findOne({ email }).select('+passwordHash');
      // Perform scrypt for unknown accounts too, so response time does not reveal registered emails.
      const storedHash = user?.passwordHash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
      const valid = await verifyPassword(password, storedHash);
      if (!user || !valid) throw new AppError(401, 'Email or password is incorrect.');
      await endSession(request, response, config);
      await startSession(user._id, response, config);
      response.json({ user: publicUser(user) });
    }),
  );

  router.get('/me', requireAuth, (request, response) =>
    response.json({ user: publicUser(request.user) }),
  );
  router.post(
    '/logout',
    asyncRoute(async (request, response) => {
      await endSession(request, response, config);
      response.json({ message: 'Signed out.' });
    }),
  );
  return router;
}

import { createHash, randomBytes } from 'node:crypto';
import { Session, User } from '../models/index.js';
import { AppError, asyncRoute } from '../lib/errors.js';

const COOKIE = 'rum_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
    maxAge: lifetime,
  };
}

export async function startSession(userId, response, config) {
  const token = randomBytes(32).toString('base64url');
  await Session.create({
    user: userId,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + lifetime),
  });
  response.cookie(COOKIE, token, cookieOptions(config));
}

export async function endSession(request, response, config) {
  const token = request.cookies?.[COOKIE];
  if (typeof token === 'string') await Session.deleteOne({ tokenHash: tokenHash(token) });
  const { maxAge, ...options } = cookieOptions(config);
  response.clearCookie(COOKIE, options);
}

export const requireAuth = asyncRoute(async (request, response, next) => {
  const token = request.cookies?.[COOKIE];
  if (typeof token !== 'string' || token.length > 100)
    throw new AppError(401, 'Sign in to continue.');
  const session = await Session.findOne({
    tokenHash: tokenHash(token),
    expiresAt: { $gt: new Date() },
  });
  const user = session ? await User.findById(session.user) : null;
  if (!user) throw new AppError(401, 'Sign in to continue.');
  request.user = user;
  next();
});

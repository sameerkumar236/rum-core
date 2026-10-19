import { AppError } from './errors.js';

export function text(value, name, maximum = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new AppError(400, `${name} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

export function email(value) {
  const result = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new AppError(400, 'Enter a valid email address.');
  }
  return result;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new AppError(400, 'Password must contain 8 to 128 characters.');
  }
  return value;
}

export function origin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return url.origin;
  } catch {
    throw new AppError(400, 'Website origin must be a valid HTTP or HTTPS URL.');
  }
}

export function projectInput(body, partial = false) {
  const result = {};
  if (!partial || body.name !== undefined) result.name = text(body.name, 'Project name');
  if (!partial || body.origin !== undefined) result.origin = origin(body.origin);
  if (body.collectVitals !== undefined) {
    if (typeof body.collectVitals !== 'boolean')
      throw new AppError(400, 'collectVitals must be true or false.');
    result.collectVitals = body.collectVitals;
  }
  if (body.urlFilterMode !== undefined) {
    if (!['all', 'include', 'exclude'].includes(body.urlFilterMode))
      throw new AppError(400, 'Choose a valid URL filter mode.');
    result.urlFilterMode = body.urlFilterMode;
  }
  if (body.urlPatterns !== undefined) {
    if (!Array.isArray(body.urlPatterns) || body.urlPatterns.length > 30)
      throw new AppError(400, 'Use at most 30 URL patterns.');
    result.urlPatterns = [
      ...new Set(body.urlPatterns.map((value) => text(value, 'URL pattern', 200))),
    ];
  }
  return result;
}

export const ranges = {
  '12h': 12 * 3600000,
  '24h': 24 * 3600000,
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
};

export function timeRange(value = '24h') {
  if (typeof value !== 'string' || !Object.hasOwn(ranges, value))
    throw new AppError(400, 'Choose 12h, 24h, 7d, or 30d.');
  return value;
}

import { randomUUID } from 'node:crypto';
import { Event } from '../models/index.js';
import { AppError } from '../lib/errors.js';

const numericFields = ['duration', 'ttfb', 'dns', 'tcp', 'tls', 'lcp', 'fcp', 'cls', 'inp'];
const textFields = ['browser', 'os', 'device', 'connection'];
const maxMetric = 24 * 60 * 60 * 1000;

function shortText(value, name, maximum = 100, fallback = 'Unknown') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > maximum)
    throw new AppError(400, `Invalid ${name}.`);
  return value.trim() || fallback;
}

export function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 4096)
    throw new AppError(400, 'Event URLs must be valid HTTP or HTTPS URLs.');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname
      .split('/')
      .map((part) => {
        const decoded = decodeURIComponent(part);
        const isNumber = /^\d+$/.test(decoded);
        const isUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          decoded,
        );
        return isNumber || isUuid ? ':id' : part;
      })
      .join('/');
    return url.toString().slice(0, 2048);
  } catch {
    throw new AppError(400, 'Event URLs must be valid HTTP or HTTPS URLs.');
  }
}

function trustedGeography(request, config) {
  // Enable this only behind a Cloudflare-only origin that blocks direct traffic.
  if (!config.trustCloudflare)
    return { country: 'Unknown', region: 'Unknown', city: 'Unknown' };
  return {
    country: shortText(request.get('cf-ipcountry'), 'country'),
    region: shortText(request.get('cf-region'), 'region'),
    city: shortText(request.get('cf-ipcity'), 'city'),
  };
}

function validateEvent(input, project, geography, now) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !['page', 'request'].includes(input.type)
  ) {
    throw new AppError(400, 'Every event must have type page or request.');
  }
  const pageUrl = cleanUrl(input.pageUrl);
  if (new URL(pageUrl).origin !== project.origin)
    throw new AppError(400, 'Page URL must belong to this project origin.');
  const eventId = shortText(input.id, 'event id', 150, '');
  if (input.type === 'page' && !eventId)
    throw new AppError(400, 'Page events need a stable id.');
  const sessionId = shortText(input.sessionId, 'session id', 150, '');
  if (!sessionId) throw new AppError(400, 'Every event needs a sessionId.');
  if (
    input.timestamp !== undefined &&
    !['number', 'string'].includes(typeof input.timestamp)
  ) {
    throw new AppError(400, 'Event timestamp must be a number or ISO date string.');
  }
  const timestamp = input.timestamp === undefined ? now : new Date(input.timestamp);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.getTime() < now.getTime() - 30 * 86400000 ||
    timestamp.getTime() > now.getTime() + 5 * 60000
  ) {
    throw new AppError(400, 'Event timestamps must be within the last 30 days.');
  }
  const event = {
    project: project._id,
    type: input.type,
    eventId: eventId || randomUUID(),
    sessionId,
    pageUrl,
    timestamp,
    ...geography,
  };
  if (input.revision !== undefined) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
      throw new AppError(400, 'Page revision must be a non-negative safe integer.');
    }
    event.revision = input.revision;
  }
  for (const field of textFields) event[field] = shortText(input[field], field);
  for (const field of numericFields) {
    const value = input[field];
    if (value === undefined || value === null) event[field] = null;
    else if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > (field === 'cls' ? 1000 : maxMetric)
    ) {
      throw new AppError(400, `${field} must be a non-negative number or null.`);
    } else event[field] = value;
  }
  if (event.type === 'request') {
    event.url = cleanUrl(input.url);
    event.method = shortText(input.method, 'method', 15, 'GET').toUpperCase();
    if (!/^[A-Z]+$/.test(event.method)) throw new AppError(400, 'Invalid request method.');
    if (
      !Number.isInteger(input.status) ||
      (input.status !== 0 && (input.status < 100 || input.status > 599))
    )
      throw new AppError(400, 'Request status must be 0 or an HTTP status code.');
    event.status = input.status;
  }
  return event;
}

export async function ingestEvents(project, inputs, request, config) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100)
    throw new AppError(400, 'Send between 1 and 100 events per batch.');
  const now = new Date();
  const geography = trustedGeography(request, config);
  // Validate the entire batch before writing any event.
  const valid = inputs.map((input) => validateEvent(input, project, geography, now));
  const events = valid.filter((event) => {
    if (event.type === 'page') return true;
    const matches = project.urlPatterns.some((pattern) => event.url.includes(pattern));
    return (
      project.urlFilterMode === 'all' ||
      (project.urlFilterMode === 'include' ? matches : !matches)
    );
  });
  if (!events.length) return { accepted: 0, inserted: 0 };
  const operations = events.flatMap((event) => {
    const filter = { project: project._id, type: event.type, eventId: event.eventId };
    if (event.type === 'request')
      return { updateOne: { filter, update: { $setOnInsert: event }, upsert: true } };
    const measurements = {};
    if (project.collectVitals) {
      for (const field of ['lcp', 'fcp', 'cls', 'inp']) {
        if (event[field] !== null) measurements[field] = event[field];
      }
    }
    const initial = { ...event };
    if (!project.collectVitals)
      for (const field of ['lcp', 'fcp', 'cls', 'inp']) initial[field] = null;
    if (event.revision !== undefined) {
      // Insert once, then update only newer revisions. An old beacon cannot undo a newer fetch.
      return [
        { updateOne: { filter, update: { $setOnInsert: initial }, upsert: true } },
        {
          updateOne: {
            filter: { ...filter, revision: { $lt: event.revision } },
            update: { $set: { ...measurements, revision: event.revision } },
          },
        },
      ];
    }
    for (const field of Object.keys(measurements)) delete initial[field];
    return {
      updateOne: {
        filter,
        update: {
          $setOnInsert: initial,
          ...(Object.keys(measurements).length ? { $set: measurements } : {}),
        },
        upsert: true,
      },
    };
  });
  const result = await Event.bulkWrite(operations, { ordered: true });
  return { accepted: events.length, inserted: result.upsertedCount };
}

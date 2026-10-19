import { Event } from '../models/index.js';
import { AppError } from '../lib/errors.js';
import { ranges, timeRange } from '../lib/validation.js';

const isPage = { $eq: ['$type', 'page'] };
const isRequest = { $eq: ['$type', 'request'] };
const isError = {
  $and: [isRequest, { $or: [{ $eq: ['$status', 0] }, { $gte: ['$status', 400] }] }],
};
const sumIf = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });
const averageIf = (condition, field) => ({ $avg: { $cond: [condition, `$${field}`, null] } });
const pageMetrics = {
  lcp: { $avg: '$lcp' },
  fcp: { $avg: '$fcp' },
  cls: { $avg: '$cls' },
  inp: { $avg: '$inp' },
};

export function analyticsMatch(projectId, query, now = new Date()) {
  const range = timeRange(query.range);
  const match = {
    project: projectId,
    timestamp: { $gte: new Date(now.getTime() - ranges[range]), $lte: now },
  };
  for (const field of [
    'country',
    'region',
    'device',
    'browser',
    'os',
    'connection',
    'pageUrl',
    'url',
    'method',
  ]) {
    if (query[field] === undefined || query[field] === '') continue;
    if (typeof query[field] !== 'string' || query[field].length > 2048)
      throw new AppError(400, `Invalid ${field} filter.`);
    match[field] = query[field];
  }
  return { range, match };
}

export function vitalScore(metrics) {
  // Each available vital contributes equally. Missing measurements never become zero.
  const thresholds = {
    lcp: [2500, 4000],
    fcp: [1800, 3000],
    cls: [0.1, 0.25],
    inp: [200, 500],
  };
  const values = Object.entries(thresholds).flatMap(([field, [good, poor]]) => {
    const value = metrics[field];
    if (value === null || value === undefined) return [];
    return [value <= good ? 100 : value >= poor ? 0 : (100 * (poor - value)) / (poor - good)];
  });
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

function environmentFacet(field) {
  return [
    {
      $group: {
        _id: `$${field}`,
        pageViews: sumIf(isPage),
        requests: sumIf(isRequest),
        lcp: averageIf(isPage, 'lcp'),
        avgDuration: averageIf(isRequest, 'duration'),
      },
    },
    { $project: { _id: 0, name: '$_id', pageViews: 1, requests: 1, lcp: 1, avgDuration: 1 } },
    { $sort: { requests: -1, pageViews: -1, name: 1 } },
  ];
}

export async function getAnalytics(projectId, query) {
  const now = new Date();
  const { range, match } = analyticsMatch(projectId, query, now);
  const unit = range === '7d' || range === '30d' ? 'day' : 'hour';
  const [data] = await Event.aggregate([
    { $match: match },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              pageViews: sumIf(isPage),
              totalRequests: sumIf(isRequest),
              errors: sumIf(isError),
              avgDuration: averageIf(isRequest, 'duration'),
              lcp: averageIf(isPage, 'lcp'),
              fcp: averageIf(isPage, 'fcp'),
              cls: averageIf(isPage, 'cls'),
              inp: averageIf(isPage, 'inp'),
            },
          },
        ],
        sessions: [{ $group: { _id: '$sessionId' } }, { $count: 'count' }],
        timeline: [
          {
            $group: {
              _id: { $dateTrunc: { date: '$timestamp', unit, timezone: 'UTC' } },
              pageViews: sumIf(isPage),
              requests: sumIf(isRequest),
              errors: sumIf(isError),
              avgDuration: averageIf(isRequest, 'duration'),
            },
          },
          {
            $project: {
              _id: 0,
              time: '$_id',
              pageViews: 1,
              requests: 1,
              errors: 1,
              avgDuration: 1,
            },
          },
          { $sort: { time: 1 } },
        ],
        pages: [
          { $match: { type: 'page' } },
          {
            $group: {
              _id: '$pageUrl',
              pageViews: { $sum: 1 },
              sessions: { $addToSet: '$sessionId' },
              ...pageMetrics,
            },
          },
          {
            $project: {
              _id: 0,
              pageUrl: '$_id',
              pageViews: 1,
              sessions: { $size: '$sessions' },
              lcp: 1,
              fcp: 1,
              cls: 1,
              inp: 1,
            },
          },
          { $sort: { pageViews: -1, pageUrl: 1 } },
        ],
        endpoints: [
          { $match: { type: 'request' } },
          {
            $group: {
              _id: { url: '$url', method: '$method' },
              requests: { $sum: 1 },
              errors: sumIf(isError),
              avgDuration: { $avg: '$duration' },
              ttfb: { $avg: '$ttfb' },
            },
          },
          {
            $project: {
              _id: 0,
              url: '$_id.url',
              method: '$_id.method',
              requests: 1,
              avgDuration: 1,
              ttfb: 1,
              errorRate: { $multiply: [{ $divide: ['$errors', '$requests'] }, 100] },
            },
          },
          { $sort: { requests: -1, url: 1, method: 1 } },
        ],
        geography: [
          {
            $group: {
              _id: { country: '$country', region: '$region', city: '$city' },
              pageViews: sumIf(isPage),
              requests: sumIf(isRequest),
              avgDuration: averageIf(isRequest, 'duration'),
              lcp: averageIf(isPage, 'lcp'),
            },
          },
          {
            $project: {
              _id: 0,
              country: '$_id.country',
              region: '$_id.region',
              city: '$_id.city',
              pageViews: 1,
              requests: 1,
              avgDuration: 1,
              lcp: 1,
            },
          },
          { $sort: { requests: -1, pageViews: -1, country: 1 } },
        ],
        browsers: environmentFacet('browser'),
        devices: environmentFacet('device'),
        operatingSystems: environmentFacet('os'),
        connections: environmentFacet('connection'),
      },
    },
  ]);
  const summary = data.summary[0] || {
    pageViews: 0,
    totalRequests: 0,
    errors: 0,
    avgDuration: null,
    lcp: null,
    fcp: null,
    cls: null,
    inp: null,
  };
  const { _id, errors, ...metrics } = summary;
  const bucketSize = unit === 'day' ? 86400000 : 3600000;
  const firstBucket = Math.floor((now.getTime() - ranges[range]) / bucketSize) * bucketSize;
  const lastBucket = Math.floor(now.getTime() / bucketSize) * bucketSize;
  const buckets = new Map(data.timeline.map((row) => [new Date(row.time).getTime(), row]));
  const timeline = [];
  for (let time = firstBucket; time <= lastBucket; time += bucketSize) {
    timeline.push(
      buckets.get(time) || {
        time: new Date(time),
        pageViews: 0,
        requests: 0,
        errors: 0,
        avgDuration: null,
      },
    );
  }
  return {
    range,
    summary: {
      ...metrics,
      sessions: data.sessions[0]?.count || 0,
      errorRate: metrics.totalRequests ? (errors * 100) / metrics.totalRequests : 0,
    },
    timeline,
    pages: data.pages.map((page) => ({ ...page, score: vitalScore(page) })),
    endpoints: data.endpoints,
    geography: data.geography,
    environment: {
      browsers: data.browsers,
      devices: data.devices,
      operatingSystems: data.operatingSystems,
      connections: data.connections,
    },
  };
}

import { Event } from '../models/index.js';
import { AppError } from '../lib/errors.js';
import { analyticsMatch } from './analytics.js';

export function csvCell(value) {
  let text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  // Spreadsheet apps interpret these prefixes as formulas, even inside CSV quotes.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportEvents(project, query, response) {
  const kind = query.kind || 'pages';
  if (!['pages', 'requests'].includes(kind))
    throw new AppError(400, 'Choose pages or requests for export.');
  const { match } = analyticsMatch(project._id, query);
  match.type = kind === 'pages' ? 'page' : 'request';
  const fields =
    kind === 'pages'
      ? [
          'timestamp',
          'pageUrl',
          'sessionId',
          'lcp',
          'fcp',
          'cls',
          'inp',
          'browser',
          'os',
          'device',
          'connection',
          'country',
          'region',
          'city',
        ]
      : [
          'timestamp',
          'pageUrl',
          'url',
          'method',
          'status',
          'duration',
          'ttfb',
          'dns',
          'tcp',
          'tls',
          'sessionId',
          'browser',
          'os',
          'device',
          'connection',
          'country',
          'region',
          'city',
        ];
  response.set('Content-Type', 'text/csv; charset=utf-8');
  response.set('Content-Disposition', `attachment; filename="rum-core-${kind}.csv"`);
  response.set('Cache-Control', 'no-store');
  response.write(`${fields.map(csvCell).join(',')}\r\n`);
  const cursor = Event.find(match)
    .select(fields.join(' '))
    .sort({ timestamp: -1 })
    .lean()
    .cursor();
  try {
    for await (const event of cursor) {
      if (response.destroyed) break;
      const ready = response.write(
        `${fields.map((field) => csvCell(event[field])).join(',')}\r\n`,
      );
      if (!ready)
        await new Promise((resolve) => {
          const finish = () => {
            response.off('drain', finish);
            response.off('close', finish);
            resolve();
          };
          response.once('drain', finish);
          response.once('close', finish);
        });
    }
    response.end();
  } finally {
    await cursor.close();
  }
}

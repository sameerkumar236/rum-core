export function number(value = 0) {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function duration(value) {
  if (value === null || value === undefined) return '—';
  return Number(value) >= 1000
    ? `${(Number(value) / 1000).toFixed(2)} s`
    : `${Math.round(Number(value))} ms`;
}

export function percent(value = 0) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function decimal(value) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(3);
}

export function pathName(value = '') {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value || '/';
  }
}

export function locationName(value) {
  return !value || value === 'Unknown' || value === 'unknown' || value === 'ZZ'
    ? 'Unknown location'
    : value;
}

export function metricStatus(metric, value) {
  if (value === null || value === undefined) return 'unknown';
  const limits = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000] };
  if (!limits[metric]) return 'unknown';
  return value <= limits[metric][0]
    ? 'good'
    : value <= limits[metric][1]
      ? 'needs-work'
      : 'poor';
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import mapData from './map-data/world-paths.json';

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const normalizeName = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const countryLookup = new Map();

for (const country of mapData.countries) {
  countryLookup.set(normalizeName(country.name), country);
  if (country.code) {
    countryLookup.set(normalizeName(country.code), country);
    countryLookup.set(normalizeName(countryNames.of(country.code)), country);
  }
}

// These name variants identify the same ISO country, not additional map locations.
const aliases = {
  'United States of America': 'US',
  USA: 'US',
  'Great Britain': 'GB',
  UK: 'GB',
  'Czech Republic': 'CZ',
  'North Macedonia': 'MK',
  Swaziland: 'SZ',
  'Democratic Republic of the Congo': 'CD',
  'DR Congo': 'CD',
  'Republic of the Congo': 'CG',
  'South Korea': 'KR',
  'Republic of Korea': 'KR',
  'North Korea': 'KP',
  'Russian Federation': 'RU',
  'United Republic of Tanzania': 'TZ',
  'Ivory Coast': 'CI',
  'Lao Peoples Democratic Republic': 'LA',
  'Palestinian Territories': 'PS',
  'Brunei Darussalam': 'BN',
  'Viet Nam': 'VN',
  'The Bahamas': 'BS',
  'Cape Verde': 'CV',
};
for (const [name, code] of Object.entries(aliases)) {
  const country = countryLookup.get(normalizeName(code));
  if (country) countryLookup.set(normalizeName(name), country);
}

function clampView(view) {
  const scale = Math.min(5, Math.max(1, view.scale));
  const maxX = (scale - 1) * 500;
  const maxY = (scale - 1) * 200;
  return {
    scale,
    x: Math.max(-maxX, Math.min(maxX, view.x)),
    y: Math.max(-maxY, Math.min(maxY, view.y)),
  };
}

function svgPoint(svg, event) {
  const matrix = svg.getScreenCTM();
  if (matrix)
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: 500, y: 200 };
}

export function WorldMap({ rows = [], label = 'pageViews', title = 'Visitor geography' }) {
  const titleId = useId();
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const metricLabel = label === 'pageViews' ? 'page views' : 'requests';

  const { totals, maximum, unmapped } = useMemo(() => {
    const totals = new Map();
    let unmapped = 0;
    for (const row of rows) {
      const value = Number(
        row[label] ??
          (label === 'totalRequests'
            ? row.requests
            : label === 'requests'
              ? row.totalRequests
              : undefined) ??
          0,
      );
      if (!Number.isFinite(value) || value <= 0) continue;
      const country = countryLookup.get(normalizeName(row.country));
      if (!country) {
        unmapped += value;
        continue;
      }
      const key = country.code || country.name;
      totals.set(key, (totals.get(key) || 0) + value);
    }
    return { totals, maximum: Math.max(0, ...totals.values()), unmapped };
  }, [rows, label]);

  const zoomAt = useCallback((factor, point = { x: 500, y: 200 }) => {
    setView((previous) => {
      const scale = Math.min(5, Math.max(1, previous.scale * factor));
      const ratio = scale / previous.scale;
      return clampView({
        scale,
        x: point.x - 500 - (point.x - 500 - previous.x) * ratio,
        y: point.y - 200 - (point.y - 200 - previous.y) * ratio,
      });
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const onWheel = (event) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), svgPoint(svg, event));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  function startDrag(event) {
    if (event.button !== 0) return;
    const point = svgPoint(svgRef.current, event);
    dragRef.current = { point, x: view.x, y: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDrag(event) {
    if (!dragRef.current) return;
    const point = svgPoint(svgRef.current, event);
    const start = dragRef.current;
    setView((previous) =>
      clampView({
        ...previous,
        x: start.x + point.x - start.point.x,
        y: start.y + point.y - start.point.y,
      }),
    );
  }

  function endDrag() {
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <figure className="world-map" aria-label={title || 'Country map'}>
      {title && <h2 className="world-map-title">{title}</h2>}
      <div className="world-map-stage">
        <div className="world-map-controls" aria-label="Map controls">
          <button
            type="button"
            className="world-map-control"
            onClick={() => zoomAt(1.3)}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="world-map-control"
            onClick={() => zoomAt(1 / 1.3)}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="world-map-control"
            onClick={() => setView({ x: 0, y: 0, scale: 1 })}
            aria-label="Reset map"
            title="Reset map"
          >
            ↺
          </button>
        </div>
        <svg
          ref={svgRef}
          className={`world-map-svg${dragging ? ' is-dragging' : ''}`}
          viewBox={mapData.viewBox}
          role="img"
          aria-labelledby={titleId}
          style={{ touchAction: 'none' }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <title
            id={titleId}
          >{`Countries with collected ${metricLabel}. Drag to pan and scroll to zoom.`}</title>
          <g
            transform={`translate(${500 + view.x} ${200 + view.y}) scale(${view.scale}) translate(-500 -200)`}
          >
            {mapData.countries.map((country) => {
              const value = totals.get(country.code || country.name) || 0;
              const name = country.code ? countryNames.of(country.code) : country.name;
              const intensity =
                value && maximum ? 0.25 + 0.65 * Math.sqrt(value / maximum) : 0;
              return (
                <path
                  key={`${country.id}-${country.name}`}
                  d={country.path}
                  data-country={country.code || country.name}
                  data-value={value}
                  className={`world-map-country${value ? ' world-map-active' : ''}`}
                  style={{
                    fill: value ? 'var(--primary, #10b981)' : 'transparent',
                    fillOpacity: intensity,
                    stroke: 'currentColor',
                    strokeOpacity: 0.25,
                    strokeWidth: 0.6,
                  }}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${name}: ${value.toLocaleString()} ${metricLabel}`}</title>
                </path>
              );
            })}
            {mapData.countries
              .filter((country) => totals.has(country.code || country.name))
              .map((country) => {
                const [x, y] = country.centroid;
                return (
                  <g
                    key={`marker-${country.id}-${country.name}`}
                    className="world-map-marker"
                    transform={`translate(${x} ${y}) scale(${1 / view.scale})`}
                    pointerEvents="none"
                    aria-hidden="true"
                  >
                    <circle
                      r="10"
                      fill="var(--background, white)"
                      stroke="var(--primary, #10b981)"
                      strokeWidth="1"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="8"
                      fontWeight="600"
                      fill="var(--foreground, #18181b)"
                    >
                      {country.code || '•'}
                    </text>
                  </g>
                );
              })}
          </g>
        </svg>
      </div>
      <figcaption className="world-map-caption">
        <span>Drag to pan, scroll to zoom</span>
        <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
          Natural Earth
        </a>
      </figcaption>
      {!totals.size && <p className="world-map-empty">No country data in this time range.</p>}
      {unmapped > 0 && (
        <p className="world-map-unmapped">
          {unmapped.toLocaleString()} {metricLabel} have no country represented on this map.
        </p>
      )}
    </figure>
  );
}

export default WorldMap;

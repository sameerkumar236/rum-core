import { useState } from 'react';
import { Globe2, Monitor, Users, X } from 'lucide-react';
import { useAnalytics, useWorkspace } from '../context';
import { duration, locationName, number } from '../format';
import {
  Alert,
  DataTable,
  MetricCard,
  NoProject,
  PageHeading,
  Panel,
  Spinner,
} from '../components/ui';
import { Distribution } from '../components/Charts';
import { VitalValue } from './Pages';
import { WorldMap } from '../components/WorldMap';

function countryName(value) {
  if (locationName(value) === 'Unknown location') return 'Unknown location';
  if (!/^[A-Z]{2}$/.test(value)) return value;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(value);
  } catch {
    return value;
  }
}

export function Geography() {
  const { project } = useWorkspace();
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const baseline = useAnalytics();
  const filtered = useAnalytics({ country, region });
  const { data, loading, error } = country || region ? filtered : baseline;
  const countries = [
    ...new Set((baseline.data?.geography || []).map((row) => row.country).filter(Boolean)),
  ].sort();
  const regions = [
    ...new Set(
      (baseline.data?.geography || [])
        .filter((row) => !country || row.country === country)
        .map((row) => row.region)
        .filter(Boolean),
    ),
  ].sort();
  const countryRows = Object.values(
    (data?.geography || []).reduce((groups, row) => {
      const name = countryName(row.country);
      groups[name] ||= { name, pageViews: 0 };
      groups[name].pageViews += row.pageViews || 0;
      return groups;
    }, {}),
  ).sort((a, b) => b.pageViews - a.pageViews);
  const columns = [
    {
      key: 'country',
      label: 'Country',
      searchValue: (row) => countryName(row.country),
      render: (row) => (
        <button
          className="table-text-button"
          onClick={() => {
            setCountry(row.country || 'Unknown');
            setRegion('');
          }}
        >
          <Globe2 size={14} />
          {countryName(row.country)}
        </button>
      ),
    },
    {
      key: 'region',
      label: 'Region',
      render: (row) =>
        row.region && row.region !== 'Unknown' ? (
          <button
            className="table-text-button"
            onClick={() => {
              setCountry(row.country || 'Unknown');
              setRegion(row.region);
            }}
          >
            {row.region}
          </button>
        ) : (
          'Unknown'
        ),
    },
    { key: 'city', label: 'City', render: (row) => row.city || 'Unknown' },
    { key: 'pageViews', label: 'Page views', render: (row) => number(row.pageViews) },
    { key: 'requests', label: 'Requests', render: (row) => number(row.requests) },
    {
      key: 'lcp',
      label: 'Avg. LCP',
      render: (row) => <VitalValue metric="lcp" value={row.lcp} />,
    },
    { key: 'avgDuration', label: 'Avg. API time', render: (row) => duration(row.avgDuration) },
  ];
  if (!project)
    return (
      <>
        <PageHeading title="Geography" description="Requests by Country" />
        <NoProject />
      </>
    );
  return (
    <>
      <PageHeading title="Geography" description="Requests by Country" />
      <div className="filter-bar">
        <span className="filter-label">Filter by</span>
        <label>
          <span className="sr-only">Country</span>
          <select
            value={country}
            onChange={(event) => {
              setCountry(event.target.value);
              setRegion('');
            }}
          >
            <option value="">All countries</option>
            {countries.map((value) => (
              <option key={value} value={value}>
                {countryName(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Region</span>
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="">All regions</option>
            {regions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {(country || region) && (
          <button
            className="text-link filter-clear"
            onClick={() => {
              setCountry('');
              setRegion('');
            }}
          >
            <X size={14} />
            Clear filters
          </button>
        )}
      </div>
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner label="Looking at visitor locations…" />
      ) : (
        data && (
          <>
            {!!data.geography?.length && (
              <WorldMap rows={data.geography} label="requests" title="" />
            )}
            <div className="audience-summary">
              <Panel
                title="Page Views by Country"
                description="Share of tracked page views by country."
              >
                <Distribution rows={countryRows} />
              </Panel>
              <div className="location-note">
                <span className="location-note-icon">
                  <Globe2 size={28} strokeWidth={1.4} />
                </span>
                <h2>Location Data</h2>
                <p>
                  Geography depends on the location data available to your server. When a
                  country, region, or city cannot be identified, we show it as unknown.
                </p>
                <div className="note-stat">
                  <strong>{number(data.summary.pageViews)}</strong>
                  <span>page views in this selection</span>
                </div>
              </div>
            </div>
            <Panel
              title="Requests by City"
              description="Select a country or region to take a closer look."
            >
              <DataTable
                columns={columns}
                rows={data.geography}
                searchPlaceholder="Search countries, regions, or cities…"
                emptyTitle="No location data in this range"
                emptyDescription="Try clearing filters or choosing a wider time range."
              />
            </Panel>
          </>
        )
      )}
    </>
  );
}

const dimensions = [
  { key: 'browsers', filter: 'browser', name: 'Browsers' },
  { key: 'devices', filter: 'device', name: 'Devices' },
  { key: 'operatingSystems', filter: 'os', name: 'Operating systems' },
  { key: 'connections', filter: 'connection', name: 'Connections' },
];

export function Environment() {
  const { project } = useWorkspace();
  const [dimension, setDimension] = useState('browsers');
  const [filters, setFilters] = useState({ browser: '', device: '', os: '', connection: '' });
  const baseline = useAnalytics();
  const filtered = useAnalytics(filters);
  const active = Object.values(filters).some(Boolean);
  const { data, loading, error } = active ? filtered : baseline;
  const current = dimensions.find((item) => item.key === dimension);
  const rows = [...(data?.environment?.[dimension] || [])].sort(
    (a, b) => b.pageViews - a.pageViews,
  );
  const columns = [
    {
      key: 'name',
      label: current.name,
      render: (row) => (
        <button
          className="table-text-button"
          onClick={() => setFilters({ ...filters, [current.filter]: row.name })}
        >
          <Monitor size={15} />
          {row.name || 'Unknown'}
        </button>
      ),
    },
    { key: 'pageViews', label: 'Page views', render: (row) => number(row.pageViews) },
    { key: 'requests', label: 'Requests', render: (row) => number(row.requests) },
    {
      key: 'lcp',
      label: 'Avg. LCP',
      render: (row) => <VitalValue metric="lcp" value={row.lcp} />,
    },
    { key: 'avgDuration', label: 'Avg. API time', render: (row) => duration(row.avgDuration) },
  ];
  if (!project)
    return (
      <>
        <PageHeading title="Environment" description="Requests by Device/Browser" />
        <NoProject />
      </>
    );
  return (
    <>
      <PageHeading title="Environment" description="Requests by Device/Browser" />
      <div className="filter-bar">
        <span className="filter-label">Filter by</span>
        {dimensions.map((item) => (
          <label key={item.key}>
            <span className="sr-only">{item.name}</span>
            <select
              value={filters[item.filter]}
              onChange={(event) =>
                setFilters({ ...filters, [item.filter]: event.target.value })
              }
            >
              <option value="">All {item.name.toLowerCase()}</option>
              {(baseline.data?.environment?.[item.key] || []).map((row) => (
                <option key={row.name} value={row.name}>
                  {row.name || 'Unknown'}
                </option>
              ))}
            </select>
          </label>
        ))}
        {active && (
          <button
            className="text-link filter-clear"
            onClick={() => setFilters({ browser: '', device: '', os: '', connection: '' })}
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner label="Exploring visitor environments…" />
      ) : (
        data && (
          <>
            <div className="audience-summary">
              <Panel
                title="Page Performance by Device/Browser"
                description="Share of tracked page views by the selected dimension."
                action={<span className="small-label">{current.name}</span>}
              >
                <Distribution rows={rows} />
              </Panel>
              <div className="environment-stats">
                <MetricCard
                  label="Page views"
                  value={number(data.summary.pageViews)}
                  detail="Across the selected environments"
                  icon={Monitor}
                  accent
                />
                <MetricCard
                  label="Sessions"
                  value={number(data.summary.sessions)}
                  detail="Browsing sessions in this selection"
                  icon={Users}
                />
              </div>
            </div>
            <Panel
              title="Requests by Device/Browser"
              description="Switch dimensions or select a row to filter your view."
            >
              <div className="dimension-tabs" role="group" aria-label="Environment dimension">
                {dimensions.map((item) => (
                  <button
                    key={item.key}
                    className={dimension === item.key ? 'active' : ''}
                    aria-pressed={dimension === item.key}
                    onClick={() => setDimension(item.key)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <DataTable
                columns={columns}
                rows={rows}
                searchPlaceholder={`Search ${current.name.toLowerCase()}…`}
                emptyTitle="No environment data in this range"
                emptyDescription="Try clearing filters or selecting a wider time range."
              />
            </Panel>
            <p className="data-footnote">
              Browser and device details are derived from browser metadata. Connection
              information is available only in supported browsers.
            </p>
          </>
        )
      )}
    </>
  );
}

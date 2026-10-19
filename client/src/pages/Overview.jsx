import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, ArrowUpRight, Eye, Globe2 } from 'lucide-react';
import { useAnalytics, useWorkspace } from '../context';
import { decimal, duration, metricStatus, number, pathName, percent } from '../format';
import { Alert, MetricCard, NoProject, PageHeading, Panel, Spinner } from '../components/ui';
import { Distribution, TrafficChart } from '../components/Charts';

const vitalDefinitions = [
  {
    key: 'lcp',
    name: 'Largest Contentful Paint',
    short: 'LCP',
    description: 'How quickly the main content appears.',
    threshold: 'Good ≤ 2.5 s',
    format: duration,
  },
  {
    key: 'fcp',
    name: 'First Contentful Paint',
    short: 'FCP',
    description: 'Time to the first visible content.',
    threshold: 'Good ≤ 1.8 s',
    format: duration,
  },
  {
    key: 'inp',
    name: 'Interaction to Next Paint',
    short: 'INP',
    description: 'How responsive your website feels.',
    threshold: 'Good ≤ 200 ms',
    format: duration,
  },
  {
    key: 'cls',
    name: 'Cumulative Layout Shift',
    short: 'CLS',
    description: 'How stable the page layout stays.',
    threshold: 'Good ≤ 0.1',
    format: decimal,
  },
];

export function WebVitals({ summary, includePageViews = false }) {
  return (
    <div
      className={`vitals-grid compact-vitals-grid ${includePageViews ? 'overview-page-metrics' : ''}`}
    >
      {includePageViews && (
        <MetricCard
          label="Page Views"
          value={number(summary.pageViews)}
          detail="Collected page visits"
        />
      )}
      {vitalDefinitions.map((vital) => {
        const status = metricStatus(vital.key, summary[vital.key]);
        return (
          <div className="vital-card" key={vital.key}>
            <div className="vital-top">
              <h3 title={vital.name}>Avg {vital.short}</h3>
              <span
                className="metric-info"
                title={`${vital.name}. ${vital.threshold}. Average of available measurements.`}
                aria-label={`${vital.name}: ${vital.threshold}`}
              >
                ⓘ
              </span>
            </div>
            <div className={`vital-value text-vital-${status}`}>
              {vital.format(summary[vital.key])}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Overview() {
  const { project, range } = useWorkspace();
  const { data, loading, error } = useAnalytics();
  const [metric, setMetric] = useState('pageViews');
  if (!project)
    return (
      <>
        <PageHeading title="Overview" />
        <NoProject />
      </>
    );
  const summary = data?.summary || {};
  const scanUrl = `/website-check?${new URLSearchParams({ url: project.origin, mode: 'browser' })}`;
  const pages = [...(data?.pages || [])].sort((a, b) => b.pageViews - a.pageViews).slice(0, 5);

  return (
    <>
      <PageHeading
        title="Overview"
        action={
          <>
            <Link to={scanUrl} className="button button-primary">
              Scan this website <ArrowRight size={15} />
            </Link>
            <a
              href={project.origin}
              className="button button-secondary"
              target="_blank"
              rel="noreferrer"
            >
              Visit website <ArrowUpRight size={15} />
            </a>
          </>
        }
      />
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner label="Gathering your latest insights…" />
      ) : (
        data && (
          <>
            {!summary.pageViews && !summary.totalRequests && (
              <div
                className="setup-banner setup-banner-prominent"
                role="region"
                aria-label="Monitoring setup"
              >
                <span className="setup-banner-icon">
                  <Activity size={22} />
                </span>
                <div>
                  <strong>No tracker events in this time range</strong>
                  <p>
                    Saving a project URL or opening the site in another browser tab does not
                    collect activity by itself. Run a one-time scan now, or install the tracker
                    for ongoing visitor monitoring.
                  </p>
                  <div className="setup-banner-actions">
                    <Link to={scanUrl} className="button button-primary">
                      Scan this website <ArrowRight size={15} />
                    </Link>
                    <Link to="/install" className="button button-secondary">
                      Install tracker
                    </Link>
                  </div>
                </div>
              </div>
            )}
            <section className="overview-metric-section" aria-label="Requests Overview">
              <h2 className="metric-section-title">Requests Overview</h2>
              <div className="metrics-grid overview-summary-grid">
                <MetricCard
                  label="Total Requests"
                  value={number(summary.totalRequests)}
                  detail="Collected API requests"
                />
                <MetricCard
                  label="Error Rate"
                  value={percent(summary.errorRate)}
                  detail="HTTP errors and failed requests"
                />
                <MetricCard
                  label="Avg Duration"
                  value={duration(summary.avgDuration)}
                  detail="Average request duration"
                />
                <MetricCard
                  label="Sessions"
                  value={number(summary.sessions)}
                  detail="Unique browsing sessions"
                />
              </div>
            </section>
            <section
              className="overview-metric-section"
              aria-label="Page Performance Overview"
            >
              <h2 className="metric-section-title">Page Performance Overview</h2>
              <WebVitals summary={summary} includePageViews />
            </section>
            <Panel
              title="Traffic"
              description="Page views and requests over the selected time range."
              action={
                <div className="segmented-control" aria-label="Chart metric">
                  <button
                    type="button"
                    onClick={() => setMetric('pageViews')}
                    className={metric === 'pageViews' ? 'selected' : ''}
                  >
                    Page views
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric('requests')}
                    className={metric === 'requests' ? 'selected' : ''}
                  >
                    API requests
                  </button>
                </div>
              }
            >
              <div className="chart-legend">
                <i />
                {metric === 'pageViews' ? 'Page views' : 'API requests'}
                <span>Local time</span>
              </div>
              <TrafficChart timeline={data.timeline} range={range} metric={metric} />
            </Panel>
            <div className="overview-bottom">
              <Panel
                title="Top Pages"
                description="Pages ordered by collected views."
                action={
                  <Link to="/pages" className="text-link">
                    View all <ArrowRight size={14} />
                  </Link>
                }
              >
                {pages.length ? (
                  <div className="top-pages">
                    <div className="top-pages-heading">
                      <span>PAGE</span>
                      <span>VIEWS</span>
                    </div>
                    {pages.map((page) => (
                      <Link
                        to={`/pages?pageUrl=${encodeURIComponent(page.pageUrl)}`}
                        className="top-page-row"
                        key={page.pageUrl}
                      >
                        <span>
                          <span className="page-row-icon">
                            <Globe2 size={14} />
                          </span>
                          <span title={page.pageUrl}>{pathName(page.pageUrl)}</span>
                        </span>
                        <strong>
                          {number(page.pageViews)}
                          <ArrowUpRight size={14} />
                        </strong>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="inline-empty">
                    <Eye size={22} />
                    <p>Page activity will appear after your first visit is tracked.</p>
                    <Link to="/install" className="text-link">
                      Install the tracker <ArrowRight size={14} />
                    </Link>
                  </div>
                )}
              </Panel>
              <Panel
                title="Page Views by Device"
                description="Share of collected page views."
                action={
                  <Link
                    to="/environment"
                    className="icon-button"
                    aria-label="Explore visitor environment"
                  >
                    <ArrowUpRight size={18} />
                  </Link>
                }
              >
                <Distribution rows={data.environment?.devices || []} />
              </Panel>
            </div>
          </>
        )
      )}
    </>
  );
}

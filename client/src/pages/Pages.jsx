import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Download, Eye, MousePointer2, Users } from 'lucide-react';
import { useState } from 'react';
import { downloadCsv } from '../api';
import { useAnalytics, useWorkspace } from '../context';
import { decimal, duration, metricStatus, number, pathName } from '../format';
import {
  Alert,
  DataTable,
  MetricCard,
  NoProject,
  PageHeading,
  Panel,
  Spinner,
} from '../components/ui';
import { TrafficChart } from '../components/Charts';
import { WebVitals } from './Overview';
import { WorldMap } from '../components/WorldMap';

export function VitalValue({ metric, value }) {
  return (
    <span className={`table-vital vital-${metricStatus(metric, value)}`}>
      <i />
      {metric === 'cls' ? decimal(value) : duration(value)}
    </span>
  );
}

export function Pages() {
  const { project, projectId, range } = useWorkspace();
  const [params] = useSearchParams();
  const pageUrl = params.get('pageUrl') || '';
  const { data, loading, error } = useAnalytics({ pageUrl });
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const columns = [
    {
      key: 'pageUrl',
      label: 'Page',
      render: (row) => (
        <Link
          className="table-url"
          title={row.pageUrl}
          to={`/pages?pageUrl=${encodeURIComponent(row.pageUrl)}`}
        >
          <span className="url-primary">{pathName(row.pageUrl)}</span>
          <ArrowUpRight size={13} />
        </Link>
      ),
    },
    { key: 'pageViews', label: 'Views', render: (row) => number(row.pageViews) },
    { key: 'sessions', label: 'Sessions', render: (row) => number(row.sessions) },
    { key: 'lcp', label: 'LCP', render: (row) => <VitalValue metric="lcp" value={row.lcp} /> },
    { key: 'inp', label: 'INP', render: (row) => <VitalValue metric="inp" value={row.inp} /> },
    { key: 'cls', label: 'CLS', render: (row) => <VitalValue metric="cls" value={row.cls} /> },
    { key: 'fcp', label: 'FCP', render: (row) => duration(row.fcp) },
    {
      key: 'score',
      label: 'Vitals Score',
      render: (row) =>
        row.score === null || row.score === undefined ? '—' : number(row.score),
    },
  ];
  async function exportData() {
    setExportError('');
    setExporting(true);
    try {
      await downloadCsv(projectId, range, 'pages', pageUrl ? { pageUrl } : {});
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }
  if (!project)
    return (
      <>
        <PageHeading title="Pages" description="Top Pages" />
        <NoProject />
      </>
    );
  return (
    <>
      {pageUrl && (
        <Link className="back-link" to="/pages">
          <ArrowLeft size={15} />
          All pages
        </Link>
      )}
      <PageHeading
        title={pageUrl ? pathName(pageUrl) : 'Pages'}
        description={pageUrl ? <span className="break-anywhere">{pageUrl}</span> : 'Top Pages'}
        action={
          <button
            className="button button-secondary"
            onClick={exportData}
            disabled={exporting || !data?.pages?.length}
          >
            <Download size={15} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      <Alert>{error || exportError}</Alert>
      {loading ? (
        <Spinner label="Loading page performance…" />
      ) : (
        data && (
          <>
            {!pageUrl && (
              <div className="metrics-grid page-summary-grid">
                <MetricCard label="Sessions" value={number(data.summary.sessions)} />
                {['lcp', 'fcp', 'cls', 'inp'].map((metric) => (
                  <MetricCard
                    key={metric}
                    label={`Avg ${metric.toUpperCase()}`}
                    value={
                      <span
                        className={`text-vital-${metricStatus(metric, data.summary[metric])}`}
                      >
                        {metric === 'cls'
                          ? decimal(data.summary[metric])
                          : duration(data.summary[metric])}
                      </span>
                    }
                  />
                ))}
                <MetricCard label="Page Views" value={number(data.summary.pageViews)} />
              </div>
            )}
            {pageUrl && (
              <>
                <div className="metrics-grid metrics-three">
                  <MetricCard
                    label="Page views"
                    value={number(data.summary.pageViews)}
                    detail="Visits to this page"
                    icon={Eye}
                    accent
                  />
                  <MetricCard
                    label="Sessions"
                    value={number(data.summary.sessions)}
                    detail="Sessions that viewed this page"
                    icon={Users}
                  />
                  <MetricCard
                    label="First Contentful Paint"
                    value={duration(data.summary.fcp)}
                    detail="Average time to the first content"
                    icon={MousePointer2}
                  />
                </div>
                <Panel
                  title="Page traffic"
                  description="Visits to this page over the selected time range."
                >
                  <TrafficChart timeline={data.timeline} range={range} />
                </Panel>
                <div className="section-heading">
                  <div>
                    <h2>The experience on this page</h2>
                    <p>Average browser measurements across collected visits.</p>
                  </div>
                </div>
                <WebVitals summary={data.summary} />
              </>
            )}
            {!!data.geography?.length && <WorldMap rows={data.geography} title="" />}
            <Panel
              className="analytics-table-panel"
              title={pageUrl ? 'Page Measurements' : 'Top Pages'}
              description="Select a page to view its traffic and measurements."
            >
              <DataTable
                columns={columns}
                rows={data.pages}
                searchPlaceholder="Search page URLs…"
                emptyTitle="No page views in this range"
                emptyDescription="Try a wider time range, or add the tracker to your website to start collecting visits."
              />
            </Panel>
            <p className="data-footnote">
              Web Vitals are averages of available browser measurements. A dash means that
              metric has not been received. Values are not percentile-based Core Web Vitals
              assessments. Vitals Score summarizes the available averages and is not an
              official Core Web Vitals score.
            </p>
          </>
        )
      )}
    </>
  );
}

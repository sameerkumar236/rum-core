import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Download } from 'lucide-react';
import { downloadCsv } from '../api';
import { useAnalytics, useWorkspace } from '../context';
import { duration, number, pathName, percent } from '../format';
import {
  Alert,
  DataTable,
  MetricCard,
  NoProject,
  PageHeading,
  Panel,
  Spinner,
  UrlCheckerLink,
} from '../components/ui';
import { TrafficChart } from '../components/Charts';
import { WorldMap } from '../components/WorldMap';

export function Endpoints() {
  const { project, projectId, range } = useWorkspace();
  const [params] = useSearchParams();
  const url = params.get('url') || '';
  const method = params.get('method') || '';
  const { data, loading, error } = useAnalytics({ url, method });
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const columns = [
    {
      key: 'method',
      label: 'Method',
      render: (row) => (
        <span className={`method method-${row.method?.toLowerCase()}`}>
          {row.method || 'GET'}
        </span>
      ),
    },
    {
      key: 'url',
      label: 'Endpoint',
      render: (row) => (
        <Link
          className="table-url"
          title={row.url}
          to={`/endpoints?${new URLSearchParams({ url: row.url, method: row.method })}`}
        >
          <span className="url-primary">{pathName(row.url)}</span>
          <ArrowUpRight size={13} />
        </Link>
      ),
    },
    { key: 'requests', label: 'Requests', render: (row) => number(row.requests) },
    { key: 'avgDuration', label: 'Avg. duration', render: (row) => duration(row.avgDuration) },
    { key: 'ttfb', label: 'Avg. TTFB', render: (row) => duration(row.ttfb) },
    {
      key: 'errorRate',
      label: 'Error rate',
      render: (row) => (
        <span className={row.errorRate > 0 ? 'text-warning' : 'text-success'}>
          {percent(row.errorRate)}
        </span>
      ),
    },
  ];
  async function exportData() {
    setExportError('');
    setExporting(true);
    try {
      await downloadCsv(projectId, range, 'requests', {
        ...(url ? { url } : {}),
        ...(method ? { method } : {}),
      });
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }
  if (!project)
    return (
      <>
        <PageHeading title="Endpoints" description="Top API Endpoints" />
        <UrlCheckerLink />
        <NoProject />
      </>
    );
  return (
    <>
      {url && (
        <Link className="back-link" to="/endpoints">
          <ArrowLeft size={15} />
          All API requests
        </Link>
      )}
      <PageHeading
        title={url ? pathName(url) : 'Endpoints'}
        description={
          url ? (
            <span className="break-anywhere">
              {method} {url}
            </span>
          ) : (
            'Top API Endpoints'
          )
        }
        action={
          <button
            className="button button-secondary"
            disabled={exporting || !data?.endpoints?.length}
            onClick={exportData}
          >
            <Download size={15} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      <UrlCheckerLink />
      <Alert>{error || exportError}</Alert>
      {loading ? (
        <Spinner label="Loading API performance…" />
      ) : (
        data && (
          <>
            <div className="metrics-grid metrics-three">
              <MetricCard label="API requests" value={number(data.summary.totalRequests)} />
              <MetricCard label="Avg. duration" value={duration(data.summary.avgDuration)} />
              <MetricCard label="Error rate" value={percent(data.summary.errorRate)} />
            </div>
            {!!data.geography?.length && (
              <WorldMap rows={data.geography} label="requests" title="" />
            )}
            <Panel
              className="analytics-table-panel"
              title={url ? 'Endpoint Measurements' : 'Top API Endpoints'}
              description="Select an endpoint to focus on its performance."
            >
              <DataTable
                columns={columns}
                rows={data.endpoints}
                searchPlaceholder="Search endpoints or methods…"
                emptyTitle="No API requests in this range"
                emptyDescription="Requests made with fetch or XMLHttpRequest will appear after the tracker is installed."
              />
            </Panel>
            <Panel
              title="Request activity"
              description="API requests over the selected time range."
            >
              <TrafficChart timeline={data.timeline} range={range} metric="requests" />
            </Panel>
            <p className="data-footnote">
              TTFB may be unavailable when the browser restricts cross-origin resource timing.
              All timings are measured in your visitors’ browsers.
            </p>
          </>
        )
      )}
    </>
  );
}

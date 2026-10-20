import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Braces, Check, Clock3, Globe2, LoaderCircle, Monitor, Search } from 'lucide-react';
import { api } from '../api';
import { decimal, duration, number } from '../format';
import {
  Alert,
  DataTable,
  EmptyState,
  MetricCard,
  PageHeading,
  Panel,
} from '../components/ui';

function normalizeUrl(value) {
  const text = value.trim();
  if (!text) throw new Error('Enter a public website or API URL.');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) {
    throw new Error('Use an HTTP or HTTPS URL.');
  }
  const candidate = text.startsWith('//')
    ? `https:${text}`
    : /^https?:\/\//i.test(text)
      ? text
      : `https://${text}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Enter a valid URL, such as https://example.com.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Use a public HTTP or HTTPS URL without login details.');
  }
  return parsed.toString();
}

function bytes(value) {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${number(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function isApiCall(request) {
  return ['fetch', 'xhr'].includes(request.resourceType?.toLowerCase());
}

const modes = [
  {
    value: 'browser',
    label: 'Website API scan',
    description: 'Open a page and observe the fetch/XHR calls it makes during loading.',
    icon: Monitor,
  },
  {
    value: 'http',
    label: 'API / URL check',
    description: 'Send one GET request and measure the URL’s response and connection timings.',
    icon: Braces,
  },
];

export function WebsiteCheck() {
  const [searchParams] = useSearchParams();
  const prefilledUrl = (searchParams.get('url') || '').slice(0, 4096);
  const prefilledMode = searchParams.get('mode') === 'http' ? 'http' : 'browser';
  const [url, setUrl] = useState(prefilledUrl);
  const [mode, setMode] = useState(prefilledMode);
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const lastPrefill = useRef({ url: prefilledUrl, mode: prefilledMode });

  // Apply a new link's values, without replacing edits when its query is unchanged.
  // If a check is running, wait for it to finish before changing the form.
  useEffect(() => {
    if (checking) return;
    if (lastPrefill.current.url === prefilledUrl && lastPrefill.current.mode === prefilledMode)
      return;
    lastPrefill.current = { url: prefilledUrl, mode: prefilledMode };
    setUrl(prefilledUrl);
    setMode(prefilledMode);
    setError('');
  }, [prefilledUrl, prefilledMode, checking]);

  async function submit(event) {
    event.preventDefault();
    if (checking) return;
    setError('');
    try {
      const normalizedUrl = normalizeUrl(url);
      setUrl(normalizedUrl);
      setChecking(true);
      const data = await api('/website-check', {
        method: 'POST',
        body: { url: normalizedUrl, mode },
      });
      setResult(data);
    } catch (err) {
      setError(
        err.status === 503 && mode === 'browser'
          ? `${err.message} Try API / URL check to measure the HTTP response.`
          : err.message,
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Website Check"
        description="Check a public website’s loading speed and network requests. No installation needed."
      />
      <Panel
        title="Check a website"
        description="A website scan opens a fresh browser on the monitoring server and observes the initial page load."
      >
        <form className="website-check-form" onSubmit={submit}>
          <fieldset className="check-mode-options" disabled={checking}>
            <legend className="sr-only">Check mode</legend>
            {modes.map(({ value, label, description, icon: Icon }) => (
              <label
                key={value}
                className={`check-mode-option ${mode === value ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="check-mode"
                  value={value}
                  aria-label={label}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <Icon size={19} strokeWidth={1.6} />
                <span>
                  <strong>{label}</strong>
                  <span>{description}</span>
                </span>
                <span className="check-mode-indicator">
                  {mode === value && <Check size={11} />}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="check-url-label" htmlFor="website-check-url">
            URL to check
          </label>
          <div className="check-url-row">
            <div className="check-url-input">
              <Globe2 size={17} />
              <input
                id="website-check-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="https://example.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={checking}
                aria-describedby="website-check-help"
                maxLength={4096}
                required
              />
            </div>
            <button
              type="submit"
              className="button button-primary"
              disabled={checking || !url.trim()}
            >
              {checking ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
              {checking ? 'Checking…' : 'Run check'}
            </button>
          </div>
          <p id="website-check-help" className="field-help">
            Use a public HTTP or HTTPS URL on its standard port. This tool does not send custom
            authentication, request bodies, or your login cookies.
          </p>
          <p className="field-help check-session-context">
            A scan does not observe another open browser tab or your signed-in session. Install
            the tracker to monitor real visitors and their interactions over time.
          </p>
          <Alert>
            {error && (
              <>
                {error}
                {result && ' Your previous result is still shown below.'}
              </>
            )}
          </Alert>
          {checking && (
            <div className="check-progress" role="status">
              <LoaderCircle size={15} className="spin" />
              <span>
                {mode === 'browser'
                  ? 'Opening the page and observing its initial requests. This may take about 30 seconds.'
                  : 'Measuring the URL’s response. This may take about 20 seconds.'}
                {result && ' The previous result remains visible until this check finishes.'}
              </span>
            </div>
          )}
        </form>
      </Panel>
      {result ? (
        <WebsiteCheckResult key={result.checkedAt} result={result} />
      ) : (
        !checking && (
          <Panel title="Website Check" description="Choose a mode and run your first check.">
            <EmptyState
              icon={Monitor}
              title="See how a page loads"
              description="A website scan captures the API calls triggered during one desktop page visit. A URL check measures one request. Ongoing visitor trends are available through the tracker."
            />
          </Panel>
        )
      )}
    </>
  );
}

function WebsiteCheckResult({ result }) {
  const [requestFilter, setRequestFilter] = useState('api');
  const browserScan = result.mode === 'browser';
  const requests = result.requests || [];
  const apiCalls = requests.filter(isApiCall);
  const visibleRequests = browserScan && requestFilter === 'api' ? apiCalls : requests;
  const metrics = result.metrics || {};
  const network = result.network || {};
  const status = result.page?.statusCode;
  const columns = [
    {
      key: 'url',
      label: 'Request URL',
      render: (row) => (
        <div className="check-request-url">
          <span title={row.url}>{row.url}</span>
          {row.error && (
            <small className="text-warning" title={row.error}>
              {row.error}
            </small>
          )}
        </div>
      ),
    },
    {
      key: 'method',
      label: 'Method',
      render: (row) => (
        <span className={`method method-${row.method?.toLowerCase()}`}>{row.method}</span>
      ),
    },
    { key: 'resourceType', label: 'Type' },
    {
      key: 'statusCode',
      label: 'Status',
      render: (row) => (
        <span className={row.failed || row.statusCode >= 400 ? 'text-warning' : ''}>
          {row.statusCode ?? (row.failed ? 'Failed' : 'Unavailable')}
        </span>
      ),
    },
    { key: 'durationMs', label: 'Duration', render: (row) => duration(row.durationMs) },
    { key: 'transferBytes', label: 'Transferred', render: (row) => bytes(row.transferBytes) },
  ];

  return (
    <div className="website-check-results">
      <div className="check-result-heading">
        <div>
          <div className="eyebrow">LATEST CHECK RESULT</div>
          <h2>{result.page?.title || 'URL check result'}</h2>
          <p className="check-result-url">{result.finalUrl}</p>
          <span className="check-result-time">
            Checked {new Date(result.checkedAt).toLocaleString()} ·{' '}
            {browserScan
              ? 'One desktop page visit from the server'
              : 'One GET request from the server'}
          </span>
        </div>
        <div className="check-result-badges">
          <span className="small-label">
            {browserScan ? 'Website API scan' : 'API / URL check'}
          </span>
          <span
            className={`status-badge ${status >= 400 ? 'status-poor' : status ? 'status-good' : 'status-unknown'}`}
          >
            {status ? `HTTP ${status}` : 'Status unavailable'}
          </span>
        </div>
      </div>
      {result.timedOut && (
        <div className="check-notice" role="status">
          This check reached its time limit. The results below contain only the measurements
          and requests captured before it ended.
        </div>
      )}
      {!browserScan && (
        <div className="check-notice">
          This mode measures the initial HTTP response only. It does not run JavaScript,
          discover API calls, or measure browser paints and layout.
        </div>
      )}
      <div className="metrics-grid">
        <MetricCard
          label="Total time"
          value={duration(metrics.totalMs)}
          detail="Measured during this single check"
          icon={Clock3}
          accent
        />
        <MetricCard
          label="Time to first byte"
          value={duration(metrics.ttfbMs)}
          detail="Time until the response started"
          icon={Clock3}
        />
        <MetricCard
          label={browserScan ? 'API calls listed' : 'Requests observed'}
          value={number(browserScan ? apiCalls.length : network.totalRequests)}
          detail={
            browserScan
              ? 'Captured fetch and XMLHttpRequest calls'
              : 'Includes observed redirect requests'
          }
          icon={Braces}
        />
        <MetricCard
          label="Failed requests"
          value={number(network.failedRequests)}
          detail={`${bytes(network.transferredBytes)} transferred in this check`}
          icon={Globe2}
        />
      </div>
      <div className={`check-timing-grid ${browserScan ? '' : 'check-timing-single'}`}>
        <Panel
          title="Request timings"
          description={
            browserScan
              ? 'Available timings for this browser navigation.'
              : 'Connection and response measurements for this request.'
          }
        >
          <TimingList
            rows={[
              ['DNS lookup', metrics.dnsMs, 'Resolving the server’s address'],
              ['TCP connection', metrics.tcpMs, 'Establishing the network connection'],
              ['TLS handshake', metrics.tlsMs, 'Negotiating HTTPS encryption'],
              ['First byte', metrics.ttfbMs, 'Waiting for the response to begin'],
              ['Response download', metrics.downloadMs, 'Receiving the response'],
              ['Total time', metrics.totalMs, 'Total measured request timing'],
            ]}
          />
          <p className="check-panel-note">
            {browserScan
              ? 'DNS, TCP, and TLS timings are unavailable in this proxied browser scan.'
              : 'DNS, TCP, TLS, and download describe the final request. Total time and first byte include the redirect chain. A dash means a phase was unavailable or did not apply.'}
          </p>
        </Panel>
        {browserScan && (
          <Panel
            title="Browser measurements"
            description="Observed while this page loaded, with no clicks or typing."
          >
            <TimingList
              rows={[
                ['First Contentful Paint', metrics.fcpMs, 'First text or image painted'],
                ['Largest Contentful Paint', metrics.lcpMs, 'Largest visible content painted'],
                [
                  'Cumulative Layout Shift',
                  metrics.cls,
                  'Layout movement during observation',
                  decimal,
                ],
                ['DOM content loaded', metrics.domContentLoadedMs, 'Initial document parsed'],
                ['Page load', metrics.loadMs, 'Initial page load completed'],
                [
                  'Interaction to Next Paint',
                  null,
                  'Not measured: this scan has no interactions',
                ],
              ]}
            />
            <p className="check-panel-note">
              A single page load can miss later paints and layout changes. These are observed
              measurements, not a visitor average or percentile assessment.
            </p>
          </Panel>
        )}
      </div>
      <Panel
        title="Findings from this check"
        description="Observations from one visit. Repeat a check to see whether a delay persists."
      >
        {result.issues?.length ? (
          <ul className="check-findings">
            {result.issues.map((issue, index) => (
              <li key={`${index}-${issue.message}`}>
                <span
                  className={`status-badge ${issue.severity === 'error' ? 'status-poor' : issue.severity === 'warning' ? 'status-needs-work' : 'status-unknown'}`}
                >
                  {issue.severity}
                </span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="check-no-findings">
            <Check size={17} />
            No issues were flagged in the available measurements.
          </div>
        )}
      </Panel>
      <Panel
        title={browserScan ? 'Requests captured during page load' : 'Observed HTTP requests'}
        description={
          browserScan
            ? 'Only calls triggered while the initial page loads are captured. APIs behind clicks, sign-in, or later navigation may not run.'
            : 'The URL and any redirects observed during this GET request.'
        }
        action={
          browserScan && (
            <div className="segmented-control" aria-label="Request type">
              <button
                type="button"
                className={requestFilter === 'api' ? 'selected' : ''}
                aria-pressed={requestFilter === 'api'}
                onClick={() => setRequestFilter('api')}
              >
                API calls ({number(apiCalls.length)})
              </button>
              <button
                type="button"
                className={requestFilter === 'all' ? 'selected' : ''}
                aria-pressed={requestFilter === 'all'}
                onClick={() => setRequestFilter('all')}
              >
                All requests ({number(requests.length)})
              </button>
            </div>
          )
        }
      >
        {requests.length < network.totalRequests && (
          <p className="check-truncation-note">
            The server observed {number(network.totalRequests)} requests. This result lists the
            first {number(requests.length)}; API counts refer to that list.
          </p>
        )}
        <DataTable
          columns={columns}
          rows={visibleRequests}
          searchPlaceholder="Search request URLs, types, or methods…"
          emptyTitle={
            browserScan && requestFilter === 'api'
              ? 'No fetch/XHR calls were captured'
              : 'No requests to show'
          }
          emptyDescription={
            browserScan && requestFilter === 'api'
              ? 'This page may not make API calls during its initial load. Check all requests for other resources, or use the tracker to observe real navigation and interactions.'
              : 'Try another search or run a new check.'
          }
        />
      </Panel>
      <div className="check-context-note">
        <Monitor size={18} />
        <p>
          {browserScan
            ? 'This is one desktop visit from the monitoring server. It does not discover every API or represent your visitors’ devices, locations, or interactions.'
            : 'This is one response measured from the monitoring server. Your visitors’ response times may differ.'}{' '}
          Install the tracker for ongoing real user monitoring.
        </p>
      </div>
    </div>
  );
}

function TimingList({ rows }) {
  return (
    <dl className="check-timing-list">
      {rows.map(([label, value, description, format = duration]) => (
        <div key={label}>
          <dt>
            {label}
            <span>{description}</span>
          </dt>
          <dd>{format(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

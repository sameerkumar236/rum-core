import { useEffect, useState } from 'react';
import { Braces, CalendarDays, Database, Eye, FolderKanban, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { number } from '../format';
import { Alert, MetricCard, PageHeading, Panel, Spinner } from '../components/ui';

export function Usage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api('/usage')
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <>
      <PageHeading
        title="Usage"
        description="Across Projects"
        action={
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw size={15} />
            Refresh usage
          </button>
        }
      />
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner label="Checking workspace usage…" />
      ) : (
        data && (
          <>
            <div className="metrics-grid">
              <MetricCard
                label="Projects"
                value={number(data.projects)}
                detail="Websites in your workspace"
                icon={FolderKanban}
                accent
              />
              <MetricCard
                label="Collected events"
                value={number(data.totalEvents)}
                detail="Currently stored across projects"
                icon={Database}
              />
              <MetricCard
                label="Page views"
                value={number(data.pageViews)}
                detail="Stored page view events"
                icon={Eye}
              />
              <MetricCard
                label="API requests"
                value={number(data.requests)}
                detail="Stored request events"
                icon={Braces}
              />
            </div>
            <div className="usage-grid">
              <Panel
                title="Usage Details"
                description="Counts reflect the events currently stored in your workspace."
              >
                <div className="usage-explanation">
                  <div>
                    <span className="usage-explanation-icon">
                      <Database size={20} />
                    </span>
                    <div>
                      <h3>What counts as an event?</h3>
                      <p>
                        Each page view or API request counts as one event. Web Vitals update
                        the existing page event instead of adding another page view.
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className="usage-explanation-icon">
                      <CalendarDays size={20} />
                    </span>
                    <div>
                      <h3>Data retention</h3>
                      <p>
                        Events are retained for {number(data.retentionDays)} days. Expired
                        events are automatically removed from storage, so these counts change
                        over time.
                      </p>
                    </div>
                  </div>
                </div>
              </Panel>
              <div className="retention-card">
                <CalendarDays size={28} strokeWidth={1.4} />
                <span>DATA RETENTION</span>
                <strong>
                  {number(data.retentionDays)}
                  <small>days</small>
                </strong>
                <p>Events older than this window are automatically removed from storage.</p>
              </div>
            </div>
          </>
        )
      )}
    </>
  );
}

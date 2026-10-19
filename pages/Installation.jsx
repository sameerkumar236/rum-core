import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  MousePointer2,
  ShieldCheck,
} from 'lucide-react';
import { getPublicApiUrl } from '../api';
import { useWorkspace } from '../context';
import { CopyButton, NoProject, PageHeading, Panel, UrlCheckerLink } from '../components/ui';

function attribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}

export function Installation() {
  const { project } = useWorkspace();
  const publicApiUrl = getPublicApiUrl();
  if (!project)
    return (
      <>
        <PageHeading
          title="Connect Your Site"
          description="Install the tracking script on your website."
        />
        <UrlCheckerLink />
        <NoProject />
      </>
    );
  const snippet = `<script\n  defer\n  src="${attribute(publicApiUrl)}/tracker.js"\n  data-key="${attribute(project.key)}"\n  data-endpoint="${attribute(publicApiUrl)}/api/ingest"\n></script>`;

  return (
    <>
      <PageHeading
        title="Connect Your Site"
        description={
          <>
            Install the tracker for <span className="text-strong">{project.name}</span>.
          </>
        }
      />
      <UrlCheckerLink />
      <div className="installation-grid">
        <div>
          <Panel
            title="Tracking Script"
            description="Add this once, inside the <head> of your website."
            action={<CopyButton value={snippet} label="Copy snippet" />}
          >
            <div className="code-window">
              <div className="code-window-header">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                <span>index.html</span>
                <Code2 size={14} />
              </div>
              <pre>
                <code>{snippet}</code>
              </pre>
            </div>
            <div className="installation-details">
              <div>
                <span>Allowed website</span>
                <a href={project.origin} target="_blank" rel="noreferrer">
                  {project.origin}
                  <ArrowUpRight size={13} />
                </a>
              </div>
              <div>
                <span>Collection server</span>
                <code>{publicApiUrl}</code>
              </div>
            </div>
          </Panel>
          <Panel
            title="Setup Instructions"
            description="Install, publish, and verify your tracking script."
          >
            <ol className="install-steps">
              <li>
                <span className="step-number">01</span>
                <div>
                  <h3>Add the snippet</h3>
                  <p>
                    Paste the script into your website’s HTML head. In a React app built with
                    Vite, use the root <code>index.html</code>.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-number">02</span>
                <div>
                  <h3>Publish and visit your website</h3>
                  <p>
                    Open a page on <strong>{project.origin}</strong>. Navigate around and use
                    features that make API requests.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-number">03</span>
                <div>
                  <h3>Verify collection</h3>
                  <p>
                    Return to the overview and refresh. Page views, API requests, and available
                    Web Vitals will begin appearing.
                  </p>
                  <Link to="/overview" className="text-link">
                    Open overview <ArrowRight size={14} />
                  </Link>
                </div>
              </li>
            </ol>
          </Panel>
        </div>
        <div className="installation-side">
          <div className="installation-callout">
            <span className="callout-icon">
              <MousePointer2 size={24} strokeWidth={1.5} />
            </span>
            <h2>Collected Data</h2>
            <p>
              The tracker observes page visits, browser performance measurements, and fetch or
              XMLHttpRequest timing.
            </p>
            <div className="feature-check">
              <Check size={15} />
              Page and SPA navigation tracking
            </div>
            <div className="feature-check">
              <Check size={15} />
              Loading and interaction metrics
            </div>
            <div className="feature-check">
              <Check size={15} />
              API timing and failed requests
            </div>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={23} strokeWidth={1.5} />
            <h3>Privacy and consent</h3>
            <p>
              The tracker respects Do Not Track and <code>window.rumCoreDisabled</code>. Set
              that flag before the script loads when consent is required, then load the script
              after permission is given.
            </p>
            <p>
              Avoid personal information in URLs. URL filters exclude matching request events,
              but do not suppress page views. On sensitive pages, do not load the tracker or
              set window.rumCoreDisabled before it loads.
            </p>
            <Link to="/settings" className="text-link">
              Configure collection <ArrowRight size={14} />
            </Link>
          </div>
          <div className="installation-help">
            <h3>Not seeing events?</h3>
            <p>
              Check that the website origin matches exactly, your browser permits tracking, and
              your website can reach the collection server shown above.
            </p>
            <p>
              The server address must be reachable from your visitors’ browsers. A localhost
              address is for local development.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

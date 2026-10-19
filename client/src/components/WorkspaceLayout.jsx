import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Braces,
  ChevronDown,
  Code2,
  Contrast,
  Folder,
  FolderKanban,
  Gauge,
  Globe2,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  SearchCheck,
  Settings2,
  X,
} from 'lucide-react';
import { useAuth, useWorkspace } from '../context';
import { useTheme } from '../theme.jsx';
import { Alert, Logo, Spinner } from './ui';

const dashboardLinks = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/pages', label: 'Pages', icon: BarChart3 },
  { to: '/endpoints', label: 'Endpoints', icon: Braces },
  { to: '/geography', label: 'Geography', icon: Globe2 },
  { to: '/environment', label: 'Environment', icon: Monitor },
];

const accountLinks = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/usage', label: 'Usage', icon: Gauge },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

const abbreviations = [
  ['LCP', 'Largest Contentful Paint'],
  ['CLS', 'Cumulative Layout Shift'],
  ['INP', 'Interaction to Next Paint'],
  ['FCP', 'First Contentful Paint'],
  ['TTFB', 'Time to First Byte'],
];

export function WorkspaceLayout() {
  const { user, logout } = useAuth();
  const { projects, projectId, setProjectId, loading, error, loadProjects } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const sidebarRef = useRef(null);
  const accountRef = useRef(null);
  const accountButtonRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)');
    const closeMobileMenu = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener('change', closeMobileMenu);
    return () => desktop.removeEventListener('change', closeMobileMenu);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const controls = () =>
      [...sidebarRef.current.querySelectorAll('a, button, select, summary')].filter(
        (element) => !element.disabled && element.getClientRects().length,
      );
    controls()[0]?.focus();
    document.body.style.overflow = 'hidden';
    function handleKey(event) {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    accountRef.current.querySelector('[role="menuitem"]')?.focus();
    function closeOutside(event) {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    }
    function closeWithEscape(event) {
      if (event.key === 'Escape') {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [accountOpen]);

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
    } catch (err) {
      setLogoutError(err.message);
    } finally {
      setLoggingOut(false);
    }
  }

  function changeProject(event) {
    if (event.target.value === 'create-project') {
      navigate('/projects');
      return;
    }
    setProjectId(event.target.value);
    // Filters from the previous project should not carry into the next one.
    navigate(location.pathname, { replace: true });
  }

  function renderLinks(links) {
    return links.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        onClick={() => setMobileOpen(false)}
        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
      >
        <Icon size={16} strokeWidth={1.8} />
        <span>{label}</span>
      </NavLink>
    ));
  }

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside ref={sidebarRef} className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Link to="/overview" aria-label="RUM Core home">
            <Logo />
            <span className="sidebar-brand-title">RUM CORE</span>
          </Link>
          <button
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>
        <div className="sidebar-content">
          <section className="sidebar-group">
            <h2 className="nav-section-label">Dashboard</h2>
            <nav aria-label="Analytics navigation">{renderLinks(dashboardLinks)}</nav>
          </section>
          <section className="sidebar-group">
            <h2 className="nav-section-label">Account</h2>
            <nav aria-label="Workspace navigation">{renderLinks(accountLinks)}</nav>
          </section>
          <section className="sidebar-group">
            <h2 className="nav-section-label">Tools</h2>
            <nav aria-label="Tools navigation">
              {renderLinks([
                { to: '/website-check', label: 'URL checker', icon: SearchCheck },
              ])}
            </nav>
          </section>
        </div>
        <div className="sidebar-footer">
          <details className="sidebar-info">
            <summary className="icon-button" aria-label="Metric abbreviations">
              <Info size={16} />
              <span className="sr-only">Metric abbreviations</span>
            </summary>
            <dl>
              {abbreviations.map(([short, full]) => (
                <div key={short}>
                  <dt>{short}</dt>
                  <dd>{full}</dd>
                </div>
              ))}
            </dl>
          </details>
          <div className="sidebar-usage">
            <div className="usage-line">
              <span>Projects</span>
              <strong>{projects.length}</strong>
            </div>
            <Link to="/usage">View usage</Link>
          </div>
          <p className="sidebar-footnote">
            <span>*</span>
            <span>Analytics show collected tracker events for the selected time range.</span>
          </p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
            >
              <Menu size={20} />
            </button>
            <label className="project-selector">
              <span className="sr-only">Current project</span>
              <Folder size={16} className="project-select-icon" />
              <select value={projectId} onChange={changeProject} disabled={loading}>
                <option value="" disabled>
                  {loading ? 'Loading...' : 'Select Project'}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                <option value="create-project">+ Create new project</option>
              </select>
              <ChevronDown size={14} className="project-select-chevron" />
            </label>
            <Link to="/install" className="button button-secondary connect-button">
              <Code2 size={16} />
              <span>Connect</span>
            </Link>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (Ctrl + M)`}
            >
              <Contrast size={19} />
            </button>
            <div
              className="user-menu"
              ref={accountRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false);
              }}
            >
              <button
                ref={accountButtonRef}
                className="icon-button user-menu-trigger"
                type="button"
                aria-label="Open account menu"
                aria-expanded={accountOpen}
                aria-controls="account-menu"
                aria-haspopup="menu"
                onClick={() => setAccountOpen((value) => !value)}
              >
                <span className="avatar">{user.name?.slice(0, 1).toUpperCase() || 'U'}</span>
              </button>
              {accountOpen && (
                <div id="account-menu" role="menu" className="user-dropdown">
                  <div className="user-dropdown-profile">
                    <span className="avatar avatar-large">
                      {user.name?.slice(0, 1).toUpperCase() || 'U'}
                    </span>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="button button-danger"
                    onClick={signOut}
                    disabled={loggingOut}
                    aria-label="Sign out"
                  >
                    <LogOut size={15} />
                    {loggingOut ? 'Logging out...' : 'Log out'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <div className="page-content">
            {logoutError && <Alert onDismiss={() => setLogoutError('')}>{logoutError}</Alert>}
            {error ? (
              <>
                <Alert>{error}</Alert>
                <button className="button button-secondary" onClick={loadProjects}>
                  Reload projects
                </button>
              </>
            ) : loading ? (
              <Spinner />
            ) : (
              <Suspense fallback={<Spinner label="Loading dashboard..." />}>
                <Outlet key={projectId} />
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

import { lazy } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, WorkspaceProvider } from './context';
import { Alert, Logo, Spinner } from './components/ui';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { AuthPage } from './pages/AuthPage';

const Overview = lazy(() =>
  import('./pages/Overview').then((page) => ({ default: page.Overview })),
);
const Pages = lazy(() => import('./pages/Pages').then((page) => ({ default: page.Pages })));
const Endpoints = lazy(() =>
  import('./pages/Endpoints').then((page) => ({ default: page.Endpoints })),
);
const Geography = lazy(() =>
  import('./pages/Audience').then((page) => ({ default: page.Geography })),
);
const Environment = lazy(() =>
  import('./pages/Audience').then((page) => ({ default: page.Environment })),
);
const Projects = lazy(() =>
  import('./pages/Projects').then((page) => ({ default: page.Projects })),
);
const ProjectSettings = lazy(() =>
  import('./pages/Settings').then((page) => ({ default: page.ProjectSettings })),
);
const Installation = lazy(() =>
  import('./pages/Installation').then((page) => ({ default: page.Installation })),
);
const Usage = lazy(() => import('./pages/Usage').then((page) => ({ default: page.Usage })));
const WebsiteCheck = lazy(() =>
  import('./pages/WebsiteCheck').then((page) => ({ default: page.WebsiteCheck })),
);

function ProtectedRoute() {
  const { user, loading, error, checkSession } = useAuth();
  if (loading)
    return (
      <div className="full-page">
        <Spinner />
      </div>
    );
  if (error)
    return (
      <div className="full-page">
        <div className="connection-card">
          <Logo />
          <h1>Let’s reconnect</h1>
          <Alert>{error}</Alert>
          <button className="button button-primary" onClick={checkSession}>
            Try again
          </button>
          <Link to="/login">Go to sign in</Link>
        </div>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage />} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="pages" element={<Pages />} />
        <Route path="endpoints" element={<Endpoints />} />
        <Route path="geography" element={<Geography />} />
        <Route path="environment" element={<Environment />} />
        <Route path="projects" element={<Projects />} />
        <Route path="install" element={<Installation />} />
        <Route path="usage" element={<Usage />} />
        <Route path="settings" element={<ProjectSettings />} />
        <Route path="website-check" element={<WebsiteCheck />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}

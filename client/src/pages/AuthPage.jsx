import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Braces,
  ChartNoAxesCombined,
  Clock3,
  Contrast,
  Globe2,
} from 'lucide-react';
import { useAuth } from '../context';
import { useTheme } from '../theme.jsx';
import { Alert, Logo, Spinner } from '../components/ui';

const features = [
  {
    title: 'Core Web Vitals',
    description:
      'Capture LCP, CLS, and INP directly from real user sessions to understand page performance.',
    icon: ChartNoAxesCombined,
  },
  {
    title: 'Request Interception',
    description:
      'Track fetch/XHR latency, status codes, and failed requests with the browser tracker.',
    icon: Braces,
  },
  {
    title: 'Geography & Environment',
    description:
      'Explore available location, device, browser, and connection details behind your visitors’ experience.',
    icon: Globe2,
  },
  {
    title: 'Error & Failure Tracking',
    description:
      'Find broken API requests and HTTP errors in your collected website activity.',
    icon: AlertTriangle,
  },
  {
    title: 'Performance Over Time',
    description: 'Compare traffic and response times across the selected monitoring window.',
    icon: Clock3,
  },
];

export function AuthPage() {
  const location = useLocation();
  const register = location.pathname === '/register';
  const { user, loading, login, error: connectionError } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading)
    return (
      <div className="full-page">
        <Spinner />
      </div>
    );
  if (user) return <Navigate to="/overview" replace />;

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await login(values, register);
      navigate('/overview', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section
        className="auth-form-section"
        aria-label={register ? 'Create an account' : 'Sign in'}
      >
        <img className="auth-background" src="/login-bg.webp" alt="" />
        <div className="auth-card">
          <div className="auth-card-header">
            <Link to="/login" aria-label="RUM Core home">
              <Logo />
            </Link>
            <span>rum core</span>
          </div>
          <div className="auth-card-content">
            <div className="auth-card-welcome">
              <h1>{register ? 'Sign Up' : 'Welcome back'}</h1>
              <p>
                {register
                  ? 'Create a new account to get started'
                  : 'Sign in to your account to continue'}
              </p>
            </div>
            <Alert>{error || connectionError}</Alert>
            <form className="auth-form form-stack" onSubmit={submit}>
              {register && (
                <label>
                  <span className="sr-only">Full name</span>
                  <input
                    autoComplete="name"
                    name="name"
                    value={values.name}
                    onChange={(event) => setValues({ ...values, name: event.target.value })}
                    placeholder="Name"
                    maxLength={80}
                    required
                  />
                </label>
              )}
              <label>
                <span className="sr-only">Email address</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(event) => setValues({ ...values, email: event.target.value })}
                  placeholder="Email"
                  maxLength={254}
                  required
                />
              </label>
              <label>
                <span className="sr-only">Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  value={values.password}
                  onChange={(event) => setValues({ ...values, password: event.target.value })}
                  placeholder="Password"
                  minLength={register ? 8 : 1}
                  maxLength={128}
                  required
                />
                {register && <span className="field-help">Use at least 8 characters.</span>}
              </label>
              <button
                type="submit"
                className="button button-secondary auth-submit"
                aria-label={register ? 'Create workspace' : 'Sign in'}
                disabled={submitting}
              >
                {submitting
                  ? register
                    ? 'Signing up...'
                    : 'Logging in...'
                  : register
                    ? 'Sign Up'
                    : 'Login'}
              </button>
            </form>
            <div className="auth-switch">
              <Link to={register ? '/login' : '/register'} onClick={() => setError('')}>
                {register
                  ? 'Already have an account? Login'
                  : "Don't have an account? Sign Up"}
              </Link>
            </div>
          </div>
          <div className="auth-card-footer">RUM CORE</div>
        </div>
      </section>
      <section className="auth-side-area" aria-label="About RUM Core">
        <div className="auth-side-content">
          <Logo />
          <h2>Monitor What Matters Most</h2>
          <p>
            Your dashboard is ready. Dive straight into insights on page performance, request
            success rates, and user experience the moment you sign in.
          </p>
          <div className="auth-feature-list">
            {features.map(({ title, description, icon: Icon }) => (
              <div className="auth-feature-card" key={title}>
                <Icon size={40} strokeWidth={1.5} />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <button
        className="icon-button theme-toggle auth-theme-toggle"
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (Ctrl + M)`}
      >
        <Contrast size={20} />
      </button>
    </div>
  );
}

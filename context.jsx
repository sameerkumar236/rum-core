import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);
const WorkspaceContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const checkSession = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/auth/me');
      setUser(data.user);
    } catch (err) {
      if (err.status !== 401) setError(err.message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const clearSession = () => setUser(null);
    window.addEventListener('rum-session-expired', clearSession);
    return () => window.removeEventListener('rum-session-expired', clearSession);
  }, []);

  async function login(values, register = false) {
    const data = await api(register ? '/auth/register' : '/auth/login', {
      method: 'POST',
      body: values,
    });
    setError('');
    setUser(data.user);
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function WorkspaceProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(() => localStorage.getItem('rum-project') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState('24h');
  const [refreshToken, setRefreshToken] = useState(0);

  const loadProjects = useCallback(async () => {
    setError('');
    try {
      const data = await api('/projects');
      setProjects(data.projects);
      setProjectId((current) =>
        data.projects.some((project) => project.id === current)
          ? current
          : data.projects[0]?.id || '',
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    localStorage.setItem('rum-project', projectId);
  }, [projectId]);

  const project = projects.find((item) => item.id === projectId) || null;
  const refresh = () => setRefreshToken((value) => value + 1);

  return (
    <WorkspaceContext.Provider
      value={{
        projects,
        project,
        projectId,
        setProjectId,
        loading,
        error,
        loadProjects,
        range,
        setRange,
        refreshToken,
        refresh,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);

export function useAnalytics(filters = {}) {
  const { projectId, range, refreshToken } = useWorkspace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const query = new URLSearchParams({
    range,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
  }).toString();

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    if (!projectId) return;
    setLoading(true);
    api(`/projects/${projectId}/analytics?${query}`)
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
  }, [projectId, query, refreshToken]);

  return { data, loading, error };
}

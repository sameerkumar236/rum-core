// Keep requests in one place so pages only need to describe the data they need.
const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function api(path, options = {}) {
  const response = await fetch(`${apiBase}/api${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('rum-session-expired'));
    }
    const error = new Error(
      data.error || data.message || 'The request could not be completed. Please try again.',
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function downloadCsv(projectId, range, kind, filters = {}) {
  const query = new URLSearchParams({ range, kind, ...filters });
  const response = await fetch(`${apiBase}/api/projects/${projectId}/export?${query}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('rum-session-expired'));
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'The export could not be downloaded.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `rum-core-${kind}-${range}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function getPublicApiUrl() {
  return (
    import.meta.env.VITE_PUBLIC_API_URL ||
    (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin)
  ).replace(/\/$/, '');
}

import { useState } from 'react';
import { Alert } from './ui';

export function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid website origin, such as https://example.com.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new Error(
      'Use only the website origin, such as https://example.com, without a path, query, or login details.',
    );
  }
  return url.origin;
}

export function ProjectForm({
  project,
  onSave,
  onCancel,
  submitLabel = 'Create project',
  settings = false,
}) {
  const [name, setName] = useState(project?.name || '');
  const [origin, setOrigin] = useState(project?.origin || '');
  const [collectVitals, setCollectVitals] = useState(project?.collectVitals ?? true);
  const [filterMode, setFilterMode] = useState(project?.urlFilterMode || 'all');
  const [patterns, setPatterns] = useState((project?.urlPatterns || []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const normalizedOrigin = normalizeOrigin(origin);
      const urlPatterns = patterns
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);
      if (filterMode !== 'all' && !urlPatterns.length)
        throw new Error('Add at least one URL pattern for the selected filter.');
      if (!name.trim()) throw new Error('Enter a project name.');
      setSaving(true);
      await onSave({
        name: name.trim(),
        origin: normalizedOrigin,
        collectVitals,
        urlFilterMode: filterMode,
        urlPatterns,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <Alert>{error}</Alert>
      <label>
        Project name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My website"
          maxLength={80}
          required
          autoFocus={!settings}
        />
      </label>
      <label>
        Website origin
        <input
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          type="url"
          placeholder="https://example.com"
          maxLength={2000}
          required
        />
        <span className="field-help">
          The exact origin where your tracker runs. Include the port for local development, for
          example http://localhost:5173.
        </span>
      </label>
      {settings && (
        <>
          <div className="form-divider" />
          <div className="toggle-field">
            <div>
              <label htmlFor="collect-vitals">Collect Web Vitals</label>
              <p>Measure loading speed, responsiveness, and visual stability.</p>
            </div>
            <input
              id="collect-vitals"
              className="switch"
              type="checkbox"
              checked={collectVitals}
              onChange={(event) => setCollectVitals(event.target.checked)}
            />
          </div>
          <label>
            Request URL collection rules
            <select value={filterMode} onChange={(event) => setFilterMode(event.target.value)}>
              <option value="all">Collect all request URLs</option>
              <option value="include">Only collect matching request URLs</option>
              <option value="exclude">Exclude matching request URLs</option>
            </select>
            <span className="field-help">
              Applies to request events. Page views are collected independently.
            </span>
          </label>
          {filterMode !== 'all' && (
            <label>
              URL patterns
              <textarea
                value={patterns}
                onChange={(event) => setPatterns(event.target.value)}
                rows={5}
                placeholder={'/checkout\n/api/products'}
                required
              />
              <span className="field-help">
                One literal, case-sensitive substring per line. Applies to sanitized request
                URLs only; no wildcard syntax.
              </span>
            </label>
          )}
        </>
      )}
      <div className="form-actions">
        {onCancel && (
          <button
            className="button button-secondary"
            type="button"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

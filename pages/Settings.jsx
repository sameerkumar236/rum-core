import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, KeyRound, RotateCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useWorkspace } from '../context';
import { Alert, CopyButton, Dialog, NoProject, PageHeading, Panel } from '../components/ui';
import { ProjectForm } from '../components/ProjectForm';

export function ProjectSettings() {
  const { project, loadProjects } = useWorkspace();
  const [message, setMessage] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState('');
  async function save(values) {
    await api(`/projects/${project.id}`, { method: 'PATCH', body: values });
    await loadProjects();
    setMessage(
      'Project settings saved. Reload pages with the tracker to pick up collection changes.',
    );
  }
  async function rotate() {
    setRotating(true);
    setError('');
    try {
      await api(`/projects/${project.id}/rotate-key`, { method: 'POST' });
      await loadProjects();
      setConfirmRotate(false);
      setMessage(
        'Tracking key rotated. Update the snippet on your website to resume collection.',
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setRotating(false);
    }
  }
  if (!project)
    return (
      <>
        <PageHeading title="Settings" description="Project Settings" />
        <NoProject />
      </>
    );
  return (
    <>
      <PageHeading
        title="Settings"
        description={
          <>
            Project settings for <span className="text-strong">{project.name}</span>.
          </>
        }
      />
      <Alert variant="success" onDismiss={() => setMessage('')}>
        {message}
      </Alert>
      <div className="settings-grid">
        <Panel title="Project & collection" description="Control what your tracker collects.">
          <div className="panel-body">
            <ProjectForm
              key={project.id}
              project={project}
              onSave={save}
              submitLabel="Save changes"
              settings
            />
          </div>
        </Panel>
        <div className="settings-side">
          <Panel
            title="Public tracking key"
            description="Identifies the project receiving browser events."
          >
            <div className="panel-body">
              <div className="key-display">
                <KeyRound size={16} />
                <code>{project.key}</code>
              </div>
              <div className="key-actions">
                <CopyButton value={project.key} label="Copy key" />
                <button
                  className="button button-small button-secondary"
                  onClick={() => {
                    setError('');
                    setConfirmRotate(true);
                  }}
                >
                  <RotateCw size={13} />
                  Rotate key
                </button>
              </div>
              <p className="field-help key-explanation">
                This is a public browser key. Keep your website origin accurate to restrict
                collection to your site.
              </p>
              <Link to="/install" className="text-link">
                View installation snippet <ArrowRight size={14} />
              </Link>
            </div>
          </Panel>
          <div className="privacy-note">
            <ShieldCheck size={24} strokeWidth={1.5} />
            <h3>Collection privacy</h3>
            <p>
              URL filters apply to request events only. Page views are collected independently.
              Keep the tracker disabled on sensitive pages and check your site’s consent
              requirements.
            </p>
          </div>
        </div>
      </div>
      {confirmRotate && (
        <Dialog
          title="Rotate tracking key?"
          description="The current key will stop accepting events immediately. Update the tracker snippet on every page after rotating it."
          onClose={() => {
            if (!rotating) setConfirmRotate(false);
          }}
        >
          <Alert>{error}</Alert>
          <div className="form-actions">
            <button
              className="button button-secondary"
              disabled={rotating}
              onClick={() => setConfirmRotate(false)}
            >
              Cancel
            </button>
            <button className="button button-primary" disabled={rotating} onClick={rotate}>
              {rotating ? 'Rotating…' : 'Rotate key'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

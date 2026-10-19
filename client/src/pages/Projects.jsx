import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useWorkspace } from '../context';
import { Alert, Dialog, EmptyState, PageHeading } from '../components/ui';
import { ProjectForm } from '../components/ProjectForm';

export function Projects() {
  const { projects, projectId, setProjectId, loadProjects } = useWorkspace();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteName, setDeleteName] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function save(values) {
    const result = await api(editing ? `/projects/${editing.id}` : '/projects', {
      method: editing ? 'PATCH' : 'POST',
      body: values,
    });
    await loadProjects();
    setProjectId(result.project.id);
    setMessage(
      editing
        ? 'Project details updated.'
        : 'Project created. Install the tracker to start collecting insights.',
    );
    setCreating(false);
    setEditing(null);
  }

  async function remove(event) {
    event.preventDefault();
    setDeletingBusy(true);
    setError('');
    try {
      await api(`/projects/${deleting.id}`, { method: 'DELETE' });
      await loadProjects();
      setDeleting(null);
      setMessage('Project and its collected data deleted.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingBusy(false);
    }
  }

  function openProject(id) {
    setProjectId(id);
    navigate('/overview');
  }

  return (
    <>
      <PageHeading
        title="Projects"
        action={
          <button
            className="button button-primary"
            aria-label="New project"
            onClick={() => {
              setMessage('');
              setCreating(true);
            }}
          >
            <Plus size={16} />
            Add Project
          </button>
        }
      />
      <Alert variant="success" onDismiss={() => setMessage('')}>
        {message}
      </Alert>
      {projects.length ? (
        <div className="projects-table table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Origin</th>
                <th>Collection</th>
                <th>Created</th>
                <th className="project-actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <div className="project-table-title">
                      <h2 className="project-table-name">{project.name}</h2>
                      {project.id === projectId && (
                        <span className="selected-project-badge">Selected</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <a
                      className="project-origin"
                      href={project.origin}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {project.origin}
                      <ArrowUpRight size={13} />
                    </a>
                  </td>
                  <td>
                    {project.collectVitals ? 'Web Vitals enabled' : 'Web Vitals disabled'}
                  </td>
                  <td>
                    {new Date(project.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td>
                    <div className="project-table-actions">
                      <button
                        className="button button-small button-secondary"
                        onClick={() => openProject(project.id)}
                      >
                        Select
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => setEditing(project)}
                        aria-label={`Edit ${project.name}`}
                        title="Edit project"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => {
                          setDeleting(project);
                          setDeleteName('');
                          setError('');
                        }}
                        aria-label={`Delete ${project.name}`}
                        title="Delete project"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title="No projects found"
          description="Create a project and install the tracker to collect visitor data."
          action={
            <button className="button button-primary" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create first project
            </button>
          }
        />
      )}
      {(creating || editing) && (
        <Dialog
          title={editing ? 'Edit project' : 'Create a project'}
          image="/dialog-add-edit.webp"
          description="Give your website a name and tell us where it lives."
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <ProjectForm
            key={editing?.id || 'new'}
            project={editing}
            onSave={save}
            submitLabel={editing ? 'Save changes' : 'Create project'}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title="Delete this project?"
          image="/dialog-delete.webp"
          description="This permanently deletes the project and its collected events. Your tracker will stop accepting new events for this key."
          onClose={() => {
            if (!deletingBusy) setDeleting(null);
          }}
        >
          <form className="form-stack" onSubmit={remove}>
            <Alert>{error}</Alert>
            <label>
              Type <strong>{deleting.name}</strong> to confirm
              <input
                value={deleteName}
                onChange={(event) => setDeleteName(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={deletingBusy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-danger"
                disabled={deleteName !== deleting.name || deletingBusy}
              >
                {deletingBusy ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

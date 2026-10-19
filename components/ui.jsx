import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWorkspace } from '../context';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

export function Logo({ compact = true }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <span>rum</span>
        <span>CORE°</span>
      </span>
      {!compact && <span>RUM CORE</span>}
    </span>
  );
}

export function Spinner({ label = 'Loading your workspace…' }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={25} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function Alert({ children, variant = 'error', onDismiss }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onDismiss && (
        <button
          type="button"
          className="icon-button"
          onClick={onDismiss}
          aria-label="Dismiss message"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
  icon: Icon = Inbox,
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.6} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function NoProject() {
  return (
    <EmptyState
      title="Your first insight starts here"
      description="Create a project, add the lightweight tracker to your website, and start understanding your visitors’ experience."
      action={
        <Link to="/projects" className="button button-primary">
          Create a project
        </Link>
      }
    />
  );
}

export function UrlCheckerLink() {
  return (
    <Link className="text-link url-check-link" to="/website-check">
      Check a URL without installing the tracker <ArrowRight size={14} />
    </Link>
  );
}

export function PageHeading({ title, description, action }) {
  const workspace = useWorkspace();
  const { pathname } = useLocation();
  const showRange = [
    '/overview',
    '/pages',
    '/endpoints',
    '/geography',
    '/environment',
  ].includes(pathname);
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {(action || (workspace && showRange)) && (
        <div className="heading-actions">
          {action}
          {workspace && showRange && (
            <div className="analytics-controls">
              <label className="range-select">
                <span className="sr-only">Time range</span>
                <select
                  value={workspace.range}
                  onChange={(event) => workspace.setRange(event.target.value)}
                >
                  <option value="12h">Last 12 hours</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </label>
              <button
                type="button"
                className="icon-button refresh-button"
                onClick={workspace.refresh}
                aria-label="Refresh analytics"
                title="Refresh analytics"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Panel({ title, description, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MetricCard({ label, value, detail, icon: Icon, accent = false }) {
  return (
    <div className={`metric-card ${accent ? 'metric-accent' : ''}`}>
      <div className="metric-label">
        {label}
        {Icon && <Icon size={17} strokeWidth={1.7} />}
      </div>
      <div className="metric-value">{value}</div>
      {detail && <div className="metric-detail">{detail}</div>}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setError('');
    try {
      if (!navigator.clipboard)
        throw new Error('Clipboard access is unavailable. Please select and copy the text.');
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (err) {
      setError(err.message || 'Could not copy. Please select and copy the text.');
    }
  }
  return (
    <span className="copy-control">
      <button type="button" className="button button-small button-secondary" onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Copied' : label}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export function Dialog({ title, description, children, onClose, image }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const close = (event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', close);
    return () => {
      dialog.removeEventListener('cancel', close);
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${image ? 'dialog-with-image' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      {image && (
        <div className="dialog-artwork">
          <img src={image} alt="" />
        </div>
      )}
      <div className="dialog-body">
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {description && (
          <p className="dialog-description" id={descriptionId}>
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}

export function DataTable({
  columns,
  rows = [],
  searchPlaceholder = 'Search…',
  emptyTitle = 'No results found',
  emptyDescription = 'Try another search or select a different time range.',
  searchable = true,
  pageSize = 10,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: '', direction: 'desc' });
  const [page, setPage] = useState(0);
  const searchId = useId();
  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    const list = rows.filter(
      (row) =>
        !query ||
        columns.some((column) =>
          String(column.searchValue ? column.searchValue(row) : (row[column.key] ?? ''))
            .toLowerCase()
            .includes(query),
        ),
    );
    const column = columns.find((item) => item.key === sort.key);
    if (column)
      list.sort((a, b) => {
        const first = column.sortValue ? column.sortValue(a) : a[column.key];
        const second = column.sortValue ? column.sortValue(b) : b[column.key];
        const result =
          typeof first === 'number'
            ? first - second
            : String(first ?? '').localeCompare(String(second ?? ''));
        return sort.direction === 'asc' ? result : -result;
      });
    return list;
  }, [rows, columns, search, sort]);
  useEffect(() => {
    setPage(0);
  }, [search, rows]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  function changeSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
    setPage(0);
  }
  return (
    <div className="data-table">
      {searchable && (
        <div className="table-toolbar">
          <label className="search-input" htmlFor={searchId}>
            <Search size={16} />
            <input
              id={searchId}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
            />
            <span className="sr-only">{searchPlaceholder}</span>
          </label>
          <span className="subtle">
            {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort.key === column.key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button type="button" onClick={() => changeSort(column.key)}>
                    {column.label}
                    {sort.key !== column.key ? (
                      <ArrowUpDown size={12} />
                    ) : sort.direction === 'asc' ? (
                      <ArrowUp size={12} />
                    ) : (
                      <ArrowDown size={12} />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
              .map((row, index) => (
                <tr
                  key={
                    row.id ||
                    `${index}-${row.pageUrl || row.url || row.name || row.country || ''}`
                  }
                >
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.render ? column.render(row) : (row[column.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="table-footer">
          <span>
            Showing {currentPage * pageSize + 1}–
            {Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="pagination">
            <button
              type="button"
              className="icon-button"
              onClick={() => setPage((value) => value - 1)}
              disabled={currentPage === 0}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setPage((value) => value + 1)}
              disabled={currentPage >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

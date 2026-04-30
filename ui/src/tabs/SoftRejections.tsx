import { useState, useEffect } from 'react';
import { getSoftRejections } from '../api';
import type { SoftRejectionRow, Stats } from '../api';
import { JobCard } from '../components/JobCard';

type StatusFilter = 'all' | 'unreviewed' | 'reviewed';

interface Props {
  onStatsUpdate: (s: Stats) => void;
}

export function SoftRejections({ onStatsUpdate }: Props) {
  const [rows, setRows] = useState<SoftRejectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unreviewed');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    getSoftRejections()
      .then(setRows)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const sources = Array.from(new Set(rows.map(r => r.source))).sort();

  const filtered = rows.filter(row => {
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
    if (statusFilter === 'unreviewed') return row.label === null;
    if (statusFilter === 'reviewed') return row.label !== null;
    return true;
  });

  return (
    <div>
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          {(['all', 'unreviewed', 'reviewed'] as StatusFilter[]).map(s => (
            <button
              key={s}
              className={`filter-btn${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Source:</span>
          {(['all', ...sources]).map(s => (
            <button
              key={s}
              className={`filter-btn${sourceFilter === s ? ' active' : ''}`}
              onClick={() => setSourceFilter(s)}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      <div className="card-count">{filtered.length} jobs</div>

      {filtered.map(row => (
        <JobCard
          key={`${row.job_id}-${row.run_id}`}
          mode="soft-reject"
          row={row}
          onStatsUpdate={onStatsUpdate}
        />
      ))}

      {filtered.length === 0 && <div className="empty">No jobs match this filter.</div>}
    </div>
  );
}

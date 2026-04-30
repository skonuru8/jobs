import { useState, useEffect } from 'react';
import { getHardRejections } from '../api';
import type { HardRejectionRow, Stats } from '../api';
import { JobCard } from '../components/JobCard';

type StatusFilter = 'all' | 'unreviewed' | 'reviewed';

interface Props {
  onStatsUpdate: (s: Stats) => void;
}

export function HardRejections({ onStatsUpdate }: Props) {
  const [rows, setRows] = useState<HardRejectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unreviewed');
  const [reasonFilter, setReasonFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    getHardRejections()
      .then(setRows)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const reasons = Array.from(new Set(rows.map(r => r.reason))).sort();

  const filtered = rows.filter(row => {
    if (reasonFilter !== 'all' && row.reason !== reasonFilter) return false;
    if (statusFilter === 'unreviewed') return row.label === null;
    if (statusFilter === 'reviewed') return row.label !== null;
    return true;
  });

  // Group by reason (preserve server order: reason ASC, scraped_at DESC)
  const groups: Record<string, HardRejectionRow[]> = {};
  for (const row of filtered) {
    if (!groups[row.reason]) groups[row.reason] = [];
    groups[row.reason].push(row);
  }

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
          <span className="filter-label">Reason:</span>
          <select
            className="filter-select"
            value={reasonFilter}
            onChange={e => setReasonFilter(e.target.value)}
          >
            <option value="all">All reasons</option>
            {reasons.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="card-count">{filtered.length} jobs</div>

      {Object.entries(groups).map(([reason, groupRows]) => (
        <div key={reason} className="reason-group">
          <div className="reason-group-header">
            {reason} <span className="reason-count">({groupRows.length})</span>
          </div>
          {groupRows.map(row => (
            <JobCard
              key={`${row.job_id}-${row.run_id}`}
              mode="hard-reject"
              row={row}
              onStatsUpdate={onStatsUpdate}
            />
          ))}
        </div>
      ))}

      {filtered.length === 0 && <div className="empty">No jobs match this filter.</div>}
    </div>
  );
}

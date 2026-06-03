import { useState, useEffect } from 'react';
import { getHardRejections } from '../api';
import type { HardRejectionRow, Stats } from '../api';
import { DetailPanel } from '../components/DetailPanel';
import { JobCard } from '../components/JobCard';

type StatusFilter = 'all' | 'unreviewed' | 'reviewed';

interface Props {
  onStatsUpdate: (s: Stats) => void;
  refreshKey?: number;
  searchQuery: string;
}

export function HardRejections({ onStatsUpdate, refreshKey, searchQuery }: Props) {
  const [rows, setRows] = useState<HardRejectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unreviewed');
  const [reasonFilter, setReasonFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    getHardRejections()
      .then(data => {
        setRows(data);
        setSelectedJobId(null);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const reasons = Array.from(new Set(rows.map(r => r.reason))).sort();

  const statusCounts: Record<StatusFilter, number> = {
    all: rows.length,
    unreviewed: rows.filter(r => r.label === null).length,
    reviewed: rows.filter(r => r.label !== null).length,
  };

  const filtered = rows.filter(row => {
    if (reasonFilter !== 'all' && row.reason !== reasonFilter) return false;
    if (statusFilter === 'unreviewed') return row.label === null;
    if (statusFilter === 'reviewed') return row.label !== null;
    return true;
  }).filter(row => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return row.title.toLowerCase().includes(q) || row.company.toLowerCase().includes(q);
  });

  // Group by reason (preserve server order: reason ASC, scraped_at DESC)
  const groups: Record<string, HardRejectionRow[]> = {};
  for (const row of filtered) {
    if (!groups[row.reason]) groups[row.reason] = [];
    groups[row.reason].push(row);
  }

  const selectedRow = selectedJobId
    ? rows.find(r => r.job_id === selectedJobId) ?? null
    : null;

  return (
    <div className="tab-body">
      <div className="tab-main">
        <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          {(['all', 'unreviewed', 'reviewed'] as StatusFilter[]).map(s => (
            <button
              key={s}
              className={`filter-btn${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)} <span className="filter-count">({statusCounts[s]})</span>
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
                selected={selectedJobId === row.job_id}
                onSelect={() => setSelectedJobId(prev => prev === row.job_id ? null : row.job_id)}
                onDataChange={() => {
                  getHardRejections()
                    .then(data => { setRows(data); })
                    .catch(e => setError((e as Error).message));
                }}
              />
            ))}
          </div>
        ))}

        {filtered.length === 0 && <div className="empty">No jobs match this filter.</div>}
      </div>

      {selectedRow && (
        <DetailPanel
          row={selectedRow}
          mode="hard-reject"
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  );
}

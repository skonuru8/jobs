import { useState, useEffect } from 'react';
import { getSoftRejections } from '../api';
import type { SoftRejectionRow, Stats } from '../api';
import { DetailPanel } from '../components/DetailPanel';
import { JobCard } from '../components/JobCard';

type StatusFilter = 'all' | 'unreviewed' | 'reviewed';

interface Props {
  onStatsUpdate: (s: Stats) => void;
  refreshKey?: number;
}

export function SoftRejections({ onStatsUpdate, refreshKey }: Props) {
  const [rows, setRows] = useState<SoftRejectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unreviewed');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    getSoftRejections()
      .then(data => {
        setRows(data);
        setSelectedJobId(null);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const sources = Array.from(new Set(rows.map(r => r.source))).sort();

  const statusCounts: Record<StatusFilter, number> = {
    all: rows.length,
    unreviewed: rows.filter(r => r.label === null).length,
    reviewed: rows.filter(r => r.label !== null).length,
  };

  const filtered = rows.filter(row => {
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
    if (statusFilter === 'unreviewed') return row.label === null;
    if (statusFilter === 'reviewed') return row.label !== null;
    return true;
  });

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
            selected={selectedJobId === row.job_id}
            onSelect={() => setSelectedJobId(prev => prev === row.job_id ? null : row.job_id)}
            onDataChange={() => {
              getSoftRejections()
                .then(data => { setRows(data); })
                .catch(e => setError((e as Error).message));
            }}
          />
        ))}

        {filtered.length === 0 && <div className="empty">No jobs match this filter.</div>}
      </div>

      {selectedRow && (
        <DetailPanel
          row={selectedRow}
          mode="soft-reject"
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  );
}

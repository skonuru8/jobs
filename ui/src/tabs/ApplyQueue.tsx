import { useState, useEffect } from 'react';
import { getApplyQueue } from '../api';
import type { ApplyQueueRow, Stats } from '../api';
import { DetailPanel } from '../components/DetailPanel';
import { JobCard } from '../components/JobCard';

type StatusFilter = 'pending' | 'apply_later' | 'applied' | 'not_applied' | 'all';
type BucketFilter = 'all' | 'COVER_LETTER' | 'REVIEW_QUEUE' | 'RESULTS';
type SourceFilter = 'all' | string;

const STATUS_LABELS: Record<StatusFilter, string> = {
  pending: 'Pending',
  apply_later: 'Apply Later',
  applied: 'Applied',
  not_applied: 'Not Applied',
  all: 'All',
};

interface Props {
  onStatsUpdate: (s: Stats) => void;
  refreshKey?: number;
}

export function ApplyQueue({ onStatsUpdate, refreshKey }: Props) {
  const [rows, setRows] = useState<ApplyQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  useEffect(() => {
    setLoading(true);
    getApplyQueue()
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
    pending: rows.filter(r => r.application_status == null && r.label !== 'no').length,
    apply_later: rows.filter(r => r.application_status === 'apply_later').length,
    applied: rows.filter(r => r.application_status === 'applied').length,
    not_applied: rows.filter(r => r.label === 'no' || r.application_status === 'skipped').length,
    all: rows.length,
  };

  const filtered = rows.filter(row => {
    if (bucketFilter !== 'all' && row.bucket !== bucketFilter) return false;
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
    switch (statusFilter) {
      case 'pending':
        return row.application_status == null && row.label !== 'no';
      case 'apply_later':
        return row.application_status === 'apply_later';
      case 'applied':
        return row.application_status === 'applied';
      case 'not_applied':
        return row.label === 'no' || row.application_status === 'skipped';
      default:
        return true;
    }
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
          {(['pending', 'apply_later', 'applied', 'not_applied', 'all'] as StatusFilter[]).map(s => (
            <button
              key={s}
              className={`filter-btn${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {STATUS_LABELS[s]} <span className="filter-count">({statusCounts[s]})</span>
            </button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Bucket:</span>
          {(['all', 'COVER_LETTER', 'REVIEW_QUEUE', 'RESULTS'] as const).map(b => (
            <button
              key={b}
              className={`filter-btn${bucketFilter === b ? ' active' : ''}`}
              onClick={() => setBucketFilter(b)}
            >
              {b === 'all' ? 'All' : b.replace(/_/g, ' ')}
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
            mode="apply"
            row={row}
            onStatsUpdate={onStatsUpdate}
            selected={selectedJobId === row.job_id}
            onSelect={() => setSelectedJobId(prev => prev === row.job_id ? null : row.job_id)}
            onDataChange={() => {
              getApplyQueue()
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
          mode="apply"
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  );
}

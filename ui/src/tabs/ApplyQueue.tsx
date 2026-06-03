import { useState, useEffect, useMemo, useRef } from 'react';
import { getApplyQueue, getStats, postLabel } from '../api';
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
  searchQuery: string;
}

export function ApplyQueue({ onStatsUpdate, refreshKey, searchQuery }: Props) {
  const [rows, setRows] = useState<ApplyQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [kbIndex, setKbIndex] = useState<number>(-1);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  const sources = Array.from(new Set(rows.map(r => r.source))).sort();

  const statusCounts: Record<StatusFilter, number> = {
    pending: rows.filter(r => r.application_status == null && r.label !== 'no').length,
    apply_later: rows.filter(r => r.application_status === 'apply_later').length,
    applied: rows.filter(r => r.application_status === 'applied').length,
    not_applied: rows.filter(r => r.label === 'no' || r.application_status === 'skipped').length,
    all: rows.length,
  };

  const filtered = useMemo(() => rows.filter(row => {
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
  }).filter(row => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return row.title.toLowerCase().includes(q) || row.company.toLowerCase().includes(q);
  }), [rows, bucketFilter, sourceFilter, statusFilter, searchQuery]);

  const appliedDays = useMemo(() => {
    if (statusFilter !== 'applied') return [];
    const dayMap = new Map<string, number>();
    rows
      .filter(row => row.application_status === 'applied' && row.applied_at)
      .forEach(row => {
        const iso = new Date(row.applied_at!).toISOString().slice(0, 10);
        dayMap.set(iso, (dayMap.get(iso) ?? 0) + 1);
      });
    return Array.from(dayMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([iso, count]) => ({
        date: iso,
        count,
        label: new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      }));
  }, [rows, statusFilter]);

  const filteredWithDay = useMemo(() => {
    if (statusFilter !== 'applied' || dayFilter === 'all') return filtered;
    return filtered.filter(row => {
      if (!row.applied_at) return false;
      return new Date(row.applied_at).toISOString().slice(0, 10) === dayFilter;
    });
  }, [filtered, statusFilter, dayFilter]);

  useEffect(() => {
    setKbIndex(filteredWithDay.length ? 0 : -1);
    cardRefs.current = [];
  }, [filteredWithDay.length, searchQuery, statusFilter, bucketFilter, sourceFilter, dayFilter]);

  const selectedRow = selectedJobId
    ? rows.find(r => r.job_id === selectedJobId) ?? null
    : null;

  async function labelFocused(label: 'yes' | 'maybe' | 'no', applicationStatus?: 'applied' | 'skipped' | 'apply_later' | null) {
    const row = filteredWithDay[kbIndex];
    if (!row) return;
    await postLabel({
      job_id: row.job_id,
      run_id: row.run_id,
      label,
      application_status: applicationStatus ?? null,
      notes: null,
    });
    const [data, fresh] = await Promise.all([getApplyQueue(), getStats()]);
    setRows(data);
    onStatsUpdate(fresh);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const len = filteredWithDay.length;
      if (!len) return;
      if (e.key === 'j') {
        e.preventDefault();
        setKbIndex(i => Math.min(i + 1, len - 1));
      }
      if (e.key === 'k') {
        e.preventDefault();
        setKbIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && kbIndex >= 0) {
        e.preventDefault();
        const row = filteredWithDay[kbIndex];
        setSelectedJobId(prev => prev === row.job_id ? null : row.job_id);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedJobId(null);
        setKbIndex(-1);
      }
      if (e.key === 'y') {
        e.preventDefault();
        void labelFocused('yes');
      }
      if (e.key === 'm') {
        e.preventDefault();
        void labelFocused('maybe');
      }
      if (e.key === 'n') {
        e.preventDefault();
        void labelFocused('no', 'skipped');
      }
      if (e.key === 'a') {
        e.preventDefault();
        void labelFocused('yes', 'applied');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredWithDay, kbIndex]);

  useEffect(() => {
    cardRefs.current[kbIndex]?.scrollIntoView({ block: 'nearest' });
  }, [kbIndex]);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

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

        {statusFilter === 'applied' && appliedDays.length > 0 && (
          <div className="day-filter-bar">
            <span className="day-filter-label">Day</span>
            <button
              className={`day-btn${dayFilter === 'all' ? ' active' : ''}`}
              onClick={() => setDayFilter('all')}
            >
              All
            </button>
            {appliedDays.map(day => (
              <button
                key={day.date}
                className={`day-btn${dayFilter === day.date ? ' active' : ''}`}
                onClick={() => setDayFilter(day.date)}
              >
                {day.label} <span style={{ opacity: .6, fontSize: '10px', marginLeft: 3 }}>({day.count})</span>
              </button>
            ))}
          </div>
        )}

        <div className="card-count">{filteredWithDay.length} jobs</div>

        {filteredWithDay.map((row, idx) => (
          <div
            key={`${row.job_id}-${row.run_id}`}
            ref={el => { cardRefs.current[idx] = el; }}
            className={kbIndex === idx ? 'kb-focused' : ''}
          >
            <JobCard
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
          </div>
        ))}

        {filteredWithDay.length === 0 && <div className="empty">No jobs match this filter.</div>}
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

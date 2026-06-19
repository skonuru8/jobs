import { useState, useEffect, useMemo } from 'react';
import { getSoftRejections } from '../api';
import type { SoftRejectionRow, Stats } from '../api';
import { Segmented } from '../components/Segmented';
import type { SegOption } from '../components/Segmented';
import { CardList } from '../components/CardList';

type StatusFilter = 'all' | 'unreviewed' | 'reviewed';

interface Props { onStatsUpdate: (s: Stats) => void; refreshKey?: number; searchQuery: string; sortBy?: 'time' | 'score'; sortDir?: 'asc' | 'desc'; }

export function SoftRejections({ onStatsUpdate, refreshKey, searchQuery, sortBy, sortDir }: Props) {
  const [rows, setRows] = useState<SoftRejectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('unreviewed');
  const [src, setSrc] = useState<string>('all');

  const reload = () => getSoftRejections().then(setRows).catch(e => setError((e as Error).message));
  useEffect(() => {
    setLoading(true);
    getSoftRejections().then(setRows).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [refreshKey]);

  const sources = useMemo(() => Array.from(new Set(rows.map(r => r.source))).sort(), [rows]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const counts: Record<StatusFilter, number> = {
    all: rows.length,
    unreviewed: rows.filter(r => r.label === null).length,
    reviewed: rows.filter(r => r.label !== null).length,
  };
  const filtered = rows
    .filter(r => src === 'all' || r.source === src)
    .filter(r => status === 'unreviewed' ? r.label === null : status === 'reviewed' ? r.label !== null : true);

  const statusOpts: SegOption<StatusFilter>[] = (['unreviewed', 'reviewed', 'all'] as StatusFilter[]).map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1), count: counts[s] }));
  const sourceOpts: SegOption<string>[] = ['all', ...sources].map(s => ({ value: s, label: s === 'all' ? 'All' : s.replace(/_/g, ' ') }));

  return (
    <div className="content-inner">
      <div className="filters">
        <div className="fgroup"><span className="fgroup-lbl">Status</span><Segmented value={status} options={statusOpts} onChange={setStatus} /></div>
        <div className="fgroup"><span className="fgroup-lbl">Source</span><Segmented value={src} options={sourceOpts} onChange={setSrc} /></div>
      </div>
      <div className="count-line"><span className="count-num">{filtered.length}</span><span className="count-word">scored below threshold</span></div>
      <CardList rows={filtered} mode="soft-reject" searchQuery={searchQuery} onStatsUpdate={onStatsUpdate} onDataChange={reload} swapKey={`${status}|${src}`} emptyHint="No soft rejections match this filter." sortBy={sortBy} sortDir={sortDir} />
    </div>
  );
}

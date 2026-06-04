import { useState, useEffect } from 'react';
import { getHardRejections } from '../api';
import type { HardRejectionRow, Stats } from '../api';
import { Segmented } from '../components/Segmented';
import type { SegOption } from '../components/Segmented';
import { CardList } from '../components/CardList';

type StatusFilter = 'all' | 'unreviewed' | 'reviewed';

interface Props { onStatsUpdate: (s: Stats) => void; refreshKey?: number; searchQuery: string; }

export function HardRejections({ onStatsUpdate, refreshKey, searchQuery }: Props) {
  const [rows, setRows] = useState<HardRejectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('unreviewed');

  const reload = () => getHardRejections().then(setRows).catch(e => setError((e as Error).message));
  useEffect(() => {
    setLoading(true);
    getHardRejections().then(setRows).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const counts: Record<StatusFilter, number> = {
    all: rows.length,
    unreviewed: rows.filter(r => r.label === null).length,
    reviewed: rows.filter(r => r.label !== null).length,
  };
  const filtered = rows.filter(r => status === 'unreviewed' ? r.label === null : status === 'reviewed' ? r.label !== null : true);
  const opts: SegOption<StatusFilter>[] = (['unreviewed', 'reviewed', 'all'] as StatusFilter[]).map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1), count: counts[s] }));

  return (
    <div className="content-inner">
      <div className="filters">
        <div className="fgroup"><span className="fgroup-lbl">Status</span><Segmented value={status} options={opts} onChange={setStatus} /></div>
      </div>
      <div className="count-line"><span className="count-num">{filtered.length}</span><span className="count-word">filtered before scoring</span></div>
      <CardList rows={filtered} mode="hard-reject" searchQuery={searchQuery} onStatsUpdate={onStatsUpdate} onDataChange={reload} swapKey={status} emptyHint="No rejections match this filter." />
    </div>
  );
}

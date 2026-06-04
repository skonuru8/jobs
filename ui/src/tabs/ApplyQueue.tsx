import { useState, useEffect, useMemo } from 'react';
import { getApplyQueue } from '../api';
import type { ApplyQueueRow, Stats } from '../api';
import { Segmented } from '../components/Segmented';
import type { SegOption } from '../components/Segmented';
import { CardList } from '../components/CardList';

type StatusFilter = 'pending' | 'apply_later' | 'applied' | 'not_applied' | 'all';
type BucketFilter = 'all' | 'COVER_LETTER' | 'REVIEW_QUEUE' | 'RESULTS';

interface Props {
  onStatsUpdate: (s: Stats) => void;
  refreshKey?: number;
  searchQuery: string;
}

const SL: Record<StatusFilter, string> = { pending: 'Pending', apply_later: 'Later', applied: 'Applied', not_applied: 'Not applied', all: 'All' };
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export function ApplyQueue({ onStatsUpdate, refreshKey, searchQuery }: Props) {
  const [rows, setRows] = useState<ApplyQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [bucket, setBucket] = useState<BucketFilter>('all');
  const [src, setSrc] = useState<string>('all');
  const [day, setDay] = useState<string>('all');

  const reload = () => getApplyQueue().then(setRows).catch(e => setError((e as Error).message));

  useEffect(() => {
    setLoading(true);
    getApplyQueue().then(setRows).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [refreshKey]);

  const sources = useMemo(() => Array.from(new Set(rows.map(r => r.source))).sort(), [rows]);
  const counts: Record<StatusFilter, number> = {
    pending: rows.filter(r => r.application_status == null && r.label !== 'no').length,
    apply_later: rows.filter(r => r.application_status === 'apply_later').length,
    applied: rows.filter(r => r.application_status === 'applied').length,
    not_applied: rows.filter(r => r.label === 'no' || r.application_status === 'skipped').length,
    all: rows.length,
  };

  const filtered = useMemo(() => rows.filter(r => {
    if (bucket !== 'all' && r.bucket !== bucket) return false;
    if (src !== 'all' && r.source !== src) return false;
    switch (status) {
      case 'pending': return r.application_status == null && r.label !== 'no';
      case 'apply_later': return r.application_status === 'apply_later';
      case 'applied': return r.application_status === 'applied';
      case 'not_applied': return r.label === 'no' || r.application_status === 'skipped';
      default: return true;
    }
  }), [rows, status, bucket, src]);

  const appliedDays = useMemo(() => {
    if (status !== 'applied') return [];
    const m = new Map<string, number>();
    rows.filter(r => r.application_status === 'applied' && r.applied_at).forEach(r => {
      const iso = new Date(r.applied_at!).toISOString().slice(0, 10);
      m.set(iso, (m.get(iso) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]))
      .map(([iso, count]) => ({ iso, count, label: new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }));
  }, [rows, status]);

  const finalRows = useMemo(() => {
    if (status !== 'applied' || day === 'all') return filtered;
    return filtered.filter(r => r.applied_at && new Date(r.applied_at).toISOString().slice(0, 10) === day);
  }, [filtered, status, day]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;

  const statusOpts: SegOption<StatusFilter>[] = (Object.keys(SL) as StatusFilter[]).map(s => ({ value: s, label: SL[s], count: counts[s] }));
  const bucketOpts: SegOption<BucketFilter>[] = (['all', 'COVER_LETTER', 'REVIEW_QUEUE', 'RESULTS'] as BucketFilter[]).map(b => ({ value: b, label: b === 'all' ? 'All' : titleCase(b) }));
  const sourceOpts: SegOption<string>[] = ['all', ...sources].map(s => ({ value: s, label: s === 'all' ? 'All' : s.replace(/_/g, ' ') }));

  return (
    <div className="content-inner">
      <div className="filters">
        <div className="fgroup"><span className="fgroup-lbl">Status</span><Segmented value={status} options={statusOpts} onChange={setStatus} /></div>
        <div className="fgroup"><span className="fgroup-lbl">Bucket</span><Segmented value={bucket} options={bucketOpts} onChange={setBucket} /></div>
        <div className="fgroup"><span className="fgroup-lbl">Source</span><Segmented value={src} options={sourceOpts} onChange={setSrc} /></div>
      </div>

      {status === 'applied' && appliedDays.length > 0 && (
        <div className="day-tabs">
          <button className={`daytab${day === 'all' ? ' on' : ''}`} onClick={() => setDay('all')}>All <span className="c">{filtered.length}</span></button>
          {appliedDays.map(d => (
            <button key={d.iso} className={`daytab${day === d.iso ? ' on' : ''}`} onClick={() => setDay(d.iso)}>{d.label} <span className="c">{d.count}</span></button>
          ))}
        </div>
      )}

      <div className="count-line"><span className="count-num">{finalRows.length}</span><span className="count-word">role{finalRows.length !== 1 ? 's' : ''} in view</span></div>

      <CardList rows={finalRows} mode="apply" searchQuery={searchQuery} onStatsUpdate={onStatsUpdate} onDataChange={reload} swapKey={`${status}|${bucket}|${src}|${day}`} emptyHint="No roles match this filter." />
    </div>
  );
}

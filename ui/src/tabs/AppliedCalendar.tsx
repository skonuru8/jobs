import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { getAppliedJobs, getStats } from '../api';
import type { ApplyQueueRow, Stats } from '../api';
import { JobCard } from '../components/JobCard';

interface Props { onStatsUpdate: (s: Stats) => void; refreshKey?: number; }

export function AppliedCalendar({ onStatsUpdate, refreshKey }: Props) {
  const [rows, setRows] = useState<ApplyQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string>('all');

  useEffect(() => {
    setLoading(true); setError(null);
    getAppliedJobs().then(setRows).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
    getStats().then(onStatsUpdate).catch(() => undefined);
  }, [refreshKey, onStatsUpdate]);

  const groups = useMemo(() => {
    const m = new Map<string, ApplyQueueRow[]>();
    rows.forEach(r => {
      const k = r.applied_at ? new Date(r.applied_at).toISOString().slice(0, 10) : 'unknown';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const label = (k: string) => {
    if (k === 'unknown') return 'Unknown date';
    if (k === todayKey) return 'Today';
    const diff = Math.round((new Date(todayKey).getTime() - new Date(k).getTime()) / 86400000);
    if (diff === 1) return 'Yesterday';
    return new Date(`${k}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;
  if (!rows.length) return <div className="content-inner"><div className="empty"><h4>No applications yet</h4><p>Roles you mark “Applied” will appear here, grouped by day.</p></div></div>;

  const shown = day === 'all' ? groups : groups.filter(([k]) => k === day);

  return (
    <div className="content-inner">
      <div className="day-tabs">
        <button className={`daytab${day === 'all' ? ' on' : ''}`} onClick={() => setDay('all')}>All <span className="c">{rows.length}</span></button>
        {groups.map(([k, arr]) => (
          <button key={k} className={`daytab${day === k ? ' on' : ''}`} onClick={() => setDay(k)}>{label(k)} <span className="c">{arr.length}</span></button>
        ))}
      </div>

      {shown.map(([k, arr], i) => (
        <div className="day-group" key={k} style={{ '--i': i } as CSSProperties}>
          <div className="day-head">
            <span className="day-name">{label(k)}</span>
            <span className={`day-badge${k === todayKey ? '' : ' muted'}`}>{arr.length} sent</span>
            <span className="day-rule" />
          </div>
          <div className="cards">
            {arr.map((r, i) => (
              <JobCard key={`${r.job_id}-${r.run_id}`} row={r} mode="apply" index={i} expanded={false} onToggle={() => undefined} onStatsUpdate={onStatsUpdate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

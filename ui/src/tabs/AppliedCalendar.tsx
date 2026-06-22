import { useState, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { getAppliedJobs, getStats, postArchiveRun } from '../api';
import type { ApplyQueueRow, Stats } from '../api';
import { JobCard } from '../components/JobCard';

interface Props { onStatsUpdate: (s: Stats) => void; refreshKey?: number; }

export function AppliedCalendar({ onStatsUpdate, refreshKey }: Props) {
  const [rows, setRows] = useState<ApplyQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string>('all');
  const [archiving, setArchiving] = useState(false);
  const [archiveLog, setArchiveLog] = useState<string[]>([]);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

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

  async function handleArchive(dryRun: boolean) {
    if (archiving) return;
    setArchiving(true);
    setArchiveLog([]);
    setArchiveError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await postArchiveRun(dryRun, {
        onLine: l => setArchiveLog(p => [...p.slice(-199), l]),
        onDone: () => setArchiving(false),
        onError: e => { setArchiveError(e.message); setArchiving(false); },
        signal: ctrl.signal,
      }, 0);
    } catch (e) {
      setArchiveError((e as Error).message);
      setArchiving(false);
    }
  }

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
      <div className="d-sec" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line-2)' }}>
        <div className="d-head">Archive to Google Drive</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="gen-btn" disabled={archiving} onClick={() => void handleArchive(true)}>
            {archiving ? 'Running…' : 'Dry run'}
          </button>
          <button className="gen-btn" disabled={archiving} onClick={() => void handleArchive(false)}>
            {archiving ? 'Archiving…' : 'Archive now'}
          </button>
        </div>
        {archiveError && <div style={{ color: 'var(--neg)', fontSize: 12 }}>{archiveError}</div>}
        {archiveLog.length > 0 && (
          <pre style={{ fontSize: 11, color: 'var(--ink-2)', background: 'var(--bg-2)', padding: 10, borderRadius: 6, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {archiveLog.join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}

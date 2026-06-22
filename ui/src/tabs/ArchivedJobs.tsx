import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { getArchivedJobs } from '../api';
import type { ArchivedJobRow } from '../api';

interface Props { refreshKey?: number; }

export function ArchivedJobs({ refreshKey }: Props) {
  const [rows, setRows]     = useState<ArchivedJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [day, setDay]       = useState<string>('all');

  useEffect(() => {
    setLoading(true); setError(null);
    getArchivedJobs()
      .then(setRows)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const groups = useMemo(() => {
    const m = new Map<string, ArchivedJobRow[]>();
    rows.forEach(r => {
      const k = r.archived_at ? new Date(r.archived_at).toISOString().slice(0, 10) : 'unknown';
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

  if (loading) return <div className="loading">Loading...</div>;
  if (error)   return <div className="tab-error">Error: {error}</div>;

  const shown = day === 'all' ? groups : groups.filter(([k]) => k === day);

  return (
    <div className="content-inner">
      {!rows.length && (
        <div className="empty">
          <h4>No archived jobs yet</h4>
          <p>Go to the Applied tab and click "Archive now" to upload artifacts to Google Drive.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="day-tabs">
          <button className={`daytab${day === 'all' ? ' on' : ''}`} onClick={() => setDay('all')}>
            All <span className="c">{rows.length}</span>
          </button>
          {groups.map(([k, arr]) => (
            <button key={k} className={`daytab${day === k ? ' on' : ''}`} onClick={() => setDay(k)}>
              {label(k)} <span className="c">{arr.length}</span>
            </button>
          ))}
        </div>
      )}

      {shown.map(([k, arr], i) => (
        <div className="day-group" key={k} style={{ '--i': i } as CSSProperties}>
          <div className="day-head">
            <span className="day-name">{label(k)}</span>
            <span className={`day-badge${k === todayKey ? '' : ' muted'}`}>{arr.length} archived</span>
            <span className="day-rule" />
          </div>
          <div className="cards">
            {arr.map(r => (
              <div key={r.job_id} className="j-card" style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.drive_folder_id ? (
                        <a
                          href={`https://drive.google.com/drive/folders/${r.drive_folder_id}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--ink-1)', textDecoration: 'none' }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          {r.company} — {r.title}
                        </a>
                      ) : (
                        <span>{r.company} — {r.title}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      {r.applied_at && (
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                          Applied {new Date(r.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {r.artifact_count} artifact{r.artifact_count !== 1 ? 's' : ''}
                      </span>
                      <span className={`status-pill${r.archived_source === 'manual' ? '' : ' later'}`} style={{ fontSize: 11 }}>
                        {r.archived_source === 'manual' ? 'Manual' : 'Auto'}
                      </span>
                    </div>
                  </div>
                  {r.drive_folder_id && (
                    <a
                      href={`https://drive.google.com/drive/folders/${r.drive_folder_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="gen-btn"
                      style={{ fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}
                    >
                      Open in Drive
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

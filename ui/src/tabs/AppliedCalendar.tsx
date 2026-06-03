import { useState, useEffect, useMemo } from 'react';
import { getStats } from '../api';
import type { ApplyQueueRow, Stats } from '../api';

async function getAppliedJobs(): Promise<ApplyQueueRow[]> {
  const res = await fetch('/api/applied-jobs');
  if (!res.ok) throw new Error(`applied-jobs failed: ${res.status}`);
  return res.json();
}

function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  return date.getDate() === today.getDate()
    && date.getMonth() === today.getMonth()
    && date.getFullYear() === today.getFullYear();
}

export function AppliedCalendar({ onStatsUpdate, refreshKey }: {
  onStatsUpdate: (s: Stats) => void;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<ApplyQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAppliedJobs()
      .then(setRows)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
    getStats().then(onStatsUpdate).catch(() => undefined);
  }, [refreshKey, onStatsUpdate]);

  const grouped = useMemo(() => {
    const map = new Map<string, ApplyQueueRow[]>();
    rows.forEach(row => {
      const day = row.applied_at ? new Date(row.applied_at).toISOString().slice(0, 10) : 'unknown';
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(row);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const visibleGroups = selectedDay
    ? grouped.filter(([day]) => day === selectedDay)
    : grouped;

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;
  if (!rows.length) return <div className="empty">No applied jobs yet.</div>;

  return (
    <div>
      <div className="day-filter-bar" style={{ marginBottom: 18 }}>
        <span className="day-filter-label">Day</span>
        <button className={`day-btn${!selectedDay ? ' active' : ''}`} onClick={() => setSelectedDay(null)}>
          All ({rows.length})
        </button>
        {grouped.map(([iso, dayRows]) => (
          <button
            key={iso}
            className={`day-btn${selectedDay === iso ? ' active' : ''}`}
            onClick={() => setSelectedDay(prev => prev === iso ? null : iso)}
          >
            {iso === 'unknown' ? 'Unknown' : new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            <span style={{ opacity: .6, fontSize: '10px', marginLeft: 3 }}>({dayRows.length})</span>
          </button>
        ))}
      </div>

      {visibleGroups.map(([iso, dayRows]) => (
        <div key={iso} className="applied-day-group">
          <div className="applied-day-header">
            <span className="applied-day-label">
              {iso === 'unknown'
                ? 'Unknown date'
                : new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })}
            </span>
            <span className={`applied-day-count${iso !== 'unknown' && isToday(`${iso}T00:00:00`) ? ' applied-day-today' : ''}`}>
              {dayRows.length} applied
            </span>
          </div>
          {dayRows.map(row => (
            <div key={`${row.job_id}-${row.run_id}`} className="job-card state-applied" style={{ cursor: 'default' }}>
              <div className="card-title-row">
                <span className="job-title">{row.title}</span>
              </div>
              <div className="card-meta">
                <span className="company">{row.company}</span>
                {row.source && <span className="badge" style={{ background: '#7af7f7', color: '#1d1c1c' }}>{row.source}</span>}
                {row.applied_at && (
                  <span className="scraped-date">
                    {new Date(row.applied_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="action-links" style={{ marginTop: 8 }}>
                <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="open-btn">
                  Open Job ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

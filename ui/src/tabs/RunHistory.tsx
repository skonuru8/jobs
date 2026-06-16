import { useState, useEffect } from 'react';
import { getRunHistory } from '../api';
import type { RunRow } from '../api';
import { timeAgo, fmtDuration } from '../utils';

export function RunHistory({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    getRunHistory().then(setRows).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return (
    <div className="content-inner">
      <div className="panel">
        <table className="rtable">
          <thead><tr><th>Run</th><th>Source</th><th>Status</th><th>Scraped</th><th>Passed</th><th>Yield</th><th>Started</th><th>Duration</th></tr></thead>
          <tbody>
            {[...Array(5)].map((_, i) => (
              <tr key={i} className="skeleton-row">
                {[...Array(8)].map((_, j) => <td key={j}><span /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  if (error) return <div className="tab-error">Error: {error}</div>;
  if (!rows.length) return (
    <div className="content-inner">
      <div className="empty">
        <div className="empty-mark">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <h4>No runs yet</h4>
        <p>Pipeline runs will appear here.</p>
      </div>
    </div>
  );

  return (
    <div className="content-inner">
      <div className="count-line"><span className="count-num">{rows.length}</span><span className="count-word">recent runs</span></div>
      <div className="panel">
        <table className="rtable">
          <thead>
            <tr><th>Run</th><th>Source</th><th>Status</th><th>Scraped</th><th>Passed</th><th>Yield</th><th>Started</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const status = r.exit_code === 0 ? 'ok' : r.exit_code === null ? 'running' : 'failed';
              const yieldPct = r.scraped_count && r.passed_count != null ? r.passed_count / r.scraped_count : 0;
              return (
                <tr key={r.run_id}>
                  <td><span className="rid">{r.run_id}</span></td>
                  <td>{r.source.replace(/_/g, ' ')}</td>
                  <td><span className={`rstatus ${status}`}><span className="dot" />{status}</span></td>
                  <td><span className="num">{r.scraped_count ?? '—'}</span></td>
                  <td><span className="num">{r.passed_count ?? '—'}</span></td>
                  <td>
                    {r.passed_count != null ? (
                      <div className="yield-bar">
                        <div className="yield-track"><div className="yield-fill" style={{ width: `${Math.min(100, Math.round(yieldPct * 100 * 4))}%` }} /></div>
                        <span className="num" style={{ fontSize: 11 }}>{Math.round(yieldPct * 100)}%</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td>{timeAgo(r.started_at)}</td>
                  <td><span className="num" style={{ fontSize: 12 }}>{fmtDuration(r.started_at, r.finished_at)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';

interface RunRow {
  run_id: string;
  source: string;
  status: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  scraped_count: number | null;
  passed_count: number | null;
  extraction_count: number | null;
}

async function getRunHistory(): Promise<RunRow[]> {
  const res = await fetch('/api/run-history');
  if (!res.ok) throw new Error(`run-history failed: ${res.status}`);
  return res.json();
}

function duration(start: string, end: string | null): string {
  if (!end) return '-';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RunHistory({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getRunHistory()
      .then(setRows)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="tab-error">Error: {error}</div>;
  if (!rows.length) return <div className="empty">No runs yet.</div>;

  return (
    <div>
      <div className="card-count">{rows.length} runs</div>
      <table className="run-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Status</th>
            <th>Scraped</th>
            <th>Passed</th>
            <th>Extracted</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const status = row.exit_code === 0 ? 'ok' : row.exit_code === null ? 'running' : 'failed';
            return (
              <tr key={row.run_id}>
                <td>{new Date(row.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{row.source}</td>
                <td><span className={`run-status ${status}`}>{status}</span></td>
                <td>{row.scraped_count ?? '-'}</td>
                <td>{row.passed_count ?? '-'}</td>
                <td>{row.extraction_count ?? '-'}</td>
                <td>{duration(row.started_at, row.finished_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

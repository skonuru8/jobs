import { useState, useEffect } from 'react';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

async function getResumeTex(jobId: string): Promise<{ tailored: string; canonical: string } | null> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/resume-tex`);
  if (!res.ok) return null;
  return res.json();
}

function computeDiff(canonical: string, tailored: string): DiffLine[] {
  const canonicalLines = canonical.split('\n');
  const tailoredLines = tailored.split('\n');
  const expStart = (lines: string[]) => lines.findIndex(line => line.includes('\\section*{EXPERIENCE}'));
  const aStart = expStart(canonicalLines);
  const bStart = expStart(tailoredLines);
  const aSlice = aStart >= 0 ? canonicalLines.slice(aStart) : canonicalLines;
  const bSlice = bStart >= 0 ? tailoredLines.slice(bStart) : tailoredLines;

  const remainingCanonical = new Set(aSlice);
  const tailoredSet = new Set(bSlice);
  const result: DiffLine[] = [];

  bSlice.forEach(line => {
    if (remainingCanonical.has(line)) {
      result.push({ type: 'unchanged', text: line });
      remainingCanonical.delete(line);
    } else {
      result.push({ type: 'added', text: line });
    }
  });

  aSlice.forEach(line => {
    if (remainingCanonical.has(line) && !tailoredSet.has(line)) {
      const insertAt = Math.max(result.findIndex(item => item.type === 'unchanged'), 0);
      result.splice(insertAt, 0, { type: 'removed', text: line });
    }
  });

  return result.filter(line => {
    if (line.type !== 'unchanged') return true;
    const trimmed = line.text.trim();
    return trimmed.startsWith('\\item') || trimmed.startsWith('\\section') || trimmed.startsWith('\\textbf');
  }).slice(0, 200);
}

export function ResumeDiff({ jobId }: { jobId: string }) {
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getResumeTex(jobId)
      .then(data => {
        if (!data) {
          setError('Resume source not found');
          return;
        }
        if (!data.canonical) {
          setError('Canonical resume not found in config/');
          return;
        }
        setLines(computeDiff(data.canonical, data.tailored));
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <div className="diff-loading">Loading diff...</div>;
  if (error) return <div className="dp-error">{error}</div>;
  if (!lines) return null;

  const added = lines.filter(line => line.type === 'added').length;
  const removed = lines.filter(line => line.type === 'removed').length;

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>
        <span style={{ color: 'var(--green)', marginRight: 10 }}>+{added} added</span>
        <span style={{ color: 'var(--pink)' }}>-{removed} removed</span>
        <span style={{ marginLeft: 8, opacity: .6 }}>(EXPERIENCE section)</span>
      </div>
      <div className="diff-container">
        {lines.map((line, i) => (
          <div key={i} className={`diff-line ${line.type}`}>
            <span className="diff-marker">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}

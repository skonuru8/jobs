import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────

interface SemanticChange {
  type: 'replaced' | 'added' | 'removed';
  section: string;
  oldText?: string;
  newText?: string;
  text?: string;
}

// ─── LaTeX helpers ────────────────────────────────────────────────

function cleanLatex(raw: string): string {
  return raw
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSections(tex: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = '';

  for (const line of tex.split('\n')) {
    const sec = line.match(/\\section\*?\{([^}]+)\}/);
    if (sec) {
      current = sec[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('\\item')) {
      const bullet = trimmed.replace(/^\\item\s*/, '').trim();
      if (bullet) sections.get(current)!.push(bullet);
    }
  }

  return sections;
}

// Word-overlap similarity (ignores short stop words)
function wordSim(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const aW = tok(a);
  const bW = tok(b);
  const n = [...aW].filter(w => bW.has(w)).length;
  const d = Math.max(aW.size, bW.size);
  return d > 0 ? n / d : 0;
}

// ─── Semantic diff engine ─────────────────────────────────────────

function computeSemanticChanges(canonical: string, tailored: string): SemanticChange[] {
  const canonSec = parseSections(canonical);
  const tailSec = parseSections(tailored);
  const allSections = [...new Set([...canonSec.keys(), ...tailSec.keys()])];
  const changes: SemanticChange[] = [];

  for (const section of allSections) {
    const cBullets = canonSec.get(section) ?? [];
    const tBullets = tailSec.get(section) ?? [];

    const cSet = new Set(cBullets);
    const tSet = new Set(tBullets);

    const added   = tBullets.filter(b => !cSet.has(b));
    const removed = cBullets.filter(b => !tSet.has(b));

    const usedAdded   = new Set<number>();
    const usedRemoved = new Set<number>();

    // Pair removed+added as replacements when word similarity > threshold
    for (let ri = 0; ri < removed.length; ri++) {
      let best = 0.28;
      let bestAi = -1;
      for (let ai = 0; ai < added.length; ai++) {
        if (usedAdded.has(ai)) continue;
        const s = wordSim(removed[ri], added[ai]);
        if (s > best) { best = s; bestAi = ai; }
      }
      if (bestAi >= 0) {
        usedAdded.add(bestAi);
        usedRemoved.add(ri);
        changes.push({ type: 'replaced', section, oldText: removed[ri], newText: added[bestAi] });
      }
    }

    removed.forEach((b, i) => {
      if (!usedRemoved.has(i)) changes.push({ type: 'removed', section, text: b });
    });
    added.forEach((b, i) => {
      if (!usedAdded.has(i)) changes.push({ type: 'added', section, text: b });
    });
  }

  return changes;
}

// ─── Component ────────────────────────────────────────────────────

function Badge({ type }: { type: SemanticChange['type'] }) {
  const label = type === 'replaced' ? 'replaced' : type === 'added' ? 'added' : 'removed';
  return <span className={`sdiff-badge ${type}`}>{label}</span>;
}

export function ResumeDiff({ jobId }: { jobId: string }) {
  const [changes, setChanges] = useState<SemanticChange[] | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/resume-tex`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ tailored: string; canonical: string }>;
      })
      .then(({ canonical, tailored }) => {
        if (!canonical) throw new Error('Canonical resume not found in config/');
        setChanges(computeSemanticChanges(canonical, tailored));
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <div className="diff-loading">Loading diff...</div>;
  if (error)   return <div className="dp-error">{error}</div>;
  if (!changes) return null;

  const visibleChanges = changes.filter(
    c => c.type !== 'replaced' || cleanLatex(c.oldText!) !== cleanLatex(c.newText!),
  );

  if (visibleChanges.length === 0) {
    return <div className="sdiff-empty">No bullet changes from canonical resume</div>;
  }

  const nReplaced = visibleChanges.filter(c => c.type === 'replaced').length;
  const nAdded    = visibleChanges.filter(c => c.type === 'added').length;
  const nRemoved  = visibleChanges.filter(c => c.type === 'removed').length;
  const sections  = [...new Set(visibleChanges.map(c => c.section))];

  return (
    <>
      <div className="sdiff-stat">
        {nReplaced > 0 && <span className="sdiff-stat-replaced">~{nReplaced} replaced</span>}
        {nAdded    > 0 && <span className="sdiff-stat-added">+{nAdded} added</span>}
        {nRemoved  > 0 && <span className="sdiff-stat-removed">-{nRemoved} removed</span>}
      </div>

      <div className="sdiff">
        {sections.map(section => (
          <div key={section} className="sdiff-section">
            <div className="sdiff-section-head">{section}</div>
            {visibleChanges.filter(c => c.section === section).map((c, i) => (
              <div key={i} className="sdiff-row">
                <Badge type={c.type} />
                {c.type === 'replaced' && (
                  <>
                    <div className="sdiff-old">{cleanLatex(c.oldText!)}</div>
                    <div className="sdiff-arrow">↓</div>
                    <div className="sdiff-new">{cleanLatex(c.newText!)}</div>
                  </>
                )}
                {c.type === 'added'    && <div className="sdiff-bullet sdiff-bullet-added">{cleanLatex(c.text!)}</div>}
                {c.type === 'removed'  && <div className="sdiff-bullet sdiff-bullet-removed">{cleanLatex(c.text!)}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// Small presentational pieces shared by JobCard.
import { pct, scoreColor, scoreDisplayColor } from '../utils';

export function ScoreRing({ value }: { value: number }) {
  const p = pct(value);
  const R = 28;
  const C = 2 * Math.PI * R;
  return (
    <div className="score-ring" aria-label={`Match ${p}%`}>
      <svg viewBox="0 0 64 64">
        <circle className="track" cx="32" cy="32" r={R} fill="none" strokeWidth="5" />
        <circle className="val" cx="32" cy="32" r={R} fill="none" strokeWidth="5"
          style={{ stroke: scoreColor(p), strokeDasharray: C, strokeDashoffset: C * (1 - value) }} />
      </svg>
      <span className="rt">{p}</span>
    </div>
  );
}

export function ScoreNum({ value }: { value: number }) {
  const p = pct(value);
  return (
    <div className="score-num">
      <div className="v" style={{ color: scoreDisplayColor(p) }}>{p}<span className="pct">%</span></div>
      <div className="lbl">Match</div>
    </div>
  );
}

interface Sub { skills: number; semantic: number; yoe: number; seniority: number; location: number; }

export function MiniScores({ row }: { row: Sub }) {
  const items: [string, number][] = [['Skills', row.skills], ['Sem', row.semantic], ['YoE', row.yoe], ['Sen', row.seniority], ['Loc', row.location]];
  return (
    <div className="mini-scores">
      {items.map(([l, v]) => (
        <div className="mini" key={l}>
          <span className="mini-lbl">{l}</span>
          <div className="mini-track"><div className="mini-fill" style={{ width: `${pct(v)}%`, background: scoreColor(pct(v)) }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Bars({ row }: { row: Sub & { score_total: number } }) {
  const items: [string, number][] = [
    ['Overall', row.score_total], ['Skills', row.skills], ['Semantic', row.semantic],
    ['Experience', row.yoe], ['Seniority', row.seniority], ['Location', row.location],
  ];
  return (
    <div className="dbars">
      {items.map(([l, v]) => {
        const p = pct(v);
        return (
          <div className="dbar-row" key={l}>
            <div className="dbar-top"><span className="dbar-lbl">{l}</span><span className="dbar-val" style={{ color: scoreColor(p) }}>{p}%</span></div>
            <div className="dbar-track"><div className="dbar-fill" style={{ width: `${p}%`, background: scoreColor(p) }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function VerdictTag({ v }: { v: string }) {
  const m: Record<string, string> = { STRONG: 'Strong fit', MAYBE: 'Maybe', WEAK: 'Weak' };
  return <span className={`tag verdict-${v.toLowerCase()}`}><span className="dot" />{m[v] ?? v}</span>;
}

export function SourceTag({ s }: { s: string }) {
  return <span className="tag src">{s.replace(/_/g, ' ')}</span>;
}

interface SkillRisk { name?: string; risk_entry?: { swap_allowed?: boolean; fabrication_risk?: string } | null; }

export function SkillPills({ skills }: { skills: SkillRisk[] }) {
  if (!skills?.length) return null;
  const cls = (s: SkillRisk) =>
    s.risk_entry?.swap_allowed ? 'swap' : (!s.risk_entry || s.risk_entry.fabrication_risk === 'high') ? 'gap' : 'matched';
  return (
    <>
      <div className="pills">{skills.map((s, i) => <span key={i} className={`pill ${cls(s)}`}>{s.name ?? 'Skill'}</span>)}</div>
      <div className="pill-legend">
        <span><i style={{ background: 'var(--pos)' }} />matched</span>
        <span><i style={{ background: 'var(--warn)' }} />swap ok</span>
        <span><i style={{ background: 'var(--neg)' }} />gap</span>
      </div>
    </>
  );
}

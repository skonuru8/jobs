import { useState, useEffect } from 'react';
import type { ApplyQueueRow, HardRejectionRow, SoftRejectionRow } from '../api';
import { ResumeDiff } from './ResumeDiff';

type Mode = 'apply' | 'hard-reject' | 'soft-reject';

interface Props {
  row: ApplyQueueRow | HardRejectionRow | SoftRejectionRow;
  mode: Mode;
  onClose: () => void;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fmtScore(n: number) {
  return Math.round(n * 100);
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = fmtScore(value);
  const color = pct >= 70 ? '#83f582' : pct >= 50 ? '#fd9143' : '#fc74fc';
  return (
    <div className="dp-score-row">
      <div className="dp-score-labels">
        <span className="dp-score-label">{label}</span>
        <span className="dp-score-value" style={{ color }}>{pct}%</span>
      </div>
      <div className="dp-bar-track">
        <div className="dp-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function stringField(row: ApplyQueueRow | HardRejectionRow | SoftRejectionRow, key: string): string | null {
  const value = (row as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function DetailPanel({ row, mode, onClose }: Props) {
  const applyRow = mode === 'apply' ? (row as ApplyQueueRow) : null;
  const hasScore = 'score_total' in row;

  const [jdContent, setJdContent] = useState<string | null>(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [jdError, setJdError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const jdUrl = stringField(row, 'job_description_url');

  useEffect(() => {
    if (!jdUrl) return;
    let cancelled = false;
    setJdContent(null);
    setJdError(null);
    setJdLoading(true);
    fetch(jdUrl)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(html => { if (!cancelled) setJdContent(stripHtml(html)); })
      .catch(e => { if (!cancelled) setJdError((e as Error).message); })
      .finally(() => { if (!cancelled) setJdLoading(false); });
    return () => { cancelled = true; };
  }, [jdUrl, row.job_id]);

  const reasoningText =
    stringField(row, 'reasoning')
    ?? stringField(row, 'judge_reasoning')
    ?? stringField(row, 'judge_concerns');

  return (
    <div className="detail-panel">
      <div className="dp-header">
        <div className="dp-header-text">
          <div className="dp-title">{row.title}</div>
          <div className="dp-company">{row.company}</div>
        </div>
        <button className="dp-close" onClick={onClose} aria-label="Close detail panel">✕</button>
      </div>

      {hasScore && (
        <div className="dp-section">
          <div className="dp-section-title">Scores</div>
          <ScoreBar label="Overall" value={row.score_total} />
          <ScoreBar label="Skills" value={row.skills} />
          <ScoreBar label="Semantic" value={row.semantic} />
          <ScoreBar label="Experience" value={row.yoe} />
          <ScoreBar label="Seniority" value={row.seniority} />
          <ScoreBar label="Location" value={row.location} />
        </div>
      )}

      {applyRow && (applyRow as unknown as { required_skills_with_risk?: unknown[] | null }).required_skills_with_risk && (
        <div className="dp-section">
          <div className="dp-section-title">Skill match</div>
          <div className="skill-pills">
            {((applyRow as unknown as { required_skills_with_risk: Array<{
              name?: string;
              risk_entry?: { swap_allowed?: boolean; fabrication_risk?: string } | null;
            }> }).required_skills_with_risk).slice(0, 20).map((skill, i) => {
              const isSwap = skill.risk_entry?.swap_allowed === true;
              const isGap = !skill.risk_entry || skill.risk_entry.fabrication_risk === 'high';
              const cls = isSwap ? 'swap' : isGap ? 'gap' : 'matched';
              return <span key={i} className={`skill-pill ${cls}`}>{skill.name ?? 'Unnamed skill'}</span>;
            })}
          </div>
        </div>
      )}

      {reasoningText && (
        <div className="dp-section">
          <div className="dp-section-title">Judge reasoning</div>
          <div className="dp-reasoning">{reasoningText}</div>
        </div>
      )}

      {jdUrl && (
        <div className="dp-section">
          <div className="dp-section-title">
            Job description
            <a href={jdUrl} target="_blank" rel="noopener noreferrer" className="dp-open-link">
              open ↗
            </a>
          </div>
          {jdLoading && <div className="dp-loading">Loading…</div>}
          {jdError && <div className="dp-error">Could not load JD ({jdError})</div>}
          {jdContent && <pre className="dp-jd-text">{jdContent}</pre>}
        </div>
      )}

      {applyRow?.cover_letter && (
        <div className="dp-section">
          <div className="dp-section-title">
            Cover letter
            <button
              className={`dp-copy-btn${copied ? ' copied' : ''}`}
              onClick={() => {
                void navigator.clipboard.writeText(applyRow.cover_letter!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <pre className="dp-cover-text">{applyRow.cover_letter}</pre>
        </div>
      )}

      {applyRow?.resume_pdf_url && (
        <div className="dp-section">
          <div className="dp-section-title">
            Resume diff
            <button
              style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => setDiffOpen(o => !o)}
            >
              {diffOpen ? '▴ hide' : '▾ show'}
            </button>
          </div>
          {diffOpen && <ResumeDiff jobId={row.job_id} />}
        </div>
      )}

      {applyRow && (applyRow.resume_pdf_url || applyRow.cover_pdf_url) && (
        <div className="dp-section">
          <div className="dp-section-title">Artifacts</div>
          <div className="dp-artifact-links">
            {applyRow.resume_pdf_url && (
              <a href={applyRow.resume_pdf_url} target="_blank" rel="noopener noreferrer">
                Resume PDF ↗
              </a>
            )}
            {applyRow.cover_pdf_url && (
              <a href={applyRow.cover_pdf_url} target="_blank" rel="noopener noreferrer">
                Cover Letter PDF ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

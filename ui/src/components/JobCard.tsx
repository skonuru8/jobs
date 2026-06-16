import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { postLabel, postGenerateArtifacts, getStats } from '../api';
import type { ApplyQueueRow, HardRejectionRow, SoftRejectionRow, Stats, RiskSummary } from '../api';
import { timeAgo, renderMarkdownPreview } from '../utils';
import { Chevron, Ext, Doc, Spark, Warn, Check } from '../icons';
import { ScoreRing, ScoreNum, MiniScores, Bars, VerdictTag, SourceTag, SkillPills } from './bits';
import { ResumeDiff } from './ResumeDiff';

type Mode = 'apply' | 'hard-reject' | 'soft-reject';
type Label = 'yes' | 'maybe' | 'no';
type AppStatus = 'applied' | 'skipped' | 'apply_later' | null;
type Row = ApplyQueueRow | HardRejectionRow | SoftRejectionRow;

interface Props {
  row: Row;
  mode: Mode;
  expanded: boolean;
  onToggle: () => void;
  kbFocus?: boolean;
  index?: number;
  onStatsUpdate: (s: Stats) => void;
  onDataChange?: () => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}

const NO_CHIPS = ['Not a good fit', 'Too senior', 'Too junior', 'No sponsorship', 'Location', 'Contract / not FTE', 'Low comp', 'Already applied'];
const YES_CHIPS = ['Not a good fit', 'Already applied elsewhere', 'Too senior / too junior'];

function artifactFlagsWarn(flags: string[]): boolean {
  const warn = /compile|malformed|too_short|length_off|failed|invalid|missing|leak/i;
  return flags.some(f => warn.test(f));
}

function field(row: Row, key: string): string | null {
  const v = (row as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function looksLikeAppShell(body: string): boolean {
  const probe = body.slice(0, 4000).toLowerCase();
  return probe.includes('<!doctype html') || probe.includes('<div id="root"></div>') || probe.includes('<title>jobs — job copilot</title>');
}

function RiskBadge({ label, status, summary }: { label: string; status: 'ok' | 'needs_review' | undefined; summary: RiskSummary | null | undefined }) {
  const [open, setOpen] = useState(false);
  const review = status === 'needs_review';
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span className={`risk ${review ? 'review' : 'ok'}`} onClick={() => review && setOpen(o => !o)}>
        {review ? <Warn style={{ width: 12, height: 12 }} /> : <Check style={{ width: 12, height: 12 }} />}
        {label} {review ? 'needs review' : 'clear'}
      </span>
      {open && summary && summary.human_review_items.length > 0 && (
        <div className="doc" style={{ position: 'absolute', top: '1.8em', left: 0, zIndex: 30, minWidth: 280, maxWidth: 380 }}>
          <strong>Items to review</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
            {summary.human_review_items.map((it, i) => (
              <li key={i}><strong>{it.text}</strong> ({it.relationship}): {it.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

export function JobCard({ row, mode, expanded, onToggle, kbFocus, index, onStatsUpdate, onDataChange, cardRef }: Props) {
  const applyRow = mode === 'apply' ? (row as ApplyQueueRow) : null;
  const hardRow = mode === 'hard-reject' ? (row as HardRejectionRow) : null;
  const hasScore = 'score_total' in row;

  const [label, setLabel] = useState<Label | null>(row.label ?? null);
  const [appStatus, setAppStatus] = useState<AppStatus>(applyRow?.application_status ?? null);
  const [notes, setNotes] = useState<string>(row.label_notes ?? '');
  const [chips, setChips] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // lazy-load the saved JD when the card is first expanded
  const jdUrl = field(row, 'job_description_url');
  const [jd, setJd] = useState<string | null>(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [jdError, setJdError] = useState<string | null>(null);
  useEffect(() => {
    if (!expanded || !jdUrl || jd !== null) return;
    let cancelled = false;
    setJdLoading(true); setJdError(null);
    fetch(jdUrl)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (looksLikeAppShell(text)) throw new Error('job description unavailable');
        return text;
      })
      .then(text => { if (!cancelled) setJd(text); })
      .catch(e => { if (!cancelled) setJdError((e as Error).message); })
      .finally(() => { if (!cancelled) setJdLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, jdUrl, jd]);
  const jdPreview = useMemo(() => (jd ? renderMarkdownPreview(jd) : null), [jd]);

  const isApplied = appStatus === 'applied';
  const isSkipped = appStatus === 'skipped' || (mode !== 'apply' && label === 'no');
  const isLater = appStatus === 'apply_later';
  const dismissed = appStatus === 'skipped' || (mode !== 'apply' && label === 'no');

  async function doPost(newLabel: Label, newStatus?: AppStatus, notesOverride?: string): Promise<boolean> {
    setSaving(true); setError(null);
    const notesVal = notesOverride !== undefined ? notesOverride : (notes === '' ? '' : notes || null);
    try {
      await postLabel({ job_id: row.job_id, run_id: row.run_id, label: newLabel, application_status: newStatus ?? null, notes: notesVal });
      onStatsUpdate(await getStats());
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setSaving(false); }
  }

  async function handleLabel(l: Label) {
    setLabel(l);
    const ok = await doPost(l);
    if (ok && mode !== 'apply') onDataChange?.();
  }
  async function handleStatus(s: AppStatus) {
    if (!label) return;
    setAppStatus(s);
    const ok = await doPost(label, s);
    if (ok) onDataChange?.();
  }
  async function handleNotesBlur() { if (label) await doPost(label); }
  async function handleDismiss() {
    if (!chips.length) return;
    const text = chips.join(', ');
    setNotes(text); setLabel('no'); setAppStatus('skipped');
    if (await doPost('no', 'skipped', text)) onDataChange?.();
  }

  async function handleGenerate() {
    if (mode !== 'apply') return;
    setGen(true); setGenError(null);
    try {
      const has = Boolean(applyRow?.cover_pdf_url || applyRow?.resume_pdf_url);
      await postGenerateArtifacts(row.job_id, { force: has });
      onDataChange?.();
      onStatsUpdate(await getStats());
    } catch (e) { setGenError((e as Error).message); }
    finally { setGen(false); }
  }

  const reasoning = field(row, 'reasoning') ?? field(row, 'judge_reasoning');
  const concerns: string[] = applyRow
    ? ((applyRow as unknown as { judge_concerns?: string[] | null }).judge_concerns ?? applyRow.concerns ?? [])
    : (((row as unknown as { concerns?: string[] | null }).concerns) ?? []);
  const skills = (row as unknown as { required_skills_with_risk?: unknown[] | null }).required_skills_with_risk as
    Array<{ name?: string; risk_entry?: { swap_allowed?: boolean; fabrication_risk?: string } | null }> | undefined;

  const cls = ['card', expanded ? 'expanded' : '', kbFocus ? 'kbfocus' : '', isApplied ? 'applied' : '', dismissed ? 'dismissed' : ''].filter(Boolean).join(' ');

  return (
    <div className={cls} ref={cardRef} style={{ '--i': Math.min(index ?? 0, 12) } as CSSProperties}>
      <div className="card-head" onClick={onToggle}>
        <div className="card-body-main">
          <div className="title-row">
            <span className="j-title">{row.title}</span>
            {isApplied && <span className="status-pill applied"><Check style={{ width: 11, height: 11 }} />Applied</span>}
            {isLater && <span className="status-pill later">Later</span>}
            {isSkipped && !isApplied && <span className="status-pill notapplied">Skipped</span>}
          </div>
          <div className="j-meta">
            <span className="j-company">{row.company}</span>
            <SourceTag s={row.source} />
            {'judge_verdict' in row && <VerdictTag v={(row as ApplyQueueRow).judge_verdict} />}
            <span className="j-dot" />
            <span className="j-time">{timeAgo(row.scraped_at)}</span>
          </div>
          {hardRow && <div className="flag-strip"><Warn /> {hardRow.reason}</div>}
          {hasScore && <MiniScores row={row as ApplyQueueRow} />}
          {applyRow?.artifact_flags && applyRow.artifact_flags.length > 0 && (
            <div className="flag-strip"><Warn />{artifactFlagsWarn(applyRow.artifact_flags) ? 'Artifact issue' : 'Flags'}: {applyRow.artifact_flags.join(', ')}</div>
          )}
        </div>
        <div className="score-zone">
          {hasScore && <><ScoreNum value={(row as ApplyQueueRow).score_total} /><ScoreRing value={(row as ApplyQueueRow).score_total} /></>}
          <Chevron className="chev" />
        </div>
      </div>

      <div className="expand"><div className="expand-inner">
        <div className="detail">
          <div className="detail-grid">
            <div>
              {hasScore && (
                <div className="d-sec">
                  <div className="d-head">Score breakdown</div>
                  <Bars row={row as ApplyQueueRow} />
                </div>
              )}
              {skills && skills.length > 0 && (
                <div className="d-sec">
                  <div className="d-head">Skill match</div>
                  <SkillPills skills={skills} />
                </div>
              )}
              {concerns.length > 0 && (
                <div className="d-sec">
                  <div className="d-head">Concerns</div>
                  <ul className="concerns">{concerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
              )}
              {hardRow?.flags && Object.keys(hardRow.flags).length > 0 && (
                <div className="d-sec">
                  <div className="d-head">Rejection flags</div>
                  <div className="pills">{Object.entries(hardRow.flags).map(([k, v]) => <span key={k} className="pill gap">{k}: {String(v)}</span>)}</div>
                </div>
              )}
            </div>
            <div>
              {reasoning && (
                <div className="d-sec">
                  <div className="d-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Spark style={{ width: 13, height: 13, color: 'var(--accent-line)' }} />Judge reasoning</span></div>
                  <div className="d-reason">{reasoning}</div>
                </div>
              )}
              {jdUrl && (
                <div className="d-sec">
                  <div className="d-head"><span>Job description</span><a className="dp-open-link" href={jdUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-3)', fontSize: 11 }}>open ↗</a></div>
                  {jdLoading && <div className="diff-loading">Loading…</div>}
                  {jdError && <div className="dp-error">Could not load JD ({jdError})</div>}
                  {jdPreview && <div className="doc md-preview" dangerouslySetInnerHTML={{ __html: jdPreview }} />}
                </div>
              )}
              {applyRow?.cover_letter && (
                <div className="d-sec">
                  <div className="d-head"><span>Cover letter</span>
                    <button style={{ fontSize: 11, fontWeight: 600, color: copied ? 'var(--pos)' : 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={() => { void navigator.clipboard?.writeText(applyRow.cover_letter!); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="doc">{applyRow.cover_letter}</div>
                </div>
              )}
              {applyRow?.resume_pdf_url && (
                <div className="d-sec">
                  <div className="d-head"><span>Résumé diff</span>
                    <button style={{ fontSize: 11, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setDiffOpen(o => !o)}>{diffOpen ? '▴ hide' : '▾ show'}</button>
                  </div>
                  {diffOpen && <ResumeDiff jobId={row.job_id} />}
                </div>
              )}
            </div>
          </div>

          {mode === 'apply' && (
            <div className="d-sec" style={{ marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--line-2)' }}>
              <div className="d-head"><span>Application materials</span>
                {(applyRow?.resume_word_count != null || applyRow?.cover_word_count != null) && (
                  <span className="wc">
                    {applyRow?.resume_word_count != null && `résumé ${applyRow.resume_word_count}w`}
                    {applyRow?.resume_word_count != null && applyRow?.cover_word_count != null && ' · '}
                    {applyRow?.cover_word_count != null && `cover ${applyRow.cover_word_count}w`}
                  </span>
                )}
              </div>
              <div className="artifacts">
                <button className={`gen-btn${gen ? ' busy' : ''}`} onClick={handleGenerate} disabled={gen}>
                  {gen ? 'Generating…' : (applyRow?.resume_pdf_url || applyRow?.cover_pdf_url) ? 'Regenerate' : 'Generate tailored docs'}
                </button>
                {applyRow?.resume_pdf_url && <a className="alink" href={applyRow.resume_pdf_url} target="_blank" rel="noopener noreferrer"><Doc />Résumé PDF</a>}
                {applyRow?.cover_pdf_url && <a className="alink" href={applyRow.cover_pdf_url} target="_blank" rel="noopener noreferrer"><Doc />Cover letter PDF</a>}
                {applyRow?.resume_pdf_url && <RiskBadge label="Résumé" status={applyRow.resume_export_status} summary={applyRow.resume_risk_summary} />}
                {applyRow?.cover_pdf_url && <RiskBadge label="Cover" status={applyRow.cover_export_status} summary={applyRow.cover_risk_summary} />}
              </div>
              {gen && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 9 }}>Tailoring resume and cover letter, usually 1-2 min. Keep this tab open.</div>}
              {genError && <div className="card-error" style={{ color: 'var(--neg)', fontSize: 12, marginTop: 8 }}>{genError} <button onClick={handleGenerate} style={{ background: 'none', border: 'none', color: 'var(--info)', textDecoration: 'underline', cursor: 'pointer' }}>Try again</button></div>}
            </div>
          )}

          <div className="actions">
            <div className="act-row">
              <span className="act-lbl">Verdict</span>
              <div className="choice">
                <button className={label === 'yes' ? 'on-yes' : ''} disabled={saving} onClick={() => handleLabel('yes')}>Yes</button>
                <button className={label === 'maybe' ? 'on-maybe' : ''} disabled={saving} onClick={() => handleLabel('maybe')}>Maybe</button>
                <button className={label === 'no' ? 'on-no' : ''} disabled={saving} onClick={() => handleLabel('no')}>No</button>
              </div>
              <div className="openrow" style={{ marginLeft: 'auto' }}>
                <a className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 13px' }} href={row.source_url} target="_blank" rel="noopener noreferrer">Open job <Ext /></a>
                {row.jobright_id && <a className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 13px' }} href={`https://jobright.ai/jobs/info/${row.jobright_id}`} target="_blank" rel="noopener noreferrer">Jobright <Ext /></a>}
              </div>
            </div>

            {mode === 'apply' && label && label !== 'no' && (
              <div className="act-row">
                <span className="act-lbl">Status</span>
                <div className="choice">
                  <button className={appStatus === 'applied' ? 'on-applied' : ''} disabled={saving} onClick={() => handleStatus('applied')}>Applied</button>
                  <button className={appStatus === 'apply_later' ? 'on-later' : ''} disabled={saving} onClick={() => handleStatus('apply_later')}>Apply later</button>
                  <button className={appStatus === 'skipped' ? 'on-skip' : ''} disabled={saving} onClick={() => handleStatus('skipped')}>Skip</button>
                </div>
              </div>
            )}

            {label === 'no' && mode === 'apply' ? (
              <div className="act-row" style={{ alignItems: 'flex-start' }}>
                <span className="act-lbl" style={{ marginTop: 6 }}>Reason</span>
                <div>
                  <div className="chips">
                    {NO_CHIPS.map(c => (
                      <button key={c} className={`chipbtn${chips.includes(c) ? ' on' : ''}`} disabled={saving}
                        onClick={() => setChips(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])}>{c}</button>
                    ))}
                  </div>
                  <button className="gen-btn" style={{ marginTop: 10 }} disabled={saving || !chips.length} onClick={handleDismiss}>
                    Dismiss{chips.length ? ` (${chips.length})` : ''}
                  </button>
                </div>
              </div>
            ) : label && (
              <div className="act-row">
                <span className="act-lbl">Quick note</span>
                <div className="chips">
                  {YES_CHIPS.map(c => (
                    <button key={c} className={`chipbtn${notes === c ? ' on' : ''}`} disabled={saving} onClick={() => setNotes(c)}>{c}</button>
                  ))}
                </div>
              </div>
            )}

            <textarea className="notes" placeholder="Add a note…" value={notes} onChange={e => setNotes(e.target.value)} onBlur={handleNotesBlur} />
            {error && <div className="card-error" style={{ color: 'var(--neg)', fontSize: 12 }}>{error}</div>}
          </div>
        </div>
      </div></div>
    </div>
  );
}

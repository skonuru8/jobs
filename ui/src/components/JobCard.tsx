import { useState } from 'react';
import { postLabel, getStats, postGenerateArtifacts } from '../api';
import type { ApplyQueueRow, HardRejectionRow, SoftRejectionRow, Stats, RiskSummary } from '../api';

type Mode = 'apply' | 'hard-reject' | 'soft-reject';
type Label = 'yes' | 'maybe' | 'no';
type AppStatus = 'applied' | 'skipped' | 'apply_later' | null;

interface JobCardProps {
  mode: Mode;
  row: ApplyQueueRow | HardRejectionRow | SoftRejectionRow;
  onStatsUpdate: (stats: Stats) => void;
  onRemove?: (jobId: string, runId: string) => void;
  /** Refetch list data after manual artifact generation (apply queue). */
  onDataChange?: () => void;
}

// Change 4: relative time
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtDate(iso: string) {
  const abs = new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${abs} · ${timeAgo(iso)}`;
}

function fmtScore(n: number) {
  return (n * 100).toFixed(0);
}

/** Flags that should draw a visible warning on the card (§13). */
function artifactFlagsNeedWarning(flags: string[]): boolean {
  const warn = /compile|malformed|too_short|length_off|failed|invalid|missing|leak/i;
  return flags.some(f => warn.test(f));
}

function BucketBadge({ bucket }: { bucket: string }) {
  const colors: Record<string, string> = {
    COVER_LETTER: '#2d6a2d',
    REVIEW_QUEUE: '#6a5a1a',
    RESULTS: '#1a3d6a',
    ARCHIVE: '#5a1a1a',
  };
  const labels: Record<string, string> = {
    COVER_LETTER: 'Cover Letter',
    REVIEW_QUEUE: 'Review Queue',
    RESULTS: 'Results',
    ARCHIVE: 'Archive',
  };
  return (
    <span className="badge" style={{ background: colors[bucket] ?? '#333' }}>
      {labels[bucket] ?? bucket}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const colors: Record<string, string> = {
    STRONG: '#2d6a2d',
    MAYBE: '#6a5a1a',
    WEAK: '#6a2d2d',
  };
  return (
    <span className="badge" style={{ background: colors[verdict] ?? '#444' }}>
      {verdict}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return <span className="badge source-badge">{source}</span>;
}

function badgeFor(status: 'ok' | 'needs_review' | undefined): 'green' | 'yellow' {
  return status === 'needs_review' ? 'yellow' : 'green';
}

function RiskBadge({ label, status, summary }: { label: string; status: 'ok' | 'needs_review' | undefined; summary: RiskSummary | null | undefined }) {
  const [open, setOpen] = useState(false);
  const color = badgeFor(status);
  const style: React.CSSProperties = {
    background: color === 'yellow' ? '#6a5a1a' : '#2d6a2d',
    cursor: color === 'yellow' ? 'pointer' : 'default',
  };
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        className="badge"
        style={style}
        onClick={() => color === 'yellow' && setOpen(o => !o)}
        title={color === 'yellow' ? 'Click to see review items' : 'All clear'}
      >
        {label} {color === 'yellow' ? '⚠' : '✓'}
      </span>
      {open && summary && summary.human_review_items.length > 0 && (
        <div style={{
          position: 'absolute', top: '1.5em', left: 0, zIndex: 100,
          background: '#1e1e1e', border: '1px solid #555', borderRadius: 6,
          padding: '8px 12px', minWidth: 300, maxWidth: 420,
          fontSize: '0.8em', color: '#ccc', lineHeight: 1.5,
        }}>
          <strong style={{ color: '#fff' }}>Items requiring review:</strong>
          <ul style={{ margin: '6px 0 0', padding: '0 0 0 16px' }}>
            {summary.human_review_items.map((item, i) => (
              <li key={i}>
                <strong>{item.text}</strong> ({item.relationship}) — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

// Change 2: quick-fill chips
const NOTE_CHIPS = [
  'Job posting no longer available',
  'Not a good fit',
  'Already applied elsewhere',
  'Too senior / too junior',
];

export function JobCard({ mode, row, onStatsUpdate, onRemove, onDataChange }: JobCardProps) {
  const [label, setLabel] = useState<Label | null>(row.label ?? null);
  const [appStatus, setAppStatus] = useState<AppStatus>(
    mode === 'apply' ? ((row as ApplyQueueRow).application_status ?? null) : null
  );
  const [notes, setNotes] = useState<string>(row.label_notes ?? '');
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [clOpen, setClOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const applyRow = mode === 'apply' ? (row as ApplyQueueRow) : null;
  const hardRow = mode === 'hard-reject' ? (row as HardRejectionRow) : null;

  const isApplied = appStatus === 'applied';
  const isSkipped = appStatus === 'skipped';     // DB value
  const isApplyLater = appStatus === 'apply_later';
  const isActioned = isApplied || isSkipped;

  // notes override: let doPost accept explicit notes so chips can pass their text
  async function handleGenerate() {
    if (mode !== 'apply') return;
    setGenLoading(true);
    setGenError(null);
    try {
      await postGenerateArtifacts(row.job_id);
      onDataChange?.();
      const fresh = await getStats();
      onStatsUpdate(fresh);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenLoading(false);
    }
  }

  async function doPost(newLabel: Label, newAppStatus?: AppStatus, notesOverride?: string) {
    setSaving(true);
    setError(null);
    const notesVal = notesOverride !== undefined ? notesOverride : (notes === '' ? '' : notes || null);
    try {
      await postLabel({
        job_id: row.job_id,
        run_id: row.run_id,
        label: newLabel,
        application_status: newAppStatus !== undefined ? newAppStatus : null,
        notes: notesVal,
      });
      const fresh = await getStats();
      onStatsUpdate(fresh);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLabel(l: Label) {
    setLabel(l);
    await doPost(l);
  }

  async function handleAppStatus(s: 'applied' | 'skipped' | 'apply_later') {
    if (!label) return;
    setAppStatus(s);
    // Remove card from view immediately — don't wait for POST
    onRemove?.(row.job_id, row.run_id);
    await doPost(label, s);
  }

  async function handleNotesBlur() {
    if (!label) return;
    await doPost(label);
  }

  // Change 2: chip click
  async function handleChip(chipText: string) {
    setNotes(chipText);
    const currentLabel = label ?? 'no';
    if (currentLabel === 'no' && mode === 'apply') {
      // immediate POST + mark as not-applied (skipped)
      setLabel('no');
      setAppStatus('skipped');
      onRemove?.(row.job_id, row.run_id);
      await doPost('no', 'skipped', chipText);
    } else {
      // just fill textarea; user still picks action
      if (!label) {
        setLabel(currentLabel);
        await doPost(currentLabel, undefined, chipText);
      }
      // else just setting notes state is enough — next blur/action will persist
    }
  }

  const labelBtns: { value: Label; text: string }[] = mode === 'apply'
    ? [
        { value: 'yes', text: '👍 Yes' },
        { value: 'maybe', text: '🤔 Maybe' },
        { value: 'no', text: '👎 No' },
      ]
    : mode === 'hard-reject'
    ? [
        { value: 'yes', text: '👍 Yes — would apply (false negative)' },
        { value: 'maybe', text: '🤔 Maybe' },
        { value: 'no', text: '👎 No — correct rejection' },
      ]
    : [
        { value: 'yes', text: '👍 Yes — judge was wrong' },
        { value: 'maybe', text: '🤔 Maybe' },
        { value: 'no', text: '👎 No — judge was right' },
      ];

  const cardClass = [
    'job-card',
    isApplied ? 'state-applied' : '',
    isSkipped ? 'state-skipped' : '',        // "Not Applied" state
    isApplyLater ? 'state-apply-later' : '',
    label && !isActioned && !isApplyLater ? 'state-labeled' : '',
  ].filter(Boolean).join(' ');

  const hasScore = 'score_total' in row;
  const hasJudge = 'judge_verdict' in row;

  return (
    <div className={cardClass}>
      <div className="card-header">
        <div className="card-title-row">
          <span className="job-title">{row.title}</span>
          {isApplied    && <span className="status-badge applied">✓ Applied</span>}
          {isSkipped    && <span className="status-badge not-applied">⊘ Not Applied</span>}
          {isApplyLater && <span className="status-badge apply-later">⏱ Apply Later</span>}
        </div>
        <div className="card-meta">
          <span className="company">{row.company}</span>
          <SourceBadge source={row.source} />
          <span className="scraped-date">{fmtDate(row.scraped_at)}</span>
          {hasJudge && <BucketBadge bucket={(row as ApplyQueueRow).bucket} />}
          {hasJudge && <VerdictBadge verdict={(row as ApplyQueueRow).judge_verdict} />}
        </div>
      </div>

      {hasScore && (
        <div className="score-row">
          <span className="score-total">{fmtScore((row as ApplyQueueRow).score_total)}%</span>
          <span className="subscore">Skills {fmtScore((row as ApplyQueueRow).skills)}%</span>
          <span className="subscore">Sem {fmtScore((row as ApplyQueueRow).semantic)}%</span>
          <span className="subscore">YoE {fmtScore((row as ApplyQueueRow).yoe)}%</span>
          <span className="subscore">Sen {fmtScore((row as ApplyQueueRow).seniority)}%</span>
          <span className="subscore">Loc {fmtScore((row as ApplyQueueRow).location)}%</span>
        </div>
      )}

      {hardRow && (
        <div className="reject-reason">
          <span className="reason-label">Reason:</span> {hardRow.reason}
          {hardRow.flags && Object.keys(hardRow.flags).length > 0 && (
            <div className="flags">
              {Object.entries(hardRow.flags).map(([k, v]) => (
                <span key={k} className="flag-tag">{k}: {String(v)}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {hasJudge && (
        <div className="collapsible">
          <button className="collapse-btn" onClick={() => setReasoningOpen(o => !o)}>
            {reasoningOpen ? '▼' : '▶'} Judge Reasoning
          </button>
          {reasoningOpen && (
            <div className="collapse-content reasoning">{(row as ApplyQueueRow).reasoning}</div>
          )}
          {(row as ApplyQueueRow).concerns && (row as ApplyQueueRow).concerns!.length > 0 && (
            <div className="concerns">
              <span className="concerns-label">Concerns:</span>
              <ul>
                {(row as ApplyQueueRow).concerns!.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {applyRow && (
        <div className="artifact-actions">
          {applyRow.artifact_flags && applyRow.artifact_flags.length > 0 && (
            <div
              className={`artifact-flags-badge${artifactFlagsNeedWarning(applyRow.artifact_flags) ? ' artifact-flags-warn' : ''}`}
              title={applyRow.artifact_flags.join(', ')}
            >
              {artifactFlagsNeedWarning(applyRow.artifact_flags) ? 'Artifact issue' : 'Flags'}:{' '}
              {applyRow.artifact_flags.join(', ')}
            </div>
          )}
          {(applyRow.resume_word_count != null || applyRow.cover_word_count != null) && (
            <span className="artifact-word-counts">
              {applyRow.resume_word_count != null && (
                <span>Resume {applyRow.resume_word_count}w</span>
              )}
              {applyRow.resume_word_count != null && applyRow.cover_word_count != null && ' · '}
              {applyRow.cover_word_count != null && (
                <span>Cover {applyRow.cover_word_count}w</span>
              )}
            </span>
          )}
          <button
            type="button"
            className="gen-btn"
            onClick={handleGenerate}
            disabled={genLoading}
          >
            {genLoading ? '…' : applyRow.cover_pdf_url || applyRow.resume_pdf_url ? 'Regenerate' : 'Generate'}
          </button>
          {genError && (
            <span className="gen-error">
              {genError}{' '}
              <button type="button" className="gen-retry-inline" onClick={handleGenerate} disabled={genLoading}>
                Try again
              </button>
            </span>
          )}
          <div className="artifact-pdf-links">
            {applyRow.resume_pdf_url && (
              <a href={applyRow.resume_pdf_url} target="_blank" rel="noopener noreferrer">Resume PDF</a>
            )}
            {applyRow.cover_pdf_url && (
              <a href={applyRow.cover_pdf_url} target="_blank" rel="noopener noreferrer">Cover letter PDF</a>
            )}
            {applyRow.job_description_url && (
              <a href={applyRow.job_description_url} target="_blank" rel="noopener noreferrer">View JD</a>
            )}
          </div>
          {(applyRow.resume_pdf_url || applyRow.cover_pdf_url) && (
            <div className="risk-badges" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {applyRow.resume_pdf_url && (
                <RiskBadge
                  label="Resume"
                  status={applyRow.resume_export_status}
                  summary={applyRow.resume_risk_summary}
                />
              )}
              {applyRow.cover_pdf_url && (
                <RiskBadge
                  label="Cover"
                  status={applyRow.cover_export_status}
                  summary={applyRow.cover_risk_summary}
                />
              )}
            </div>
          )}
        </div>
      )}

      {applyRow && (
        <div className="collapsible">
          <button className="collapse-btn" onClick={() => setClOpen(o => !o)}>
            {clOpen ? '▼' : '▶'} Cover Letter
          </button>
          {clOpen && (
            <div className="collapse-content cover-letter">
              {applyRow.cover_letter
                ? <pre>{applyRow.cover_letter}</pre>
                : applyRow.cover_pdf_url
                ? <p className="cover-pdf-note">Cover letter is available as PDF (see link above).</p>
                : <em>No cover letter generated yet.</em>
              }
            </div>
          )}
        </div>
      )}

      {applyRow?.applied_at && (
        <div className="applied-date">Applied: {fmtDate(applyRow.applied_at)}</div>
      )}

      <div className="card-actions">
        <div className="action-links">
          <a
            href={row.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="open-btn"
          >
            Open Job ↗
          </a>
          {row.jobright_id && (
            <a
              href={`https://jobright.ai/jobs/info/${row.jobright_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="open-btn jobright-btn"
            >
              View on Jobright ↗
            </a>
          )}
        </div>

        <div className="label-btns">
          {labelBtns.map(btn => (
            <button
              key={btn.value}
              className={`label-btn label-${btn.value}${label === btn.value ? ' active' : ''}`}
              onClick={() => handleLabel(btn.value)}
              disabled={saving}
            >
              {btn.text}
            </button>
          ))}
        </div>

        {/* Change 2: quick-fill chips — shown when any label is set */}
        {label && (
          <div className="note-chips">
            {NOTE_CHIPS.map(chip => (
              <button
                key={chip}
                className={`chip${notes === chip ? ' active' : ''}`}
                onClick={() => handleChip(chip)}
                disabled={saving}
                title={label === 'no' && mode === 'apply' ? 'Fill note and mark Not Applied' : 'Fill note'}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Change 3: three secondary action buttons for apply mode */}
        {mode === 'apply' && label && label !== 'no' && (
          <div className="app-status-btns">
            <button
              className={`app-btn applied${appStatus === 'applied' ? ' active' : ''}`}
              onClick={() => handleAppStatus('applied')}
              disabled={saving}
            >
              ✓ Applied
            </button>
            <button
              className={`app-btn apply-later${appStatus === 'apply_later' ? ' active' : ''}`}
              onClick={() => handleAppStatus('apply_later')}
              disabled={saving}
            >
              ⏱ Apply Later
            </button>
            <button
              className={`app-btn not-applied${appStatus === 'skipped' ? ' active' : ''}`}
              onClick={() => handleAppStatus('skipped')}
              disabled={saving}
            >
              ⊘ Not Applied
            </button>
          </div>
        )}

        <textarea
          className="notes-input"
          placeholder="Notes…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          rows={2}
        />

        {error && <div className="card-error">{error}</div>}
      </div>
    </div>
  );
}

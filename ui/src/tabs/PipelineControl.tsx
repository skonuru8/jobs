import { useState, useEffect, useRef, useCallback } from 'react';
import { Segmented } from '../components/Segmented';
import { Power, Copy, Eraser, ScrollDown } from '../icons';
import {
  getOrchestratorStatus,
  postOrchestratorToggle,
  runPipeline,
  streamRunLog,
  getRunHistory,
} from '../api';
import type {
  OrchestratorStatus,
  PipelineRunBody,
  PipelineSource,
  PostedWithin,
  RunRow,
} from '../api';
import './PipelineControl.css';

interface Props {
  refreshKey: number;
}

type LineKind = 'err' | 'warn' | 'pipeline' | 'normal';
interface TermLine {
  id: number;
  ts: string;
  text: string;
  kind: LineKind;
}

const MAX_LINES = 5000;

const SOURCES: Array<{ id: PipelineSource; name: string; note: string }> = [
  { id: 'dice',         name: 'dice',         note: 'public search page, no auth' },
  { id: 'jobright_api', name: 'jobright_api', note: 'authenticated API feed' },
  { id: 'linkedin',     name: 'linkedin',     note: 'JobSpy feed, no auth' },
];

type OptKey = 'extract' | 'score' | 'judge' | 'cover' | 'skipDedup' | 'skipPersist' | 'verify';
const TOGGLES: Array<{ key: OptKey; label: string; desc: string }> = [
  { key: 'extract',     label: 'EXTRACT',      desc: 'LLM extract JD fields (turns on score, judge, cover)' },
  { key: 'score',       label: 'SCORE',        desc: 'score scraped jobs' },
  { key: 'judge',       label: 'JUDGE',        desc: 'LLM judge verdicts' },
  { key: 'cover',       label: 'COVER',        desc: 'generate cover letters' },
  { key: 'skipDedup',   label: 'SKIP_DEDUP',   desc: 'bypass Redis and pgvector dedup' },
  { key: 'skipPersist', label: 'SKIP_PERSIST', desc: 'bypass Postgres persistence' },
  { key: 'verify',      label: 'VERIFY',       desc: 'Redis vs Postgres integrity check' },
];

function classify(text: string): LineKind {
  if (text.includes('ERROR')) return 'err';
  if (text.includes('WARN')) return 'warn';
  if (text.startsWith('[pipeline]')) return 'pipeline';
  return 'normal';
}

// HH:MM:SS at the render moment (when the line enters component state).
function fmtClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtSince(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmtClock(d);
}

export function PipelineControl({ refreshKey }: Props) {
  // Region 1 state
  const [orch, setOrch] = useState<OrchestratorStatus | null>(null);
  const [orchToggling, setOrchToggling] = useState(false);

  // Region 2 + 3 state (form). Only an explicit reset clears this, never a source switch.
  const [source, setSource] = useState<PipelineSource>('dice');
  const [mode, setMode] = useState<'scrape' | 'new'>('scrape');
  const [max, setMax] = useState(20);
  const [pool, setPool] = useState(50);
  const [query, setQuery] = useState('');
  const [postedWithin, setPostedWithin] = useState<PostedWithin>('');
  const [hoursOld, setHoursOld] = useState(24);
  const [jsonl, setJsonl] = useState('');
  const [opts, setOpts] = useState<Record<OptKey, boolean>>({
    extract: false, score: false, judge: false, cover: false,
    skipDedup: false, skipPersist: false, verify: false,
  });

  // Region 5 state (terminal)
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState(false);
  const [scrollLock, setScrollLock] = useState(true);

  // Region 6 state
  const [runs, setRuns] = useState<RunRow[]>([]);

  const termRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lineId = useRef(0);

  const replay = jsonl.trim().length > 0;
  const diceOnly = source === 'dice' && !replay;
  const linkedinOnly = source === 'linkedin' && !replay;
  const newMode = mode === 'new' && !replay;

  // Derived stage truth: EXTRACT forces score/judge/cover on (run-pipeline.ts).
  const forcedBy = (k: OptKey) => (k === 'score' || k === 'judge' || k === 'cover') && opts.extract;
  const checkedOf = (k: OptKey) => (forcedBy(k) ? true : opts[k]);

  const refetchRuns = useCallback(async () => {
    try {
      const rows = await getRunHistory();
      setRuns(rows.slice(0, 5));
    } catch { /* leave previous list */ }
  }, []);

  // Mount + tab re-entry: load orchestrator status and recent runs. No polling.
  useEffect(() => {
    let alive = true;
    getOrchestratorStatus().then(s => { if (alive) setOrch(s); }).catch(() => { if (alive) setOrch({ running: false }); });
    void refetchRuns();
    return () => { alive = false; };
  }, [refreshKey, refetchRuns]);

  // Close any open stream when the region unmounts (tab switch). No leak, zero
  // network traffic while this tab is inactive.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Auto-scroll to bottom on new output unless the user scrolled up.
  useEffect(() => {
    if (!scrollLock) return;
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, scrollLock]);

  const appendLine = useCallback((text: string) => {
    const ts = fmtClock(new Date());
    const id = ++lineId.current;
    setLines(prev => {
      const next = prev.concat({ id, ts, text, kind: classify(text) });
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const onTermScroll = useCallback(() => {
    const el = termRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setScrollLock(prev => (prev === atBottom ? prev : atBottom));
  }, []);

  const toggleLock = () => {
    setScrollLock(prev => {
      const next = !prev;
      if (next) requestAnimationFrame(() => {
        const el = termRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return next;
    });
  };

  const buildBody = (): PipelineRunBody => ({
    source,
    // In "N new" mode, MAX is the scrape pool and `max` (the count field) is the
    // new-job target; otherwise `max` is the plain scrape count.
    max: newMode ? pool : max,
    targetNew: newMode ? max : undefined,
    extract: opts.extract,
    score: opts.score,
    judge: opts.judge,
    cover: opts.cover,
    skipDedup: opts.skipDedup,
    skipPersist: opts.skipPersist,
    verify: opts.verify,
    query: diceOnly ? (query.trim() || undefined) : undefined,
    postedWithin: diceOnly ? (postedWithin || undefined) : undefined,
    hoursOld: linkedinOnly ? hoursOld : undefined,
    jsonl: replay ? jsonl.trim() : undefined,
  });

  const endStream = useCallback(() => {
    setRunning(false);
    abortRef.current = null;
    void refetchRuns();
  }, [refetchRuns]);

  const beginStream = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    lineId.current = 0;
    setLines([]);
    setScrollLock(true);
    setRunning(true);
    return ctrl;
  }, []);

  const startRun = () => {
    if (running) return;
    const ctrl = beginStream();
    runPipeline(buildBody(), {
      signal: ctrl.signal,
      onLine: appendLine,
      onDone: (code) => { appendLine(`[pipeline] run finished (exit ${code ?? 'unknown'})`); endStream(); },
      onError: (e) => { appendLine(`[pipeline] ERROR ${e.message}`); endStream(); },
    }).catch((e: unknown) => { appendLine(`[pipeline] ERROR ${(e as Error).message}`); endStream(); });
  };

  const replayLog = (runId: string) => {
    if (running) return;
    const ctrl = beginStream();
    appendLine(`[pipeline] replaying log for run ${runId.slice(0, 8)}`);
    streamRunLog(runId, {
      signal: ctrl.signal,
      onLine: appendLine,
      onDone: () => { appendLine('[pipeline] end of log'); endStream(); },
      onError: (e) => { appendLine(`[pipeline] ERROR ${e.message}`); endStream(); },
    }).catch((e: unknown) => { appendLine(`[pipeline] ERROR ${(e as Error).message}`); endStream(); });
  };

  const toggleOrchestrator = async () => {
    if (orch === null || orchToggling) return;
    setOrchToggling(true);
    try {
      const next = await postOrchestratorToggle();
      setOrch(next);
    } catch {
      // Re-read true state on failure rather than guess.
      try { setOrch(await getOrchestratorStatus()); } catch { /* leave as is */ }
    } finally {
      setOrchToggling(false);
    }
  };

  const clearTerminal = () => { lineId.current = 0; setLines([]); };
  const copyAll = () => {
    // Clean text only, no timestamps.
    void navigator.clipboard?.writeText(lines.map(l => l.text).join('\n'));
  };

  // Region 4 live pre-flight summary, reflecting derived stage truth.
  const stages = ([
    opts.extract && 'extract',
    (opts.extract || opts.score) && 'score',
    (opts.extract || opts.judge) && 'judge',
    (opts.extract || opts.cover) && 'cover',
  ].filter(Boolean) as string[]);
  const stagesLabel = replay ? 'replay' : (stages.length ? stages.join('+') : 'scrape only');
  const skips = ([
    opts.skipDedup && 'skip-dedup',
    opts.skipPersist && 'skip-persist',
    opts.verify && 'verify',
  ].filter(Boolean) as string[]);
  const skipsLabel = skips.length ? skips.join(' ') : 'no skips';
  const recencyLabel = replay ? '' : diceOnly && postedWithin ? `posted: ${postedWithin}` : linkedinOnly ? `hours: ${hoursOld}` : '';
  const countLabel = replay ? '-' : newMode ? `${max} new (pool ${pool})` : `${max}`;
  const running01 = orch?.running;

  return (
    <div className="pc">

      {/* Region 1: orchestrator strip */}
      <section className="pc-orch">
        <div className="pc-orch-state">
          <span className={`pc-dot ${running01 ? 'on' : 'off'}`} aria-hidden />
          <span className="pc-orch-word">{running01 ? 'RUNNING' : 'STOPPED'}</span>
          {running01 && orch?.startedAt && (
            <span className="pc-orch-since">since {fmtSince(orch.startedAt)}{orch.pid ? ` (pid ${orch.pid})` : ''}</span>
          )}
          {orch === null && <span className="pc-orch-since">reading status</span>}
        </div>
        <button
          className={`pc-power ${running01 ? 'stop' : 'start'}`}
          onClick={toggleOrchestrator}
          disabled={orch === null || orchToggling}
        >
          <Power width={15} height={15} />
          {running01 ? 'Stop orchestrator' : 'Start orchestrator'}
        </button>
      </section>

      {/* Region 2: source selector (tile grid) */}
      <section className="pc-sources">
        {SOURCES.map(s => (
          <button
            key={s.id}
            className={`pc-tile ${source === s.id ? 'on' : ''}`}
            onClick={() => setSource(s.id)}
            aria-pressed={source === s.id}
          >
            <span className="pc-tile-name">{s.name}</span>
            <span className="pc-tile-note">{s.note}</span>
          </button>
        ))}
      </section>

      {/* Region 3: options panel (two-column form grid) */}
      <section className="pc-options">
        <div className="pc-col">
          <div className={`pc-field ${replay ? 'dim' : ''}`}>
            <span className="pc-flabel">MODE</span>
            <Segmented<'scrape' | 'new'>
              value={mode}
              options={[
                { value: 'scrape', label: 'scrape N' },
                { value: 'new', label: 'N new' },
              ]}
              onChange={setMode}
            />
          </div>

          <label className={`pc-field ${replay ? 'dim' : ''}`}>
            <span className="pc-flabel">{newMode ? 'NEW' : 'MAX'} <em>{newMode ? 'target new jobs' : 'scrape count'}</em></span>
            <input
              className="pc-input num"
              type="number"
              min={1}
              value={max}
              onChange={e => setMax(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
            />
          </label>

          <label className={`pc-field ${newMode ? '' : 'dim'}`}>
            <span className="pc-flabel">POOL <em>scrape cap, N-new mode</em></span>
            <input
              className="pc-input num"
              type="number"
              min={1}
              value={pool}
              onChange={e => setPool(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
            />
          </label>

          <label className={`pc-field ${diceOnly ? '' : 'dim'}`}>
            <span className="pc-flabel">QUERY <em>dice only</em></span>
            <input
              className="pc-input"
              type="text"
              placeholder="java developer"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>

          <div className={`pc-field ${diceOnly ? '' : 'dim'}`}>
            <span className="pc-flabel">POSTED_WITHIN <em>dice only</em></span>
            <Segmented<PostedWithin>
              value={postedWithin}
              options={[
                { value: 'ONE', label: '1 day' },
                { value: 'THREE', label: '3 days' },
                { value: 'SEVEN', label: '7 days' },
              ]}
              onChange={setPostedWithin}
            />
          </div>

          <label className={`pc-field ${linkedinOnly ? '' : 'dim'}`}>
            <span className="pc-flabel">HOURS_OLD <em>linkedin only</em></span>
            <input
              className="pc-input num"
              type="number"
              min={1}
              value={hoursOld}
              onChange={e => setHoursOld(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
            />
          </label>

          <label className="pc-field">
            <span className="pc-flabel">JSONL <em>replay mode, optional</em></span>
            <input
              className="pc-input"
              type="text"
              placeholder="output/raw/dice-2026-06-16.jsonl"
              value={jsonl}
              onChange={e => setJsonl(e.target.value)}
            />
          </label>
        </div>

        <div className="pc-col">
          {TOGGLES.map(t => {
            const dim = forcedBy(t.key);
            const on = checkedOf(t.key);
            return (
              <label key={t.key} className={`pc-toggle ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}>
                <input
                  type="checkbox"
                  className="pc-checkbox"
                  checked={on}
                  disabled={dim}
                  onChange={() => setOpts(o => ({ ...o, [t.key]: !o[t.key] }))}
                />
                <span className="pc-track" aria-hidden><span className="pc-knob" /></span>
                <span className="pc-toggle-txt">
                  <span className="pc-toggle-name">{t.label}</span>
                  <span className="pc-toggle-desc">{dim ? `${t.desc} (forced by EXTRACT)` : t.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Region 4: run trigger (sticky bottom bar) */}
      <section className="pc-runbar">
        <div className="pc-summary">
          <span className="pc-summary-k">source:</span> <b>{replay ? 'replay' : source}</b>
          <span className="pc-summary-sep" />
          <span className="pc-summary-k">{newMode ? 'jobs:' : 'max:'}</span> <b>{countLabel}</b>
          {recencyLabel && <><span className="pc-summary-sep" /><span className="pc-summary-skips">{recencyLabel}</span></>}
          <span className="pc-summary-sep" />
          <b className="pc-summary-stages">{stagesLabel}</b>
          <span className="pc-summary-sep" />
          <span className="pc-summary-skips">{skipsLabel}</span>
        </div>
        <button className="pc-run" onClick={startRun} disabled={running}>
          <span className="pc-run-fill" aria-hidden />
          <span className="pc-run-label">{running ? 'Running...' : 'Run Pipeline'}</span>
        </button>
      </section>

      {/* Region 5: terminal pane (canvas) */}
      <section className="pc-term-wrap">
        <div className="pc-term-bar">
          <span className="pc-term-title">stdout / stderr</span>
          <div className="pc-term-tools">
            <button className="pc-tool" onClick={clearTerminal} title="Clear"><Eraser width={14} height={14} /></button>
            <button className="pc-tool" onClick={copyAll} title="Copy all"><Copy width={14} height={14} /></button>
            <button
              className={`pc-tool ${scrollLock ? 'on' : ''}`}
              onClick={toggleLock}
              title={scrollLock ? 'Scroll lock on (following)' : 'Scroll lock off'}
            >
              <ScrollDown width={14} height={14} />
            </button>
          </div>
        </div>
        <div className="pc-term" ref={termRef} onScroll={onTermScroll}>
          {lines.length === 0 ? (
            <div className="pc-term-idle">Waiting for run...</div>
          ) : (
            lines.map(l => (
              <div key={l.id} className={`pc-line ${l.kind}`}>
                <span className="pc-line-ts">[{l.ts}]</span>
                <span className="pc-line-tx">{l.text || '� '}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Region 6: recent runs micro-list (compact table) */}
      <section className="pc-runs">
        <table className="pc-runs-table">
          <thead>
            <tr>
              <th>source</th><th>started</th><th>exit</th><th className="r">scraped</th><th className="r">covered</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr><td colSpan={5} className="pc-runs-empty">No runs yet</td></tr>
            ) : (
              runs.map(r => {
                const chip = r.exit_code === 0 ? 'ok' : r.exit_code === null ? 'running' : 'failed';
                return (
                  <tr key={r.run_id} className="pc-runs-row" onClick={() => replayLog(r.run_id)} title="Replay this run log">
                    <td className="mono">{r.source}</td>
                    <td className="mono">{fmtSince(r.started_at)}</td>
                    <td><span className={`pc-exit ${chip}`}>{r.exit_code === null ? '--' : r.exit_code}</span></td>
                    <td className="r mono">{r.scraped_count ?? '--'}</td>
                    <td className="r mono">{r.covered_count ?? '--'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

    </div>
  );
}

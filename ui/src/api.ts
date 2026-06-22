export interface ApplyQueueRow {
  job_id: string;
  run_id: string;
  title: string;
  company: string;
  source_url: string;
  source: string;
  scraped_at: string;
  jobright_id: string | null;
  score_total: number;
  skills: number;
  semantic: number;
  yoe: number;
  seniority: number;
  location: number;
  judge_verdict: 'STRONG' | 'MAYBE' | 'WEAK';
  bucket: 'COVER_LETTER' | 'REVIEW_QUEUE' | 'RESULTS' | 'ARCHIVE';
  reasoning: string;
  concerns: string[] | null;
  cover_letter: string | null;
  resume_pdf_url?: string | null;
  cover_pdf_url?: string | null;
  resume_word_count?: number | null;
  cover_word_count?: number | null;
  artifact_flags?: string[];
  label: 'yes' | 'maybe' | 'no' | null;
  label_notes: string | null;
  application_status: 'applied' | 'skipped' | 'apply_later' | null;
  applied_at: string | null;
  archived_at: string | null;
  drive_folder_id: string | null;
  required_skills_with_risk?: unknown[] | null;
  judge_concerns?: string[] | null;
  concern_answers?: Array<{ concern: string; answer: string; status: string }>;
  /** Link to saved job_description.md under output/applications/<slug>/ */
  job_description_url?: string | null;
  resume_risk_summary?:  RiskSummary | null;
  resume_export_status?: "ok" | "needs_review";
  cover_risk_summary?:   RiskSummary | null;
  cover_export_status?:  "ok" | "needs_review";
}

export interface RiskSummary {
  counts: {
    exact:                 number;
    reworded:              number;
    direct_equivalent:     number;
    adjacent:              number;
    unsupported_inference: number;
    fabricated:            number;
  };
  human_review_items: Array<{
    text:         string;
    relationship: string;
    reason:       string;
  }>;
  total_claims_audited: number;
}

export interface HardRejectionRow {
  job_id: string;
  run_id: string;
  title: string;
  company: string;
  source_url: string;
  source: string;
  scraped_at: string;
  jobright_id: string | null;
  reason: string;
  flags: Record<string, unknown> | null;
  label: 'yes' | 'maybe' | 'no' | null;
  label_notes: string | null;
}

export interface SoftRejectionRow {
  job_id: string;
  run_id: string;
  title: string;
  company: string;
  source_url: string;
  source: string;
  scraped_at: string;
  jobright_id: string | null;
  score_total: number;
  skills: number;
  semantic: number;
  yoe: number;
  seniority: number;
  location: number;
  judge_verdict: 'STRONG' | 'MAYBE' | 'WEAK';
  bucket: string;
  reasoning: string;
  concerns: string[] | null;
  label: 'yes' | 'maybe' | 'no' | null;
  label_notes: string | null;
}

export interface Stats {
  pending: number;
  applyLater: number;
  applied: number;
  hardRejectionsUnreviewed: number;
  softRejectionsUnreviewed: number;
}

export interface RunRow {
  run_id: string;
  source: string;
  status: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  scraped_count: number | null;
  passed_count: number | null;
  extraction_count: number | null;
  covered_count: number | null;
}

export interface AppliedDayRow extends ApplyQueueRow {
  applied_at: string;
}

export interface LabelPayload {
  job_id: string;
  run_id: string;
  label: 'yes' | 'maybe' | 'no';
  application_status?: 'applied' | 'skipped' | 'apply_later' | null;
  notes?: string | null;
}

export async function getApplyQueue(): Promise<ApplyQueueRow[]> {
  const res = await fetch('/api/apply-queue');
  if (!res.ok) throw new Error(`apply-queue failed: ${res.status}`);
  return res.json();
}

export async function getHardRejections(): Promise<HardRejectionRow[]> {
  const res = await fetch('/api/rejections-hard');
  if (!res.ok) throw new Error(`rejections-hard failed: ${res.status}`);
  return res.json();
}

export async function getSoftRejections(): Promise<SoftRejectionRow[]> {
  const res = await fetch('/api/rejections-soft');
  if (!res.ok) throw new Error(`rejections-soft failed: ${res.status}`);
  return res.json();
}

export async function getStats(scope: 'total' | 'today' = 'total'): Promise<Stats> {
  const url = scope === 'today' ? '/api/stats?scope=today' : '/api/stats';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stats failed: ${res.status}`);
  return res.json();
}

export async function getRunHistory(): Promise<RunRow[]> {
  const res = await fetch('/api/run-history');
  if (!res.ok) throw new Error(`run-history failed: ${res.status}`);
  return res.json();
}

export async function getAppliedJobs(): Promise<ApplyQueueRow[]> {
  const res = await fetch('/api/applied-jobs');
  if (!res.ok) throw new Error(`applied-jobs failed: ${res.status}`);
  return res.json();
}

export async function getResumeTex(jobId: string): Promise<{ tailored: string; canonical: string } | null> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/resume-tex`);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Resume diff API returned HTML. Restart the UI server so /api/jobs/:job_id/resume-tex is available.');
  }
  return res.json();
}

export async function postLabel(body: LabelPayload): Promise<{ ok: true }> {
  const res = await fetch('/api/label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: body.job_id,
      run_id: body.run_id,
      label: body.label,
      application_status: body.application_status ?? null,
      notes: body.notes ?? null,
    }),
  });
  if (!res.ok) throw new Error(`label failed: ${res.status}`);
  return res.json();
}

export async function postGenerateArtifacts(
  jobId: string,
  options?: { force?: boolean; type?: 'resume' | 'cover' | 'both' },
): Promise<{ resume: unknown; cover_letter: unknown }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: options?.force, type: options?.type ?? 'both' }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { detail?: string; error?: string }).detail ?? (j as { error?: string }).error ?? `generate failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Pipeline Control (additive): orchestrator toggle + live run streaming.
// ---------------------------------------------------------------------------

export type PipelineSource = 'dice' | 'jobright_api' | 'linkedin';
export type PostedWithin = 'ONE' | 'THREE' | 'SEVEN' | '';

export interface OrchestratorStatus {
  running: boolean;
  pid?: number;
  startedAt?: string | null;
}

export interface PipelineRunBody {
  source: PipelineSource;
  max: number;
  extract: boolean;
  score: boolean;
  judge: boolean;
  cover: boolean;
  skipDedup: boolean;
  skipPersist: boolean;
  verify: boolean;
  query?: string;
  postedWithin?: PostedWithin;
  hoursOld?: number;
  targetNew?: number;
  jsonl?: string;
}

export interface StreamHandlers {
  onLine: (line: string) => void;
  onDone?: (exitCode: number | null) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

export async function getOrchestratorStatus(): Promise<OrchestratorStatus> {
  const res = await fetch('/api/orchestrator/status');
  if (!res.ok) throw new Error(`orchestrator status failed: ${res.status}`);
  return res.json();
}

export async function postOrchestratorToggle(): Promise<OrchestratorStatus> {
  const res = await fetch('/api/orchestrator/toggle', { method: 'POST' });
  if (!res.ok) throw new Error(`orchestrator toggle failed: ${res.status}`);
  return res.json();
}

// Parses a text/event-stream body framed as `data: <json-string>` blocks with a
// terminal `event: done` frame. Uses fetch + ReadableStream (not EventSource,
// which cannot POST a JSON body). Abort via handlers.signal.
async function readSseStream(body: ReadableStream<Uint8Array>, h: StreamHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const raw of frame.split('\n')) {
          if (raw.startsWith('event:')) event = raw.slice(6).trim();
          else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
        }
        const data = dataLines.join('\n');
        if (event === 'done') {
          let code: number | null = null;
          try { code = (JSON.parse(data) as { exitCode: number | null }).exitCode ?? null; } catch { /* ignore */ }
          h.onDone?.(code);
        } else if (data) {
          let line = data;
          try { line = JSON.parse(data) as string; } catch { /* already plain */ }
          h.onLine(line);
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') h.onError?.(err as Error);
  } finally {
    reader.releaseLock();
  }
}

export async function runPipeline(body: PipelineRunBody, h: StreamHandlers): Promise<void> {
  const res = await fetch('/api/pipeline/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: h.signal,
  });
  if (res.status === 409) throw new Error('A run is already in progress.');
  if (!res.ok || !res.body) throw new Error(`pipeline run failed: ${res.status}`);
  await readSseStream(res.body, h);
}

// Streams the orchestrator log file as an indefinite SSE tail. Ends on abort.
export async function streamOrchestratorLog(h: StreamHandlers): Promise<void> {
  const res = await fetch('/api/orchestrator/log', { signal: h.signal });
  if (!res.ok || !res.body) throw new Error(`orchestrator log failed: ${res.status}`);
  await readSseStream(res.body, h);
}

export async function postArchiveRun(dryRun = false, h: StreamHandlers): Promise<void> {
  const res = await fetch('/api/archive/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun }),
    signal: h.signal,
  });
  if (res.status === 409) throw new Error('An archive run is already in progress.');
  if (res.status === 400) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? 'Archive not configured.');
  }
  if (!res.ok || !res.body) throw new Error(`archive run failed: ${res.status}`);
  await readSseStream(res.body, h);
}

export async function postJobArchive(jobId: string, dryRun = false, h: StreamHandlers): Promise<void> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun }),
    signal: h.signal,
  });
  if (res.status === 409) throw new Error('An archive run is already in progress.');
  if (res.status === 400) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? 'Archive not configured.');
  }
  if (!res.ok || !res.body) throw new Error(`archive run failed: ${res.status}`);
  await readSseStream(res.body, h);
}

// Streams a saved run log file (text/plain) line by line into the same pane.
export async function streamRunLog(runId: string, h: StreamHandlers): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/log`, { signal: h.signal });
  if (res.status === 404) throw new Error('No log file found for this run.');
  if (!res.ok || !res.body) throw new Error(`run log failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        h.onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) h.onLine(buf);
    h.onDone?.(null);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') h.onError?.(err as Error);
  } finally {
    reader.releaseLock();
  }
}

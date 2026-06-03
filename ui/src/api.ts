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
  required_skills_with_risk?: any[] | null;
  judge_concerns?: string[] | null;
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

export async function getStats(): Promise<Stats> {
  const res = await fetch('/api/stats');
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
  options?: { force?: boolean },
): Promise<{ resume: unknown; cover_letter: unknown }> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: options?.force }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { detail?: string; error?: string }).detail ?? (j as { error?: string }).error ?? `generate failed: ${res.status}`);
  }
  return res.json();
}

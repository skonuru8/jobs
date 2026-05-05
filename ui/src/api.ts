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
  label: 'yes' | 'maybe' | 'no' | null;
  label_notes: string | null;
  application_status: 'applied' | 'skipped' | 'apply_later' | null;
  applied_at: string | null;
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

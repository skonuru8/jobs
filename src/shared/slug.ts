/**
 * Job folder slug for resume + cover letter artifacts (stable per job_id).
 */

export function makeJobSlug(
  job: { title: string; company: string; posted_at?: string | null },
  jobId: string,
): string {
  const date = (job.posted_at ?? new Date().toISOString()).slice(0, 10);
  const company = slugify(job.company, 30);
  const role = slugify(job.title, 50);
  const idShort = jobId.slice(0, 8);
  return `${date}_${company}_${role}_${idShort}`;
}

export function slugify(s: string, maxLen: number): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maxLen)
    .replace(/-$/, "");
}

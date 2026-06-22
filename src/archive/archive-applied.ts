/**
 * archive-applied.ts — archives applied job artifacts to Google Drive.
 *
 * Eligibility: application_status = 'applied' AND applied_at < NOW() - AGE_DAYS days
 *              AND labels.archived_at IS NULL
 *
 * Per job: uploads resume_pdf, resume_tex, cover_pdf, cover_tex,
 *          job_description, meta, canonical_tex to Drive (mirroring local folder tree).
 *          Idempotent: skips artifact_kinds already in archived_artifacts.
 *          Marks labels.archived_at after all artifacts for a job succeed.
 *
 * Logs: deletes run log files older than logRetentionDays. Never uploads logs.
 */

import * as fs   from "fs";
import * as path from "path";
import type { Pool } from "pg";
import { getDriveClient, ensureSubfolder, uploadFile } from "./drive-client.js";

export interface ArchiveOptions {
  execute:          boolean;
  ageDays:          number;
  jobId?:           string;
  force?:           boolean;
  pruneLogs:        boolean;
  logRetentionDays: number;
  repoRoot:         string;
  rootFolderId:     string;
  onLog:            (line: string) => void;
}

interface EligibleJob {
  job_id:      string;
  run_id:      string | null;
  title:       string;
  company:     string;
  resume_pdf:  string | null;
  resume_tex:  string | null;
  resume_meta: string | null;
  cover_pdf:   string | null;
  cover_tex:   string | null;
}

async function findEligibleJobs(pool: Pool, ageDays: number): Promise<EligibleJob[]> {
  const result = await pool.query<EligibleJob>(
    `SELECT j.job_id, j.run_id, j.title, j.company,
            tr.pdf_path  AS resume_pdf,
            tr.tex_path  AS resume_tex,
            tr.meta_path AS resume_meta,
            cl.pdf_path  AS cover_pdf,
            cl.tex_path  AS cover_tex
       FROM labels l
       JOIN jobs j ON j.job_id = l.job_id AND j.run_id = l.run_id
       LEFT JOIN LATERAL (
         SELECT pdf_path, tex_path, meta_path
           FROM tailored_resumes
          WHERE job_id = j.job_id
          ORDER BY generated_at DESC NULLS LAST
          LIMIT 1
       ) tr ON true
       LEFT JOIN LATERAL (
         SELECT pdf_path, tex_path
           FROM cover_letters
          WHERE job_id = j.job_id
          ORDER BY generated_at DESC NULLS LAST
          LIMIT 1
       ) cl ON true
      WHERE l.application_status = 'applied'
        AND l.applied_at IS NOT NULL
        AND l.applied_at < NOW() - ($1 || ' days')::INTERVAL
        AND l.archived_at IS NULL`,
    [ageDays],
  );
  return result.rows;
}

async function findJobById(pool: Pool, jobId: string): Promise<EligibleJob[]> {
  const result = await pool.query<EligibleJob>(
    `SELECT j.job_id, j.run_id, j.title, j.company,
            tr.pdf_path  AS resume_pdf,
            tr.tex_path  AS resume_tex,
            tr.meta_path AS resume_meta,
            cl.pdf_path  AS cover_pdf,
            cl.tex_path  AS cover_tex
       FROM jobs j
       LEFT JOIN LATERAL (
         SELECT pdf_path, tex_path, meta_path
           FROM tailored_resumes
          WHERE job_id = j.job_id
          ORDER BY generated_at DESC NULLS LAST
          LIMIT 1
       ) tr ON true
       LEFT JOIN LATERAL (
         SELECT pdf_path, tex_path
           FROM cover_letters
          WHERE job_id = j.job_id
          ORDER BY generated_at DESC NULLS LAST
          LIMIT 1
       ) cl ON true
      WHERE j.job_id = $1
      LIMIT 1`,
    [jobId],
  );
  return result.rows;
}

async function alreadyArchivedKinds(pool: Pool, jobId: string): Promise<Set<string>> {
  const result = await pool.query<{ artifact_kind: string }>(
    `SELECT artifact_kind FROM archived_artifacts WHERE job_id = $1`,
    [jobId],
  );
  return new Set(result.rows.map(r => r.artifact_kind));
}

async function existingDriveFolderId(pool: Pool, jobId: string): Promise<string | null> {
  const result = await pool.query<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id
       FROM archived_artifacts
      WHERE job_id = $1
        AND drive_folder_id IS NOT NULL
      LIMIT 1`,
    [jobId],
  );
  return result.rows[0]?.drive_folder_id ?? null;
}

interface ArtifactSpec {
  kind:    string;
  repoRel: string | null;
}

function buildArtifactSpecs(job: EligibleJob, repoRoot: string): ArtifactSpec[] {
  const metaDir = job.resume_meta
    ? path.dirname(path.join(repoRoot, job.resume_meta))
    : null;

  const specs: ArtifactSpec[] = [
    { kind: "resume_pdf",      repoRel: job.resume_pdf },
    { kind: "resume_tex",      repoRel: job.resume_tex },
    { kind: "cover_pdf",       repoRel: job.cover_pdf },
    { kind: "cover_tex",       repoRel: job.cover_tex },
    {
      kind: "meta",
      repoRel: job.resume_meta,
    },
    {
      kind: "job_description",
      repoRel: metaDir
        ? path.relative(repoRoot, path.join(metaDir, "job_description.md"))
        : null,
    },
    {
      kind: "canonical_tex",
      repoRel: metaDir
        ? path.relative(repoRoot, path.join(metaDir, "canonical.tex"))
        : null,
    },
  ];

  return specs.filter(s => {
    if (!s.repoRel) return false;
    return fs.existsSync(path.join(repoRoot, s.repoRel));
  });
}

export interface ArchiveSummary {
  eligible:   number;
  succeeded:  number;
  failed:     number;
  skipped:    number;
  prunedLogs: number;
  errors:     string[];
}

export async function runArchive(
  pool: Pool,
  opts: ArchiveOptions,
): Promise<ArchiveSummary> {
  const { execute, ageDays, jobId, force, pruneLogs, logRetentionDays, repoRoot, rootFolderId, onLog } = opts;

  const summary: ArchiveSummary = {
    eligible: 0, succeeded: 0, failed: 0, skipped: 0, prunedLogs: 0, errors: [],
  };

  const jobs = jobId
    ? await findJobById(pool, jobId)
    : await findEligibleJobs(pool, ageDays);
  summary.eligible = jobs.length;

  if (jobId && jobs.length === 0) {
    onLog(`[drive-archive] Job ${jobId} not found.`);
    return summary;
  }

  if (!jobId && jobs.length === 0) {
    onLog("[drive-archive] No eligible jobs found.");
  } else if (jobId) {
    onLog(`[drive-archive] Found job ${jobId}.`);
  } else {
    onLog(`[drive-archive] Found ${jobs.length} eligible job(s) (applied_at > ${ageDays} days ago, not yet archived).`);
  }

  if (!execute) {
    onLog("[drive-archive] DRY RUN — pass --execute to upload and mark archived.");
    for (const job of jobs) {
      const specs = buildArtifactSpecs(job, repoRoot);
      onLog(`  ${job.company} — ${job.title} (${job.job_id}) → ${specs.length} artifact(s): ${specs.map(s => s.kind).join(", ")}`);
    }
    return summary;
  }

  if (!rootFolderId) {
    throw new Error("GDRIVE_ARCHIVE_FOLDER_ID is not set — cannot upload.");
  }

  const drive = getDriveClient();

  for (const job of jobs) {
    onLog(`[drive-archive] Archiving: ${job.company} — ${job.title} (${job.job_id})`);

    try {
      const alreadyDone = await alreadyArchivedKinds(pool, job.job_id);
      const specs = buildArtifactSpecs(job, repoRoot);
      const toUpload = force ? specs : specs.filter(s => !alreadyDone.has(s.kind));

      if (specs.length === 0) {
        // No artifacts exist on disk — mark archived so this job stops re-qualifying.
        await pool.query(
          `UPDATE labels
              SET archived_at = NOW(),
                  archived_source = $2
            WHERE job_id = $1`,
          [job.job_id, jobId ? "manual" : "auto"],
        );
        onLog(`  [skip] no artifacts on disk for ${job.job_id} — marked archived`);
        summary.skipped++;
        continue;
      }

      if (toUpload.length === 0) {
        onLog(`  [skip] all artifacts already archived for ${job.job_id}`);
        summary.skipped++;
        continue;
      }

      let jobFolderId = await existingDriveFolderId(pool, job.job_id);
      if (!jobFolderId) {
        const dateStr      = new Date().toISOString().slice(0, 10);
        const dateFolderId = await ensureSubfolder(drive, rootFolderId, dateStr);
        jobFolderId = await ensureSubfolder(drive, dateFolderId, job.job_id);
      }

      for (const spec of toUpload) {
        const absPath  = path.join(repoRoot, spec.repoRel!);
        const filename = path.basename(absPath);
        onLog(`  uploading ${spec.kind}: ${spec.repoRel}`);

        const { fileId, bytes } = await uploadFile(drive, absPath, jobFolderId, filename);

        await pool.query(
          `INSERT INTO archived_artifacts
             (job_id, run_id, artifact_kind, local_path, drive_file_id, drive_folder_id, bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (job_id, artifact_kind) DO UPDATE
             SET drive_file_id   = EXCLUDED.drive_file_id,
                 drive_folder_id = EXCLUDED.drive_folder_id,
                 bytes           = EXCLUDED.bytes,
                 archived_at     = NOW()`,
          [job.job_id, job.run_id, spec.kind, spec.repoRel, fileId, jobFolderId, bytes],
        );
      }

      // Mark job fully archived only when every spec is covered
      const nowDone  = await alreadyArchivedKinds(pool, job.job_id);
      const allKinds = specs.map(s => s.kind);
      if (allKinds.every(k => nowDone.has(k))) {
        await pool.query(
          `UPDATE labels
              SET archived_at = NOW(),
                  archived_source = $2
            WHERE job_id = $1`,
          [job.job_id, jobId ? "manual" : "auto"],
        );
        onLog(`  [done] ${job.job_id} fully archived`);
      }

      summary.succeeded++;
    } catch (e) {
      const msg = `[drive-archive] FAILED ${job.job_id}: ${(e as Error).message}`;
      onLog(msg);
      summary.errors.push(msg);
      summary.failed++;
    }
  }

  if (pruneLogs) {
    summary.prunedLogs = pruneOldLogs(repoRoot, logRetentionDays, onLog);
  }

  onLog(
    `[drive-archive] Done — succeeded=${summary.succeeded} failed=${summary.failed} ` +
    `skipped=${summary.skipped} prunedLogs=${summary.prunedLogs}`,
  );
  return summary;
}

function pruneOldLogs(
  repoRoot: string,
  retentionDays: number,
  onLog: (l: string) => void,
): number {
  const logsDir = path.join(repoRoot, "output", "logs", "runs");
  if (!fs.existsSync(logsDir)) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const day of fs.readdirSync(logsDir, { withFileTypes: true })) {
    if (!day.isDirectory()) continue;
    const dayDir = path.join(logsDir, day.name);
    for (const f of fs.readdirSync(dayDir)) {
      if (!f.endsWith(".log")) continue;
      const abs = path.join(dayDir, f);
      try {
        if (fs.statSync(abs).mtimeMs < cutoff) {
          fs.rmSync(abs);
          pruned++;
        }
      } catch { /* best-effort */ }
    }
  }

  if (pruned > 0) onLog(`[drive-archive] Pruned ${pruned} old log file(s)`);
  return pruned;
}

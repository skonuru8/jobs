/**
 * ui-server.ts — Express API server for the Job Hunter Review UI.
 *
 * Serves built frontend assets plus REST endpoints for queue review, labeling,
 * artifact generation, and resume inspection against pipeline persistence data.
 *
 * Called by: `npx tsx scripts/ui-server.ts`, local UI workflows
 * Writes to: Postgres label rows, generated artifact folders via manual generation
 * Side effects: runs DB migrations, reads artifact/meta files from disk, starts HTTP server on port 3001
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import { getPool } from '../src/storage/db.js';
import { manualGenerateArtifacts } from '../src/artifacts/manual-generate.js';
import { makeJobSlug } from '../src/shared/slug.js';
import { makeSafeJobId } from '../src/applications/run-folder.js';
import { loadRiskMap } from '../src/risk-map/index.js';
import { runArchive } from '../src/archive/archive-applied.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
loadEnv({ path: path.join(REPO_ROOT, '.env') });

/**
 * Cover letter content is stored on disk (content col is NULL in DB).
 * The stored file_path may reference an old repo location; resolve it
 * by trying the stored path first, then substituting the current repo root.
 *
 * @param filePath - Stored markdown path from artifact row, possibly from older repo root.
 * @returns Cover letter markdown content when readable; otherwise `null`.
 */
function readCoverLetter(filePath: string | null): string | null {
  if (!filePath) return null;
  const candidates = [
    filePath,
    filePath.replace('/Users/skonuru/Downloads/project/', '/Users/skonuru/Downloads/jobs/'),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch {
      // try next
    }
  }
  return null;
}

function toUrl(p: string | null): string | null {
  return p ? `/${String(p).replace(/\\/g, '/')}` : null;
}

function jobDescriptionApiUrl(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/job-description`;
}

function findJobDescriptionPathBySlug(slug: string): string | null {
  const baseDir = path.join(REPO_ROOT, 'output', 'applications');
  if (!fs.existsSync(baseDir)) return null;

  let newestPath: string | null = null;
  let newestMtime = -1;

  for (const day of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!day.isDirectory()) continue;
    const dayDir = path.join(baseDir, day.name);
    for (const run of fs.readdirSync(dayDir, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const candidate = path.join(dayDir, run.name, slug, 'job_description.md');
      if (!fs.existsSync(candidate)) continue;
      const mtime = fs.statSync(candidate).mtimeMs;
      if (mtime > newestMtime) {
        newestMtime = mtime;
        newestPath = candidate;
      }
    }
  }

  return newestPath;
}

function resolveJobDescriptionPath(job: {
  job_id: string;
  title: string | null;
  company: string | null;
  posted_at: string | null;
}, metaPath?: string | null): string | null {
  if (metaPath) {
    const candidate = path.join(REPO_ROOT, path.dirname(metaPath), 'job_description.md');
    if (fs.existsSync(candidate)) return candidate;
  }

  // Stable manual folder (output/applications/manual/{safeId}/job_description.md)
  // keyed by job id only; overwritten in place on each regenerate.
  const manualCandidate = path.join(
    REPO_ROOT,
    'output',
    'applications',
    'manual',
    makeSafeJobId(job.job_id),
    'job_description.md',
  );
  if (fs.existsSync(manualCandidate)) return manualCandidate;

  const postedIso = job.posted_at ? new Date(job.posted_at).toISOString() : null;
  const slug = makeJobSlug(
    { title: job.title ?? '', company: job.company ?? '', posted_at: postedIso },
    job.job_id,
  );
  return findJobDescriptionPathBySlug(slug);
}

// ---------------------------------------------------------------------------
// Pipeline Control state + helpers (additive, no existing behavior touched).
//
// The cron orchestrator is `src/orchestrator/index.ts` (spawned via tsx). We
// track the child handle in-memory and mirror {pid, startedAt} to a pidfile so
// `status` survives a ui-server restart while the orchestrator keeps running.
// ---------------------------------------------------------------------------

const ORCH_PIDFILE = path.join(REPO_ROOT, 'output', '.orchestrator.pid');
const ORCH_LOG    = path.join(REPO_ROOT, 'output', 'logs', 'orchestrator.log');
let orchestratorChild: ChildProcess | null = null;
let orchestratorStartedAt: string | null = null;
let pipelineRunning = false;
let archiveRunning  = false;

// Strips ANSI CSI sequences (SGR color codes like \x1b[32m plus cursor/erase
// codes), so no raw escape sequence reaches the browser terminal pane.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readOrchestratorPidfile(): { pid: number; startedAt: string | null } | null {
  try {
    const j = JSON.parse(fs.readFileSync(ORCH_PIDFILE, 'utf8')) as { pid: number; startedAt: string | null };
    if (j && typeof j.pid === 'number' && pidAlive(j.pid)) return j;
  } catch { /* no/invalid pidfile */ }
  return null;
}

function writeOrchestratorPidfile(pid: number, startedAt: string): void {
  try {
    fs.mkdirSync(path.dirname(ORCH_PIDFILE), { recursive: true });
    fs.writeFileSync(ORCH_PIDFILE, JSON.stringify({ pid, startedAt }), 'utf8');
  } catch { /* best-effort */ }
}

function clearOrchestratorPidfile(): void {
  try { fs.unlinkSync(ORCH_PIDFILE); } catch { /* already gone */ }
}

function orchestratorState(): { running: boolean; pid?: number; startedAt?: string | null } {
  if (orchestratorChild && orchestratorChild.exitCode === null && orchestratorChild.pid && pidAlive(orchestratorChild.pid)) {
    return { running: true, pid: orchestratorChild.pid, startedAt: orchestratorStartedAt };
  }
  const fromFile = readOrchestratorPidfile();
  if (fromFile) return { running: true, pid: fromFile.pid, startedAt: fromFile.startedAt };
  return { running: false };
}

// Locates a run's log file under output/logs/runs/<day>/ by matching the run_id
// (or its sanitized 8-char prefix, which is what installRunLog embeds).
function findRunLog(runId: string): string | null {
  const baseDir = path.join(REPO_ROOT, 'output', 'logs', 'runs');
  if (!fs.existsSync(baseDir)) return null;
  const needle = runId.replace(/[^a-zA-Z0-9_-]/g, '');
  const short = needle.slice(0, 8);
  let newest: string | null = null;
  let newestMtime = -1;
  for (const day of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!day.isDirectory()) continue;
    const dayDir = path.join(baseDir, day.name);
    for (const f of fs.readdirSync(dayDir)) {
      if (!f.endsWith('.log')) continue;
      if (!(needle && f.includes(needle)) && !(short && f.includes(short))) continue;
      const abs = path.join(dayDir, f);
      const mtime = fs.statSync(abs).mtimeMs;
      if (mtime > newestMtime) { newestMtime = mtime; newest = abs; }
    }
  }
  return newest;
}

/**
 * Boots review API server, applies required schema migrations, and mounts all
 * endpoints needed by frontend queue triage workflow.
 *
 * @returns Promise that resolves once server starts listening.
 * @throws Rejects on startup failures such as DB connectivity or migration errors.
 */
async function main() {
  const pool = getPool();

  for (const mig of [
    '004_ui_application_tracking.sql',
    '005_tailored_artifacts.sql',
    '006_consolidate_artifacts.sql',
    '007_fabrication_ledger.sql',
    '008_visa_enum.sql',
    '009_cover_letter_artifact_columns.sql',
    '010_ledger_run_id_text.sql',
    '011_ledger_truth_distance_numeric.sql',
    '013_drive_archival.sql',
    '014_concern_answers.sql',
  ]) {
    const migrationPath = path.join(REPO_ROOT, 'migrations', mig);
    if (fs.existsSync(migrationPath)) {
      await pool.query(fs.readFileSync(migrationPath, 'utf-8'));
    }
  }

  loadRiskMap(REPO_ROOT);
  console.log('[ui-server] risk map loaded');

  const app = express();
  app.use(express.json());

  app.use('/output', express.static(path.join(REPO_ROOT, 'output')));

  // Serve production build
  app.use(express.static(path.join(__dirname, '../ui/dist')));

  // -------------------------------------------------------------------------
  // GET /api/apply-queue
  // -------------------------------------------------------------------------
  // `GET /api/apply-queue` — list latest actionable jobs with artifact links and risk metadata.
  app.get('/api/apply-queue', async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          j.job_id, j.run_id, j.title, j.company, j.source_url, j.source,
          j.scraped_at, j.posted_at,
          CASE WHEN j.source = 'jobright_api' THEN j.meta->>'job_id' ELSE NULL END AS jobright_id,
          s.total AS score_total, s.skills, s.semantic, s.yoe, s.seniority, s.location,
          jv.verdict AS judge_verdict, jv.bucket, jv.reasoning, jv.concerns, jv.concern_answers,
          cl.content AS cover_letter,
          cl.file_path AS cover_letter_path,
          tr.pdf_path AS resume_pdf_path,
          tr.word_count AS resume_word_count,
          tr.flags AS resume_flags,
          tr.meta_path AS resume_meta_path,
          cl.pdf_path AS cover_pdf_path,
          cl.word_count AS cover_word_count,
          cl.flags AS cover_flags,
          cl.meta_path AS cover_meta_path,
          l.label, l.notes AS label_notes,
          l.application_status, l.applied_at
        FROM jobs j
        JOIN scores         s  ON s.job_id  = j.job_id AND s.run_id  = j.run_id
        JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
        LEFT JOIN LATERAL (
          SELECT content, file_path, pdf_path, word_count, flags, meta_path
          FROM cover_letters WHERE job_id = j.job_id ORDER BY generated_at DESC NULLS LAST LIMIT 1
        ) cl ON true
        LEFT JOIN LATERAL (
          SELECT pdf_path, word_count, flags, meta_path
          FROM tailored_resumes WHERE job_id = j.job_id ORDER BY generated_at DESC NULLS LAST LIMIT 1
        ) tr ON true
        LEFT JOIN labels        l  ON l.job_id  = j.job_id AND l.run_id  = j.run_id
        WHERE jv.bucket IN ('COVER_LETTER', 'REVIEW_QUEUE', 'RESULTS')
        ORDER BY
          CASE
            WHEN j.scraped_at >= NOW() - INTERVAL '24 hours' THEN 1
            WHEN j.scraped_at >= NOW() - INTERVAL '72 hours' THEN 2
            ELSE 3
          END ASC,
          s.total DESC
        LIMIT 200
      `);
      const rows = result.rows.map(row => {
        if (!row.cover_letter && row.cover_letter_path && /\.md$/i.test(row.cover_letter_path)) {
          row.cover_letter = readCoverLetter(row.cover_letter_path);
        } else if (row.cover_pdf_path || (row.cover_letter_path && /\.pdf$/i.test(row.cover_letter_path))) {
          row.cover_letter = null;
        }
        row.resume_pdf_url = toUrl(row.resume_pdf_path);
        row.cover_pdf_url = toUrl(row.cover_pdf_path ?? (row.cover_letter_path && /\.pdf$/i.test(row.cover_letter_path) ? row.cover_letter_path : null));
        const resumeMetaPath = row.resume_meta_path as string | null;
        const coverMetaPath  = row.cover_meta_path as string | null;
        row.job_description_url = jobDescriptionApiUrl(String(row.job_id));
        const rf = row.resume_flags as string[] | null;
        const cf = row.cover_flags as string[] | null;
        row.artifact_flags = [...(rf ?? []), ...(cf ?? [])];

        // Attach risk_summary + export_status from meta.json for latest resume/cover
        if (resumeMetaPath) {
          try {
            const metaAbs = path.join(REPO_ROOT, resumeMetaPath);
            if (fs.existsSync(metaAbs)) {
              const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
              row.resume_risk_summary  = meta?.resume?.risk_summary  ?? null;
              row.resume_export_status = meta?.resume?.export_status ?? 'ok';
              row.required_skills_with_risk = meta?.jd_json?.required_skills_with_risk ?? null;
            }
          } catch { /* best-effort */ }
        }
        if (coverMetaPath) {
          try {
            const metaAbs = path.join(REPO_ROOT, coverMetaPath);
            if (fs.existsSync(metaAbs)) {
              const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
              row.cover_risk_summary  = meta?.cover_letter?.risk_summary  ?? null;
              row.cover_export_status = meta?.cover_letter?.export_status ?? 'ok';
            }
          } catch { /* best-effort */ }
        }

        delete row.cover_letter_path;
        delete row.resume_pdf_path;
        delete row.cover_pdf_path;
        delete row.resume_flags;
        delete row.cover_flags;
        delete row.resume_meta_path;
        delete row.cover_meta_path;
        return row;
      });
      res.json(rows);
    } catch (err) {
      console.error('[ui-server] /api/apply-queue error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/rejections-hard
  // -------------------------------------------------------------------------
  // `GET /api/rejections-hard` — list hard-filter rejects for review and labeling.
  app.get('/api/rejections-hard', async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          j.job_id, j.run_id, j.title, j.company, j.source_url, j.source,
          j.scraped_at,
          CASE WHEN j.source = 'jobright_api' THEN j.meta->>'job_id' ELSE NULL END AS jobright_id,
          fr.reason, fr.flags,
          l.label, l.notes AS label_notes
        FROM jobs j
        JOIN filter_results fr ON fr.job_id = j.job_id AND fr.run_id = j.run_id
        LEFT JOIN labels    l  ON l.job_id  = j.job_id AND l.run_id  = j.run_id
        WHERE fr.verdict = 'REJECT'
        ORDER BY fr.reason ASC, j.scraped_at DESC
        LIMIT 300
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('[ui-server] /api/rejections-hard error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/rejections-soft
  // -------------------------------------------------------------------------
  // `GET /api/rejections-soft` — list archived soft rejects with score and judge context.
  app.get('/api/rejections-soft', async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          j.job_id, j.run_id, j.title, j.company, j.source_url, j.source,
          j.scraped_at,
          CASE WHEN j.source = 'jobright_api' THEN j.meta->>'job_id' ELSE NULL END AS jobright_id,
          s.total AS score_total, s.skills, s.semantic, s.yoe, s.seniority, s.location,
          jv.verdict AS judge_verdict, jv.bucket, jv.reasoning, jv.concerns,
          l.label, l.notes AS label_notes
        FROM jobs j
        JOIN scores         s  ON s.job_id  = j.job_id AND s.run_id  = j.run_id
        JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
        LEFT JOIN labels    l  ON l.job_id  = j.job_id AND l.run_id  = j.run_id
        WHERE jv.bucket = 'ARCHIVE'
        ORDER BY s.total DESC
        LIMIT 200
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('[ui-server] /api/rejections-soft error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/stats
  // -------------------------------------------------------------------------
  // `GET /api/stats` — return dashboard counters for total or today-scoped queue state.
  app.get('/api/stats', async (req, res) => {
    try {
      const scope = String(req.query.scope ?? 'total');
      const today = scope === 'today';
      const scrapedToday = today ? 'AND j.scraped_at >= CURRENT_DATE' : '';
      const labeledToday = today ? 'AND l.labeled_at >= CURRENT_DATE' : '';
      const appliedToday = today ? 'AND l.applied_at >= CURRENT_DATE' : '';

      const [pendingRes, applyLaterRes, appliedRes, hardUnreviewedRes, softUnreviewedRes] = await Promise.all([
        pool.query(`
          SELECT COUNT(*) FROM judge_verdicts jv
          JOIN jobs j ON j.job_id = jv.job_id AND j.run_id = jv.run_id
          LEFT JOIN labels l ON l.job_id = jv.job_id AND l.run_id = jv.run_id
          WHERE jv.bucket IN ('COVER_LETTER', 'REVIEW_QUEUE', 'RESULTS')
            AND (l.application_status IS NULL OR l.application_status NOT IN ('applied','skipped'))
            ${scrapedToday}
        `),
        pool.query(`
          SELECT COUNT(*) FROM labels l
          WHERE l.application_status = 'apply_later'
            ${labeledToday}
        `),
        pool.query(`
          SELECT COUNT(*) FROM labels l
          WHERE l.application_status = 'applied'
            ${appliedToday}
        `),
        pool.query(`
          SELECT COUNT(*) FROM filter_results fr
          JOIN jobs j ON j.job_id = fr.job_id AND j.run_id = fr.run_id
          LEFT JOIN labels l ON l.job_id = fr.job_id AND l.run_id = fr.run_id
          WHERE fr.verdict = 'REJECT' AND l.job_id IS NULL
            ${scrapedToday}
        `),
        pool.query(`
          SELECT COUNT(*) FROM judge_verdicts jv
          JOIN jobs j ON j.job_id = jv.job_id AND j.run_id = jv.run_id
          LEFT JOIN labels l ON l.job_id = jv.job_id AND l.run_id = jv.run_id
          WHERE jv.bucket = 'ARCHIVE' AND l.job_id IS NULL
            ${scrapedToday}
        `),
      ]);

      res.json({
        pending: parseInt(pendingRes.rows[0].count, 10),
        applyLater: parseInt(applyLaterRes.rows[0].count, 10),
        applied: parseInt(appliedRes.rows[0].count, 10),
        hardRejectionsUnreviewed: parseInt(hardUnreviewedRes.rows[0].count, 10),
        softRejectionsUnreviewed: parseInt(softUnreviewedRes.rows[0].count, 10),
      });
    } catch (err) {
      console.error('[ui-server] /api/stats error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/label
  // -------------------------------------------------------------------------
  // `POST /api/label` — upsert reviewer label, notes, and application status for one job.
  app.post('/api/label', async (req, res) => {
    try {
      const { job_id, run_id, label, application_status, notes } = req.body as {
        job_id: string;
        run_id: string;
        label: 'yes' | 'maybe' | 'no';
        application_status?: 'applied' | 'skipped' | 'apply_later' | null;
        notes?: string | null;
      };

      if (!job_id || !run_id || !label) {
        res.status(400).json({ error: 'missing_fields', detail: 'job_id, run_id, label are required' });
        return;
      }

      await pool.query(
        `INSERT INTO labels (job_id, run_id, label, notes, application_status, applied_at)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $5 = 'applied' THEN NOW() ELSE NULL END)
         ON CONFLICT (job_id, run_id) DO UPDATE SET
           label              = EXCLUDED.label,
           notes              = COALESCE(EXCLUDED.notes,              labels.notes),
           application_status = COALESCE(EXCLUDED.application_status, labels.application_status),
           applied_at         = COALESCE(EXCLUDED.applied_at,         labels.applied_at),
           labeled_at         = NOW()`,
        [
          job_id,
          run_id,
          label,
          notes ?? null,
          application_status ?? null,
        ]
      );

      res.json({ ok: true });
    } catch (err) {
      console.error('[ui-server] /api/label error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/jobs/:job_id/generate — resume + cover letter (manual)
  // -------------------------------------------------------------------------
  // `POST /api/jobs/:job_id/generate` — manually regenerate tailored resume and cover artifacts.
  app.post('/api/jobs/:job_id/generate', async (req, res) => {
    try {
      if (!process.env.OPENROUTER_API_KEY) {
        res.status(503).json({ error: 'no_api_key', detail: 'OPENROUTER_API_KEY is not set' });
        return;
      }
      const jobId = req.params.job_id;
      const body = (req.body ?? {}) as { force?: boolean; type?: 'resume' | 'cover' | 'both' };
      const force = body.force;
      const artifactType = (['resume', 'cover', 'both'] as const).includes(body.type as 'resume' | 'cover' | 'both')
        ? body.type as 'resume' | 'cover' | 'both'
        : 'both';
      const out = await manualGenerateArtifacts(REPO_ROOT, jobId, { force, artifactType });
      if (!out.ok) {
        if (out.conflict) {
          res.status(409).json({
            error: 'artifacts_exist',
            detail: out.error ?? 'Set force to true to regenerate.',
          });
          return;
        }
        const miss = out.error?.toLowerCase().includes('not found');
        res.status(miss ? 404 : 400).json({
          error: miss ? 'not_found' : 'generate_failed',
          detail: out.error ?? 'Generation failed.',
        });
        return;
      }
      res.json({ resume: out.resume, cover_letter: out.cover });
    } catch (err) {
      console.error('[ui-server] /api/jobs/:job_id/generate error:', err);
      res.status(500).json({ error: 'generate_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/run-history
  // -------------------------------------------------------------------------
  // `GET /api/run-history` — return recent pipeline runs with status and volume counts.
  app.get('/api/run-history', async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          run_id,
          source,
          CASE
            WHEN finished_at IS NULL THEN 'running'
            WHEN COALESCE(exit_code, 0) = 0 THEN 'completed'
            ELSE 'failed'
          END AS status,
          exit_code,
          started_at,
          finished_at,
          jobs_total AS scraped_count,
          jobs_passed AS passed_count,
          extractions_succeeded AS extraction_count,
          jobs_covered AS covered_count
        FROM runs
        ORDER BY started_at DESC
        LIMIT 200
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('[ui-server] /api/run-history error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/applied-jobs
  // -------------------------------------------------------------------------
  // `GET /api/applied-jobs` — list labeled applied jobs with artifact download links.
  app.get('/api/applied-jobs', async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          j.job_id, j.run_id, j.title, j.company, j.source_url, j.source,
          j.scraped_at, j.posted_at,
          CASE WHEN j.source = 'jobright_api' THEN j.meta->>'job_id' ELSE NULL END AS jobright_id,
          s.total AS score_total, s.skills, s.semantic, s.yoe, s.seniority, s.location,
          jv.verdict AS judge_verdict, jv.bucket, jv.reasoning, jv.concerns,
          NULL::text AS cover_letter,
          tr.pdf_path AS resume_pdf_path,
          tr.word_count AS resume_word_count,
          tr.flags AS resume_flags,
          tr.meta_path AS resume_meta_path,
          cl.pdf_path AS cover_pdf_path,
          cl.word_count AS cover_word_count,
          cl.flags AS cover_flags,
          cl.meta_path AS cover_meta_path,
          l.label, l.notes AS label_notes,
          l.application_status, l.applied_at
        FROM jobs j
        LEFT JOIN scores         s  ON s.job_id  = j.job_id AND s.run_id  = j.run_id
        LEFT JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
        LEFT JOIN LATERAL (
          SELECT pdf_path, word_count, flags, meta_path
          FROM tailored_resumes WHERE job_id = j.job_id ORDER BY generated_at DESC NULLS LAST LIMIT 1
        ) tr ON true
        LEFT JOIN LATERAL (
          SELECT pdf_path, word_count, flags, meta_path
          FROM cover_letters WHERE job_id = j.job_id ORDER BY generated_at DESC NULLS LAST LIMIT 1
        ) cl ON true
        JOIN labels l ON l.job_id = j.job_id AND l.run_id = j.run_id
        WHERE l.application_status = 'applied'
          AND l.applied_at IS NOT NULL
        ORDER BY l.applied_at DESC
        LIMIT 500
      `);
      const rows = result.rows.map(row => {
        row.resume_pdf_url = toUrl(row.resume_pdf_path);
        row.cover_pdf_url = toUrl(row.cover_pdf_path);
        const resumeMetaPath = row.resume_meta_path as string | null;
        const coverMetaPath  = row.cover_meta_path as string | null;
        row.job_description_url = jobDescriptionApiUrl(String(row.job_id));
        const rf = row.resume_flags as string[] | null;
        const cf = row.cover_flags as string[] | null;
        row.artifact_flags = [...(rf ?? []), ...(cf ?? [])];

        if (resumeMetaPath) {
          try {
            const metaAbs = path.join(REPO_ROOT, resumeMetaPath);
            if (fs.existsSync(metaAbs)) {
              const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
              row.resume_risk_summary = meta?.resume?.risk_summary ?? null;
              row.resume_export_status = meta?.resume?.export_status ?? 'ok';
              row.required_skills_with_risk = meta?.jd_json?.required_skills_with_risk ?? null;
            }
          } catch { /* best-effort */ }
        }
        if (coverMetaPath) {
          try {
            const metaAbs = path.join(REPO_ROOT, coverMetaPath);
            if (fs.existsSync(metaAbs)) {
              const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
              row.cover_risk_summary = meta?.cover_letter?.risk_summary ?? null;
              row.cover_export_status = meta?.cover_letter?.export_status ?? 'ok';
            }
          } catch { /* best-effort */ }
        }

        delete row.resume_pdf_path;
        delete row.cover_pdf_path;
        delete row.resume_flags;
        delete row.cover_flags;
        delete row.resume_meta_path;
        delete row.cover_meta_path;
        return row;
      });
      res.json(rows);
    } catch (err) {
      console.error('[ui-server] /api/applied-jobs error:', err);
      res.status(500).json({ error: 'db_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/jobs/:job_id/job-description
  // -------------------------------------------------------------------------
  // `GET /api/jobs/:job_id/job-description` — return saved JD markdown or raw description fallback.
  app.get('/api/jobs/:job_id/job-description', async (req, res) => {
    try {
      const { job_id } = req.params;
      const result = await pool.query(`
        SELECT
          j.job_id, j.title, j.company, j.posted_at, j.description_raw,
          tr.meta_path AS resume_meta_path,
          cl.meta_path AS cover_meta_path
        FROM jobs j
        LEFT JOIN LATERAL (
          SELECT meta_path
          FROM tailored_resumes
          WHERE job_id = j.job_id
          ORDER BY generated_at DESC NULLS LAST
          LIMIT 1
        ) tr ON true
        LEFT JOIN LATERAL (
          SELECT meta_path
          FROM cover_letters
          WHERE job_id = j.job_id
          ORDER BY generated_at DESC NULLS LAST
          LIMIT 1
        ) cl ON true
        WHERE j.job_id = $1
        ORDER BY j.scraped_at DESC
        LIMIT 1
      `, [job_id]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const row = result.rows[0] as {
        job_id: string;
        title: string | null;
        company: string | null;
        posted_at: string | null;
        description_raw: string | null;
        resume_meta_path: string | null;
        cover_meta_path: string | null;
      };

      const jdPath = resolveJobDescriptionPath(
        {
          job_id: row.job_id,
          title: row.title,
          company: row.company,
          posted_at: row.posted_at,
        },
        row.resume_meta_path ?? row.cover_meta_path,
      );

      if (jdPath && fs.existsSync(jdPath)) {
        res.type('text/markdown').send(fs.readFileSync(jdPath, 'utf8'));
        return;
      }

      const raw = (row.description_raw ?? '').trim();
      if (raw) {
        res.type('text/plain').send(raw);
        return;
      }

      res.status(404).json({ error: 'job_description_missing' });
    } catch (err) {
      console.error('[ui-server] /api/jobs/:job_id/job-description error:', err);
      res.status(500).json({ error: 'server_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/jobs/:job_id/resume-tex
  // -------------------------------------------------------------------------
  // `GET /api/jobs/:job_id/resume-tex` — return latest tailored resume TeX plus canonical source.
  app.get('/api/jobs/:job_id/resume-tex', async (req, res) => {
    try {
      const { job_id } = req.params;
      const result = await pool.query(`
        SELECT tex_path
        FROM tailored_resumes
        WHERE job_id = $1
        ORDER BY generated_at DESC NULLS LAST
        LIMIT 1
      `, [job_id]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const texRelPath = result.rows[0].tex_path as string | null;
      if (!texRelPath) {
        res.status(404).json({ error: 'no_tex_path' });
        return;
      }

      const texAbs = path.isAbsolute(texRelPath) ? texRelPath : path.join(REPO_ROOT, texRelPath);
      if (!fs.existsSync(texAbs)) {
        res.status(404).json({ error: 'tex_file_missing' });
        return;
      }
      const tailored = fs.readFileSync(texAbs, 'utf-8');

      // Prefer the canonical frozen at generation time (written alongside the tailored TeX).
      // Fall back to the live config file only when the frozen copy is absent (older runs).
      const jobDir = path.dirname(texAbs);
      const frozenCanonical = path.join(jobDir, 'canonical.tex');
      const canonicalPaths = [
        frozenCanonical,
        path.join(REPO_ROOT, 'config', 'resume_master.tex'),
        path.join(REPO_ROOT, 'config', 'resume.tex'),
        path.join(REPO_ROOT, 'config', 'resume-master.tex'),
      ];
      let canonical = '';
      for (const p of canonicalPaths) {
        if (fs.existsSync(p)) {
          canonical = fs.readFileSync(p, 'utf-8');
          break;
        }
      }

      res.json({ tailored, canonical });
    } catch (err) {
      console.error('[ui-server] /api/jobs/:job_id/resume-tex error:', err);
      res.status(500).json({ error: 'server_error', detail: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/orchestrator/status
  // -------------------------------------------------------------------------
  // `GET /api/orchestrator/status` returns whether the cron orchestrator is alive.
  app.get('/api/orchestrator/status', (_req, res) => {
    res.json(orchestratorState());
  });

  // -------------------------------------------------------------------------
  // POST /api/orchestrator/toggle
  // -------------------------------------------------------------------------
  // `POST /api/orchestrator/toggle` reads state first, then starts (if stopped)
  // or SIGTERM (if running) the orchestrator child. Returns the new state.
  app.post('/api/orchestrator/toggle', (_req, res) => {
    const state = orchestratorState();

    if (state.running) {
      try {
        if (orchestratorChild && orchestratorChild.pid) orchestratorChild.kill('SIGTERM');
        else if (state.pid) process.kill(state.pid, 'SIGTERM');
      } catch { /* already gone */ }
      orchestratorChild = null;
      orchestratorStartedAt = null;
      clearOrchestratorPidfile();
      res.json({ running: false });
      return;
    }

    const startedAt = new Date().toISOString();
    const child = spawn('npx', ['tsx', 'src/orchestrator/index.ts'], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'ignore',
      detached: false,
    });
    orchestratorChild = child;
    orchestratorStartedAt = startedAt;
    if (child.pid) writeOrchestratorPidfile(child.pid, startedAt);

    child.on('exit', () => {
      if (orchestratorChild === child) {
        orchestratorChild = null;
        orchestratorStartedAt = null;
        clearOrchestratorPidfile();
      }
    });
    child.on('error', (err) => {
      console.error('[ui-server] orchestrator spawn error:', err);
      if (orchestratorChild === child) {
        orchestratorChild = null;
        orchestratorStartedAt = null;
        clearOrchestratorPidfile();
      }
    });

    res.json({ running: true, pid: child.pid, startedAt });
  });

  // -------------------------------------------------------------------------
  // GET /api/orchestrator/log  (text/event-stream)
  // -------------------------------------------------------------------------
  // Tails output/logs/orchestrator.log as an indefinite SSE stream. Sends all
  // existing content on connect, then polls every second for new bytes.
  // Stream ends when the client disconnects (abortController on the frontend).
  app.get('/api/orchestrator/log', (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const sendLine = (line: string) => {
      res.write(`data: ${JSON.stringify(stripAnsi(line))}\n\n`);
    };

    let offset = 0;
    // Replay existing log content on connect
    if (fs.existsSync(ORCH_LOG)) {
      const content = fs.readFileSync(ORCH_LOG, 'utf8');
      offset = Buffer.byteLength(content, 'utf8');
      for (const line of content.split('\n')) {
        if (line.trim()) sendLine(line);
      }
    }

    // Poll for appended bytes every second
    const interval = setInterval(() => {
      try {
        if (!fs.existsSync(ORCH_LOG)) return;
        const stat = fs.statSync(ORCH_LOG);
        if (stat.size <= offset) return;
        const fd = fs.openSync(ORCH_LOG, 'r');
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = stat.size;
        for (const line of buf.toString('utf8').split('\n')) {
          if (line.trim()) sendLine(line);
        }
      } catch { /* file may rotate or be temporarily unavailable */ }
    }, 1000);

    res.on('close', () => clearInterval(interval));
  });

  // -------------------------------------------------------------------------
  // POST /api/pipeline/run  (text/event-stream)
  // -------------------------------------------------------------------------
  // `POST /api/pipeline/run` spawns run-pipeline.ts with mapped env vars and
  // stream stdout+stderr as SSE; 409 if a run is already in-flight.
  app.post('/api/pipeline/run', (req, res) => {
    if (pipelineRunning) {
      res.status(409).json({ error: 'run_in_flight', detail: 'Another run is already in progress.' });
      return;
    }

    const b = (req.body ?? {}) as {
      source?: string; max?: number;
      extract?: boolean; score?: boolean; judge?: boolean; cover?: boolean;
      skipDedup?: boolean; skipPersist?: boolean; verify?: boolean;
      query?: string; postedWithin?: string; hoursOld?: number; targetNew?: number; jsonl?: string;
    };

    const bool = (v: boolean | undefined) => (v ? '1' : '0');
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.SOURCE = String(b.source ?? 'dice');
    env.MAX = String(Number.isFinite(b.max) ? b.max : 20);
    env.EXTRACT = bool(b.extract);
    env.SCORE = bool(b.score);
    env.JUDGE = bool(b.judge);
    env.COVER = bool(b.cover);
    env.SKIP_DEDUP = bool(b.skipDedup);
    env.SKIP_PERSIST = bool(b.skipPersist);
    env.VERIFY = bool(b.verify);
    if (b.query) env.QUERY = b.query;
    if (b.postedWithin) env.POSTED_WITHIN = b.postedWithin;
    if (b.hoursOld != null && Number.isFinite(b.hoursOld)) env.HOURS_OLD = String(b.hoursOld);
    if (b.targetNew != null && Number.isFinite(b.targetNew) && b.targetNew > 0) env.TARGET_NEW = String(b.targetNew);
    if (b.jsonl) env.JSONL = b.jsonl;

    pipelineRunning = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const child = spawn('npx', ['tsx', 'scripts/run-pipeline.ts'], { cwd: REPO_ROOT, env });

    const send = (line: string) => {
      res.write(`data: ${JSON.stringify(stripAnsi(line))}\n\n`);
    };
    // StringDecoder holds incomplete multibyte UTF-8 sequences across chunk
    // boundaries, so emoji/box-drawing chars are never split into replacement
    // characters (the cause of the stray U+FFFD glyphs in raw output).
    const outBuf = { s: '', dec: new StringDecoder('utf8') };
    const errBuf = { s: '', dec: new StringDecoder('utf8') };
    const pump = (buf: { s: string; dec: StringDecoder }, chunk: Buffer) => {
      buf.s += buf.dec.write(chunk);
      let nl: number;
      while ((nl = buf.s.indexOf('\n')) !== -1) {
        send(buf.s.slice(0, nl));
        buf.s = buf.s.slice(nl + 1);
      }
    };
    child.stdout?.on('data', (c: Buffer) => pump(outBuf, c));
    child.stderr?.on('data', (c: Buffer) => pump(errBuf, c));

    let finished = false;
    const finish = (exitCode: number | null) => {
      if (finished) return;
      finished = true;
      outBuf.s += outBuf.dec.end();
      errBuf.s += errBuf.dec.end();
      if (outBuf.s) send(outBuf.s);
      if (errBuf.s) send(errBuf.s);
      pipelineRunning = false;
      try {
        res.write(`event: done\ndata: ${JSON.stringify({ exitCode })}\n\n`);
        res.end();
      } catch { /* client already gone */ }
    };

    child.on('exit', (code) => finish(code));
    child.on('error', (err) => {
      send(`[pipeline] spawn error: ${err.message}`);
      finish(1);
    });

    // Client disconnect: listen on the RESPONSE stream, not the request. The
    // request emits 'close' as soon as its JSON body is fully read, which would
    // kill the child immediately. res 'close' fires only on real disconnect.
    res.on('close', () => {
      if (!finished) {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        finished = true;
        pipelineRunning = false;
      }
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/archive/run  (text/event-stream)
  // -------------------------------------------------------------------------
  // Runs Drive archival in-process and streams progress as SSE.
  // Body: { dryRun?: boolean } — defaults to execute=true (safe because the
  // UI button is an explicit user action; CLI defaults to dry-run).
  app.post('/api/archive/run', async (req, res) => {
    if (archiveRunning) {
      res.status(409).json({ error: 'archive_in_flight', detail: 'An archive run is already in progress.' });
      return;
    }

    const b = (req.body ?? {}) as { dryRun?: boolean };
    const execute = b.dryRun !== true;

    const keyPath  = process.env.GDRIVE_SERVICE_ACCOUNT_KEY;
    const folderId = process.env.GDRIVE_ARCHIVE_FOLDER_ID;
    if (!keyPath || !folderId) {
      res.status(400).json({ error: 'not_configured', detail: 'GDRIVE_SERVICE_ACCOUNT_KEY or GDRIVE_ARCHIVE_FOLDER_ID not set.' });
      return;
    }

    archiveRunning = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (line: string) => {
      try { res.write(`data: ${JSON.stringify(stripAnsi(line))}\n\n`); } catch { /* client gone */ }
    };

    try {
      const ageDays      = Number(process.env.GDRIVE_ARCHIVE_AGE_DAYS ?? 14);
      const logRetention = Number(process.env.GDRIVE_LOG_RETENTION_DAYS ?? 30);
      await runArchive(pool, {
        execute,
        ageDays,
        pruneLogs:        true,
        logRetentionDays: logRetention,
        repoRoot:         REPO_ROOT,
        rootFolderId:     folderId,
        onLog:            send,
      });
    } catch (e) {
      send(`[drive-archive] fatal error: ${(e as Error).message}`);
    } finally {
      archiveRunning = false;
      try {
        res.write(`event: done\ndata: ${JSON.stringify({ exitCode: 0 })}\n\n`);
        res.end();
      } catch { /* client gone */ }
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/runs/:run_id/log
  // -------------------------------------------------------------------------
  // `GET /api/runs/:run_id/log` streams a saved run log file as plain text.
  app.get('/api/runs/:run_id/log', (req, res) => {
    const logPath = findRunLog(req.params.run_id);
    if (!logPath || !fs.existsSync(logPath)) {
      res.status(404).json({ error: 'log_not_found' });
      return;
    }
    res.type('text/plain');
    const stream = fs.createReadStream(logPath, 'utf8');
    stream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  });

  // SPA fallback for production
  // `GET /*` — serve SPA index fallback when built frontend exists.
  app.use((_req, res) => {
    const distIndex = path.join(__dirname, '../ui/dist/index.html');
    if (fs.existsSync(distIndex)) {
      res.sendFile(distIndex);
    } else {
      res.status(404).send('UI not built. Run: cd ui && npm run build');
    }
  });

  app.listen(3001, () => {
    console.log('[ui-server] listening on http://localhost:3001');
  });
}

main().catch(err => {
  console.error('[ui-server] fatal startup error:', err);
  process.exit(1);
});

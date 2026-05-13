/**
 * ui-server.ts — Express API server for the Job Hunter Review UI.
 * Start: npx tsx scripts/ui-server.ts
 * Port:  3001
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import { getPool } from '../src/storage/db.js';
import { manualGenerateArtifacts } from '../src/artifacts/manual-generate.js';
import { makeJobSlug } from '../src/shared/slug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
loadEnv({ path: path.join(REPO_ROOT, '.env') });

/**
 * Cover letter content is stored on disk (content col is NULL in DB).
 * The stored file_path may reference an old repo location; resolve it
 * by trying the stored path first, then substituting the current repo root.
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

async function main() {
  const pool = getPool();

  for (const mig of ['004_ui_application_tracking.sql', '005_tailored_artifacts.sql', '006_consolidate_artifacts.sql']) {
    const migrationPath = path.join(REPO_ROOT, 'migrations', mig);
    if (fs.existsSync(migrationPath)) {
      await pool.query(fs.readFileSync(migrationPath, 'utf-8'));
    }
  }

  const app = express();
  app.use(express.json());

  app.use('/output', express.static(path.join(REPO_ROOT, 'output')));

  // Serve production build
  app.use(express.static(path.join(__dirname, '../ui/dist')));

  // -------------------------------------------------------------------------
  // GET /api/apply-queue
  // -------------------------------------------------------------------------
  app.get('/api/apply-queue', async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          j.job_id, j.run_id, j.title, j.company, j.source_url, j.source,
          j.scraped_at, j.posted_at,
          CASE WHEN j.source = 'jobright_api' THEN j.meta->>'job_id' ELSE NULL END AS jobright_id,
          s.total AS score_total, s.skills, s.semantic, s.yoe, s.seniority, s.location,
          jv.verdict AS judge_verdict, jv.bucket, jv.reasoning, jv.concerns,
          cl.content AS cover_letter,
          cl.file_path AS cover_letter_path,
          tr.pdf_path AS resume_pdf_path,
          tr.word_count AS resume_word_count,
          tr.flags AS resume_flags,
          cl.pdf_path AS cover_pdf_path,
          cl.word_count AS cover_word_count,
          cl.flags AS cover_flags,
          l.label, l.notes AS label_notes,
          l.application_status, l.applied_at
        FROM jobs j
        JOIN scores         s  ON s.job_id  = j.job_id AND s.run_id  = j.run_id
        JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
        LEFT JOIN LATERAL (
          SELECT content, file_path, pdf_path, word_count, flags
          FROM cover_letters WHERE job_id = j.job_id ORDER BY generated_at DESC NULLS LAST LIMIT 1
        ) cl ON true
        LEFT JOIN LATERAL (
          SELECT pdf_path, word_count, flags
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
        const toUrl = (p: string | null) =>
          p ? `/${String(p).replace(/\\/g, '/')}` : null;
        row.resume_pdf_url = toUrl(row.resume_pdf_path);
        row.cover_pdf_url = toUrl(row.cover_pdf_path ?? (row.cover_letter_path && /\.pdf$/i.test(row.cover_letter_path) ? row.cover_letter_path : null));
        const postedIso = row.posted_at ? new Date(row.posted_at as string).toISOString() : null;
        const slug = makeJobSlug(
          { title: row.title ?? "", company: row.company ?? "", posted_at: postedIso },
          row.job_id,
        );
        row.job_description_url = toUrl(`output/applications/${slug}/job_description.md`);
        const rf = row.resume_flags as string[] | null;
        const cf = row.cover_flags as string[] | null;
        row.artifact_flags = [...(rf ?? []), ...(cf ?? [])];
        delete row.cover_letter_path;
        delete row.resume_pdf_path;
        delete row.cover_pdf_path;
        delete row.resume_flags;
        delete row.cover_flags;
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
  app.get('/api/stats', async (_req, res) => {
    try {
      const [pendingRes, applyLaterRes, appliedRes, hardUnreviewedRes, softUnreviewedRes] = await Promise.all([
        pool.query(`
          SELECT COUNT(*) FROM judge_verdicts jv
          LEFT JOIN labels l ON l.job_id = jv.job_id AND l.run_id = jv.run_id
          WHERE jv.bucket IN ('COVER_LETTER', 'REVIEW_QUEUE', 'RESULTS')
            AND (l.application_status IS NULL OR l.application_status NOT IN ('applied','skipped'))
        `),
        pool.query(`
          SELECT COUNT(*) FROM labels WHERE application_status = 'apply_later'
        `),
        pool.query(`
          SELECT COUNT(*) FROM labels WHERE application_status = 'applied'
        `),
        pool.query(`
          SELECT COUNT(*) FROM filter_results fr
          LEFT JOIN labels l ON l.job_id = fr.job_id AND l.run_id = fr.run_id
          WHERE fr.verdict = 'REJECT' AND l.job_id IS NULL
        `),
        pool.query(`
          SELECT COUNT(*) FROM judge_verdicts jv
          LEFT JOIN labels l ON l.job_id = jv.job_id AND l.run_id = jv.run_id
          WHERE jv.bucket = 'ARCHIVE' AND l.job_id IS NULL
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
  app.post('/api/jobs/:job_id/generate', async (req, res) => {
    try {
      if (!process.env.OPENROUTER_API_KEY) {
        res.status(503).json({ error: 'no_api_key', detail: 'OPENROUTER_API_KEY is not set' });
        return;
      }
      const jobId = req.params.job_id;
      const force = (req.body as { force?: boolean } | undefined)?.force;
      const out = await manualGenerateArtifacts(REPO_ROOT, jobId, { force });
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

  // SPA fallback for production
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

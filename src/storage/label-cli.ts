/**
 * label-cli.ts — manual labeling tool for scoring calibration (M9).
 *
 * Pulls jobs that have a judge verdict but no label yet, presents them
 * one at a time, accepts y/m/n/s/q input, writes to labels table.
 *
 * Usage:
 *   cd storage && npm run label
 *
 * Sort order: highest score first. You are calibrating the scorer, so
 * focus on the top end where decisions actually matter.
 */

import readline from "readline";
import { getPool, closePool } from "./db.js";

interface Row {
  job_id:        string;
  run_id:        string;
  title:         string | null;
  company:       string | null;
  source_url:    string | null;
  source:        string;
  jd_excerpt:    string | null;
  score_total:   number;
  skills:        number;
  semantic:      number;
  yoe:           number;
  seniority:     number;
  location:      number;
  verdict:       string | null;
  bucket:        string | null;
  reasoning:     string | null;
  concerns:      string[];
  scraped_at:    Date;
}

const QUERY = `
  SELECT
    j.job_id, j.run_id, j.title, j.company, j.source_url, j.source,
    LEFT(j.description_raw, 1500) AS jd_excerpt,
    j.scraped_at,
    s.total     AS score_total,
    s.skills, s.semantic, s.yoe, s.seniority, s.location,
    jv.verdict, jv.bucket, jv.reasoning, jv.concerns
  FROM jobs j
  JOIN scores s          ON s.job_id  = j.job_id AND s.run_id  = j.run_id
  JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
  LEFT JOIN labels l     ON l.job_id  = j.job_id AND l.run_id  = j.run_id
  WHERE l.job_id IS NULL
    AND jv.verdict IS NOT NULL
  ORDER BY s.total DESC, j.scraped_at DESC
  LIMIT 200;
`;

const SEP  = "─".repeat(78);
const SEP2 = "═".repeat(78);

function fmtScore(n: number): string {
  return n.toFixed(3);
}

function printJob(row: Row, idx: number, totalUnlabeled: number, labeled: number): void {
  console.log("\n" + SEP2);
  console.log(`  Job ${idx + 1} of ${totalUnlabeled}    Labeled this session: ${labeled}`);
  console.log(SEP2);
  console.log(`  ${row.title ?? "(no title)"}`);
  console.log(`  ${row.company ?? "(no company)"}    [${row.source}]`);
  if (row.source_url) console.log(`  ${row.source_url}`);
  console.log(SEP);
  console.log(`  Score: ${fmtScore(row.score_total)}    Verdict: ${row.verdict}    Bucket: ${row.bucket}`);
  console.log(`    skills=${fmtScore(row.skills)} semantic=${fmtScore(row.semantic)} yoe=${fmtScore(row.yoe)} seniority=${fmtScore(row.seniority)} location=${fmtScore(row.location)}`);
  console.log(SEP);
  if (row.reasoning) {
    console.log(`  Judge reasoning:`);
    console.log(`  ${row.reasoning}`);
  }
  if (row.concerns?.length) {
    console.log(`  Concerns:`);
    for (const c of row.concerns) console.log(`    • ${c}`);
  }
  console.log(SEP);
  console.log(`  JD excerpt:`);
  const excerpt = (row.jd_excerpt ?? "(empty)").replace(/\n{3,}/g, "\n\n");
  console.log(excerpt);
  console.log(SEP);
}

async function insertLabel(jobId: string, runId: string, label: string, notes: string | null): Promise<void> {
  await getPool().query(
    `INSERT INTO labels (job_id, run_id, label, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id, run_id) DO UPDATE
       SET label = EXCLUDED.label, notes = EXCLUDED.notes, labeled_at = NOW()`,
    [jobId, runId, label, notes],
  );
}

async function getStats(): Promise<{ total: number; yes: number; maybe: number; no: number }> {
  const r = await getPool().query<{ label: string; count: string }>(
    `SELECT label, COUNT(*)::TEXT AS count FROM labels GROUP BY label`,
  );
  const stats = { total: 0, yes: 0, maybe: 0, no: 0 };
  for (const row of r.rows) {
    const c = parseInt(row.count, 10);
    stats.total += c;
    if (row.label === "yes")   stats.yes = c;
    if (row.label === "maybe") stats.maybe = c;
    if (row.label === "no")    stats.no = c;
  }
  return stats;
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main(): Promise<void> {
  const rows = (await getPool().query<Row>(QUERY)).rows;

  if (rows.length === 0) {
    console.log("No unlabeled judged jobs in DB. Either run the orchestrator longer or you've labeled them all.");
    await closePool();
    return;
  }

  console.log(`\n${rows.length} unlabeled jobs queued. Sorted by score, highest first.`);
  const startStats = await getStats();
  console.log(`Currently labeled: ${startStats.total} total — ${startStats.yes} yes, ${startStats.maybe} maybe, ${startStats.no} no\n`);
  console.log("Commands:  y=yes (would apply)   m=maybe   n=no   s=skip   q=quit   note=add note then label\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let labeledThisSession = 0;

  try {
    for (let i = 0; i < rows.length; i++) {
      printJob(rows[i], i, rows.length, labeledThisSession);

      let label: string | null = null;
      let notes: string | null = null;

      while (label === null) {
        const ans = (await prompt(rl, "  [y/m/n/s/q/note] > ")).trim().toLowerCase();
        if (ans === "q") {
          console.log(`\nQuitting. Labeled ${labeledThisSession} this session.`);
          await closePool();
          rl.close();
          return;
        }
        if (ans === "s") { label = "__skip__"; break; }
        if (ans === "y") label = "yes";
        else if (ans === "m") label = "maybe";
        else if (ans === "n") label = "no";
        else if (ans === "note") {
          notes = (await prompt(rl, "  note: ")).trim() || null;
          // loop back, ask for label
        } else {
          console.log("  Unknown. Use y / m / n / s / q / note.");
        }
      }

      if (label !== "__skip__") {
        await insertLabel(rows[i].job_id, rows[i].run_id, label!, notes);
        labeledThisSession++;
      }
    }

    console.log(`\nDone. Labeled ${labeledThisSession} this session.`);
    const endStats = await getStats();
    console.log(`Total in DB: ${endStats.total} — ${endStats.yes} yes, ${endStats.maybe} maybe, ${endStats.no} no`);
  } finally {
    rl.close();
    await closePool();
  }
}

main().catch(err => {
  console.error("[label-cli] fatal:", err);
  process.exit(1);
});


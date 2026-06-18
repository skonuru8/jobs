/**
 * archive-drive.ts — CLI entry for Google Drive artifact archival.
 *
 * Usage:
 *   npx tsx scripts/archive-drive.ts              # dry run (default)
 *   npx tsx scripts/archive-drive.ts --execute    # actually upload + mark archived
 *   npx tsx scripts/archive-drive.ts --age-days 30
 *   npx tsx scripts/archive-drive.ts --no-prune-logs
 */

import * as path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { getPool, closePool } from "../src/storage/db.js";
import { runArchive } from "../src/archive/archive-applied.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
loadEnv({ path: path.join(REPO_ROOT, ".env") });

const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log(`
Usage: npx tsx scripts/archive-drive.ts [options]

Options:
  --execute          Actually upload to Drive and mark archived (default: dry run)
  --age-days N       Archive jobs applied more than N days ago (default: 14)
  --no-prune-logs    Skip pruning old log files
  --help             Show this message
`);
  process.exit(0);
}

const execute      = args.includes("--execute");
const pruneLogs    = !args.includes("--no-prune-logs");
const ageDaysIdx   = args.indexOf("--age-days");
const ageDaysRaw   = ageDaysIdx !== -1
  ? Number(args[ageDaysIdx + 1])
  : Number(process.env.GDRIVE_ARCHIVE_AGE_DAYS ?? 14);
if (!Number.isFinite(ageDaysRaw) || ageDaysRaw < 0) {
  console.error("--age-days requires a non-negative number");
  process.exit(1);
}
const ageDays      = ageDaysRaw;
const logRetentionRaw = Number(process.env.GDRIVE_LOG_RETENTION_DAYS ?? 30);
const logRetention = Number.isFinite(logRetentionRaw) && logRetentionRaw >= 0 ? logRetentionRaw : 30;
const rootFolderId = process.env.GDRIVE_ARCHIVE_FOLDER_ID ?? "";

const pool = getPool();

try {
  await runArchive(pool, {
    execute,
    ageDays,
    pruneLogs,
    logRetentionDays: logRetention,
    repoRoot:         REPO_ROOT,
    rootFolderId,
    onLog:            console.log,
  });
} finally {
  await closePool();
}

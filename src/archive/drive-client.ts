import * as fs from "fs";
import * as path from "path";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

let _drive: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (_drive) return _drive;

  const clientPath = process.env.GDRIVE_OAUTH_CLIENT_PATH;
  const tokenPath  = process.env.GDRIVE_OAUTH_TOKEN_PATH;

  if (!clientPath || !tokenPath) {
    throw new Error(
      "GDRIVE_OAUTH_CLIENT_PATH or GDRIVE_OAUTH_TOKEN_PATH not set — run: npx tsx scripts/gdrive-auth.ts",
    );
  }

  const absClient = path.resolve(clientPath);
  const absToken  = path.resolve(tokenPath);

  if (!fs.existsSync(absClient)) throw new Error(`OAuth client file not found: ${absClient}`);
  if (!fs.existsSync(absToken)) {
    throw new Error(`OAuth token not found: ${absToken} — run: npx tsx scripts/gdrive-auth.ts`);
  }

  const { client_id, client_secret, redirect_uris } =
    JSON.parse(fs.readFileSync(absClient, "utf-8")).installed;

  const oAuth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2.setCredentials(JSON.parse(fs.readFileSync(absToken, "utf-8")));

  // Persist refreshed tokens automatically so the session never expires.
  oAuth2.on("tokens", (newTokens) => {
    try {
      const current = JSON.parse(fs.readFileSync(absToken, "utf-8"));
      fs.writeFileSync(absToken, JSON.stringify({ ...current, ...newTokens }, null, 2));
    } catch { /* best-effort */ }
  });

  _drive = google.drive({ version: "v3", auth: oAuth2 });
  return _drive;
}

export async function ensureSubfolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${safe}' and '${parentId}' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
  });

  const existing = res.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  const id = created.data.id;
  if (!id) throw new Error(`Failed to create Drive folder: ${name}`);
  return id;
}

export interface UploadResult {
  fileId: string;
  bytes: number;
}

export async function uploadFile(
  drive: drive_v3.Drive,
  localPath: string,
  parentId: string,
  name: string,
): Promise<UploadResult> {
  const bytes = fs.statSync(localPath).size;
  const ext   = path.extname(name).toLowerCase();

  const mimeMap: Record<string, string> = {
    ".pdf":  "application/pdf",
    ".tex":  "text/plain",
    ".md":   "text/plain",
    ".json": "application/json",
    ".log":  "text/plain",
  };
  const mimeType = mimeMap[ext] ?? "application/octet-stream";

  const res = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: "id",
  });

  const fileId = res.data.id;
  if (!fileId) throw new Error(`Upload returned no file ID for: ${localPath}`);
  return { fileId, bytes };
}

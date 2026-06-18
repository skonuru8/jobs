/**
 * drive-client.ts — thin googleapis wrapper for Google Drive uploads.
 *
 * Auth: service account JSON key at GDRIVE_SERVICE_ACCOUNT_KEY.
 * Scope: drive.file (only sees files/folders it created or that are shared with it).
 *
 * IMPORTANT: service accounts have zero Drive storage quota.
 * All uploads must target a folder owned by a human Google account and
 * shared with the service account as Editor. Supply that folder's ID via
 * GDRIVE_ARCHIVE_FOLDER_ID in .env.
 */

import * as fs from "fs";
import * as path from "path";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

let _drive: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (_drive) return _drive;

  const keyPath = process.env.GDRIVE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) throw new Error("GDRIVE_SERVICE_ACCOUNT_KEY is not set");

  const absKey = path.resolve(keyPath);
  if (!fs.existsSync(absKey)) {
    throw new Error(`Service account key not found: ${absKey}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: absKey,
    scopes: SCOPES,
  });

  _drive = google.drive({ version: "v3", auth });
  return _drive;
}

/**
 * Finds or creates a subfolder by name under the given parent folder ID.
 * Returns the subfolder's Drive file ID.
 */
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

/**
 * Uploads a local file to the given Drive parent folder.
 * Returns the Drive file ID and byte count.
 */
export async function uploadFile(
  drive: drive_v3.Drive,
  localPath: string,
  parentId: string,
  name: string,
): Promise<UploadResult> {
  const bytes = fs.statSync(localPath).size;
  const ext = path.extname(name).toLowerCase();

  const mimeMap: Record<string, string> = {
    ".pdf":  "application/pdf",
    ".tex":  "text/plain",
    ".md":   "text/plain",
    ".json": "application/json",
    ".log":  "text/plain",
  };
  const mimeType = mimeMap[ext] ?? "application/octet-stream";

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath),
    },
    fields: "id",
  });

  const fileId = res.data.id;
  if (!fileId) throw new Error(`Upload returned no file ID for: ${localPath}`);
  return { fileId, bytes };
}

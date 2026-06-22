/**
 * One-time OAuth2 authorization for Google Drive.
 * Run: npx tsx scripts/gdrive-auth.ts
 * Saves refresh token to config/gdrive-oauth-token.json.
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const CLIENT_PATH = path.join(REPO_ROOT, "config", "gdrive-oauth-client.json");
const TOKEN_PATH  = path.join(REPO_ROOT, "config", "gdrive-oauth-token.json");
const SCOPES      = ["https://www.googleapis.com/auth/drive.file"];
const PORT        = 3456;
const REDIRECT    = `http://localhost:${PORT}`;

if (!fs.existsSync(CLIENT_PATH)) {
  console.error(`Client file not found: ${CLIENT_PATH}`);
  process.exit(1);
}

const { client_id, client_secret } =
  JSON.parse(fs.readFileSync(CLIENT_PATH, "utf-8")).installed;

const oAuth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT);

const authUrl = oAuth2.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for Google to redirect back...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Error: ${error}</h2><p>You can close this tab.</p>`);
    server.close();
    console.error("Auth denied:", error);
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>No code received.</h2><p>You can close this tab.</p>");
    return;
  }

  try {
    const { tokens } = await oAuth2.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p>");

    console.log(`Token saved to ${TOKEN_PATH}`);
    console.log("Google Drive archival is ready to use.");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Error</h2><pre>${(e as Error).message}</pre>`);
    console.error("Failed to get token:", (e as Error).message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  exec(`open "${authUrl}"`);
});

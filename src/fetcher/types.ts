/**
 * types.ts — fetcher input/output types.
 * Minimal — the fetcher takes a URL and returns text + metadata.
 */

export interface FetchResult {
  url:             string;
  description_raw: string;   // extracted plain text, ready for extractor
  fetched_at:      string;   // ISO timestamp
  status:          "ok" | "error";
  error?:          string;   // set on status=error
  http_status?:    number;
}

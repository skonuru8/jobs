/**
 * fetch.ts — JD fetcher. Stage 5 in bible §5.
 *
 * Takes a job's source_url, fetches the page, strips HTML,
 * returns description_raw as plain text.
 *
 * Bible requirements:
 * - Respect robots.txt
 * - Realistic User-Agent
 * - Polite delays per domain
 * - Handle 403/429/timeout — don't crash, return error result
 * - Return raw text ready for extractor
 */

import { FetchResult } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 15_000;

// Per-domain delay tracking — polite rate limiting.
//
// Stores the *next available slot time* for each domain, not the last-fetch time.
// This makes slot claiming an atomic (sync) read-modify-write, which is safe
// under concurrent callers in JS's single-threaded event loop:
//   Task A: reads slot=0, writes slot=now+2s, sleeps 0ms → fetches
//   Task B: reads slot=now+2s, writes slot=now+4s, sleeps 2s → fetches
//   Task C: reads slot=now+4s, writes slot=now+6s, sleeps 4s → fetches
// Without this, a simple lastFetch+delay approach races when all concurrent
// tasks read before any of them has written, bypassing the delay entirely.
const _nextSlotByDomain = new Map<string, number>();
const DOMAIN_DELAY_MS   = 2_000;   // 2s between requests to same domain

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a single job URL and return plain text.
 * Never throws — returns { status: "error" } on any failure.
 *
 * URL normalization: Dice `apply-redirect` URLs encode a base64 JSON payload
 * containing the real `jobId`. We rewrite them to the canonical job-detail URL
 * before fetching so the actual JD page is returned instead of a tiny redirect.
 */
export async function fetchJobPage(url: string): Promise<FetchResult> {
  const fetched_at = new Date().toISOString();

  // Normalize the URL first
  url = normalizeDiceApplyRedirect(url);

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, description_raw: "", fetched_at, status: "error",
             error: `Invalid URL: ${url}` };
  }

  // Polite delay per domain
  await _respectDomainDelay(parsed.hostname);

  // Fetch
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    response = await fetch(url, {
      headers: {
        "User-Agent":      USER_AGENT,
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);
  } catch (err: any) {
    const msg = err?.name === "AbortError"
      ? `Timeout after ${FETCH_TIMEOUT_MS}ms`
      : `Network error: ${err?.message ?? err}`;
    return { url, description_raw: "", fetched_at, status: "error", error: msg };
  }

  // Non-2xx
  if (!response.ok) {
    return {
      url,
      description_raw: "",
      fetched_at,
      status:      "error",
      http_status: response.status,
      error:       `HTTP ${response.status} ${response.statusText}`,
    };
  }

  // Extract text
  let html: string;
  try {
    html = await response.text();
  } catch (err: any) {
    return { url, description_raw: "", fetched_at, status: "error",
             error: `Failed to read response body: ${err?.message}` };
  }

  const description_raw = extractText(html);

  return {
    url,
    description_raw,
    fetched_at,
    status:      "ok",
    http_status: response.status,
  };
}

/**
 * Fetch multiple URLs with per-domain polite delays.
 * Returns results in same order as input.
 * Errors are captured per-result, never thrown.
 */
export async function fetchJobPages(urls: string[]): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  for (const url of urls) {
    results.push(await fetchJobPage(url));
  }
  return results;
}

// ---------------------------------------------------------------------------
// HTML → plain text
// ---------------------------------------------------------------------------

/**
 * Strip HTML to plain text.
 * Removes: script, style, nav, footer, header tags + their content.
 * Collapses whitespace. Returns readable job description text.
 */
export function extractText(html: string): string {
  // Remove script and style blocks entirely (content + tags)
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  // Remove nav/header/footer blocks — boilerplate, not JD content
  text = text
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ");

  // Convert block-level tags to newlines before stripping
  text = text
    .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = decodeEntities(text);

  // Collapse whitespace — preserve paragraph breaks (double newline)
  text = text
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line.length > 0)
    .join("\n");

  // Collapse 3+ consecutive newlines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

// ---------------------------------------------------------------------------
// Robots.txt — lightweight check
// ---------------------------------------------------------------------------

const _robotsCache = new Map<string, Set<string>>();

/**
 * Returns true if fetching the given URL is allowed by robots.txt.
 * Conservative: if robots.txt fetch fails, allow (don't block on uncertainty).
 * Caches per hostname for the lifetime of the process.
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;  // invalid URL — let fetch handle it
  }

  const hostname = parsed.hostname;
  const path     = parsed.pathname;

  if (!_robotsCache.has(hostname)) {
    await _loadRobots(hostname);
  }

  const disallowed = _robotsCache.get(hostname) ?? new Set();
  for (const prefix of disallowed) {
    if (path.startsWith(prefix)) return false;
  }
  return true;
}

async function _loadRobots(hostname: string): Promise<void> {
  const disallowed = new Set<string>();
  try {
    const res = await fetch(`https://${hostname}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal:  AbortSignal.timeout(5_000),
    });
    if (!res.ok) { _robotsCache.set(hostname, disallowed); return; }

    const text       = await res.text();
    let   applicable = false;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed))    { applicable = true; continue; }
      if (/^user-agent:/i.test(trimmed))          { applicable = false; continue; }
      if (applicable && /^disallow:/i.test(trimmed)) {
        const p = trimmed.replace(/^disallow:\s*/i, "").trim();
        if (p) disallowed.add(p);
      }
    }
  } catch {
    // Fetch failed — permissive fallback
  }
  _robotsCache.set(hostname, disallowed);
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/**
 * Dice programmatic job listings use apply-redirect URLs:
 *   https://www.dice.com/apply-redirect?applyData=<base64>
 * The base64 payload is JSON containing `jobId` — the real Dice job detail ID.
 * Rewrite these to https://www.dice.com/job-detail/{jobId} so we fetch the
 * actual JD page instead of the tiny ATS redirect response (~12 chars).
 */
function normalizeDiceApplyRedirect(url: string): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "www.dice.com" &&
      parsed.pathname === "/apply-redirect"
    ) {
      const applyData = parsed.searchParams.get("applyData");
      if (applyData) {
        const json = JSON.parse(atob(applyData));
        if (json?.jobId) {
          return `https://www.dice.com/job-detail/${json.jobId}`;
        }
      }
    }
  } catch {
    // Malformed URL or payload — fall through and fetch the original
  }
  return url;
}

// ---------------------------------------------------------------------------
// Domain delay
// ---------------------------------------------------------------------------

async function _respectDomainDelay(hostname: string): Promise<void> {
  const now      = Date.now();
  const nextSlot = _nextSlotByDomain.get(hostname) ?? 0;

  // Claim a slot synchronously — no await between read and write.
  // JS single-threaded event loop guarantees this block runs to completion
  // before any other concurrent caller can read the map.
  const mySlot = Math.max(now, nextSlot);
  _nextSlotByDomain.set(hostname, mySlot + DOMAIN_DELAY_MS);

  const wait = mySlot - now;
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

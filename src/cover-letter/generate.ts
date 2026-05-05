/**
 * generate.ts — cover letter generation and file saving.
 * Bible §12 Milestone 6.
 *
 * Output: output/cover-letters/{run_id}/{bucket}/{slug}_{job_id}.md
 *
 * File format: YAML frontmatter + full formal cover letter.
 * The LLM generates the letter body (Dear Hiring Manager → closing paragraph).
 * saveCoverLetter wraps it with the static header (name/contact/date/recipient/Re:)
 * and sign-off (Sincerely, + name).
 */

import * as fs   from "fs";
import * as path from "path";

import { complete }                                          from "./client";
import { SYSTEM_PROMPT, buildCoverLetterPrompt, PROMPT_VERSION } from "./prompt";
import type { CoverLetterInput, CoverLetterResult, CoverLetterConfig } from "./types";

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateCoverLetter(
  input:  CoverLetterInput,
  config: CoverLetterConfig,
): Promise<CoverLetterResult> {
  const generated_at = new Date().toISOString();

  const userPrompt = buildCoverLetterPrompt(input);

  const call = () => complete({
    model:       config.model,
    messages:    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userPrompt },
    ],
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    ...(config.thinking ? { thinking: config.thinking } : {}),
  });

  let content: string;
  let model: string;

  try {
    // 1 HTTP-level retry on network/timeout failure (2s backoff).
    const result = await _withHttpRetry(call);
    content = result.content;
    model   = result.model;
  } catch (e) {
    return {
      status:         "error",
      text:           null,
      model:          config.model,
      prompt_version: PROMPT_VERSION,
      generated_at,
      error:          String(e),
    };
  }

  // Strip any markdown the model may have added despite instructions
  const cleaned = stripMarkdown(content);
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

  return {
    status:         "ok",
    text:           cleaned,
    model,
    prompt_version: PROMPT_VERSION,
    generated_at,
    word_count:     wordCount,
  };
}

// ---------------------------------------------------------------------------
// File saving
// ---------------------------------------------------------------------------

/**
 * Save a cover letter to disk as a markdown file with YAML frontmatter.
 * Returns the path written.
 */
export function saveCoverLetter(
  result:  CoverLetterResult,
  input:   CoverLetterInput,
  outDir:  string,
): string {
  if (result.status !== "ok" || !result.text) {
    throw new Error("Cannot save a failed cover letter result");
  }

  const { job } = input;

  // Build a filesystem-safe slug from title + company
  const slug = `${job.title} ${job.company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  const filename = `${slug}_${job.job_id.slice(0, 8)}.md`;
  const filepath = path.join(outDir, filename);

  const today = new Date().toISOString().slice(0, 10);

  // Format date as "April 30, 2026"
  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const { contact } = input.profile;
  const candidateName = contact.name;
  const candidateContact = [
    `${contact.city}, ${contact.state}  |  ${contact.email}  |  ${contact.phone}`,
    `${contact.linkedin}  |  ${contact.github}`,
  ].join("\n");

  // Build the full formal letter body that wraps the LLM-generated content
  const letterHeader = [
    candidateName,
    candidateContact,
    "",
    formattedDate,
    "",
    "Hiring Manager",
    job.company,
    "",
    `Re: ${job.title} Position`,
    "",
  ].join("\n");

  const letterSignoff = [
    "",
    "Sincerely,",
    "",
    candidateName,
  ].join("\n");

  const fullLetter = letterHeader + result.text + letterSignoff;

  // YAML frontmatter + full formal cover letter
  const fileContent = [
    "---",
    `title: "${job.title}"`,
    `company: "${job.company}"`,
    `domain: "${job.domain ?? "unknown"}"`,
    `date: "${today}"`,
    `score: ${job.score.toFixed(3)}`,
    `skills_score: ${job.score_components.skills.toFixed(2)}`,
    `word_count: ${result.word_count}`,
    `model: "${result.model}"`,
    `job_id: "${job.job_id}"`,
    "---",
    "",
    `# Cover Letter — ${job.title} @ ${job.company}`,
    "",
    "---",
    "",
    fullLetter,
    "",
    "---",
    "",
    `*Generated ${today} · score ${job.score.toFixed(3)} · ${result.word_count} words*`,
    "",
    "**Judge notes:**",
    `> ${job.judge_reasoning ?? "N/A"}`,
    "",
    ...(job.judge_concerns.length ? [
      "**Concerns to address:**",
      ...job.judge_concerns.map(c => `- ${c}`),
      "",
    ] : []),
  ].join("\n");

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filepath, fileContent, "utf-8");

  return filepath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** 1 retry on HTTP/network errors (timeout, 5xx, connection reset). 2s backoff. */
async function _withHttpRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await fn();
  }
}

/**
 * Strip markdown artifacts the model might add despite instructions.
 * Preserves: **bold** (used for bullet skill names), bullet lines (- item), blank lines.
 * Removes: ``` code fences, standalone #/## header lines, excessive blank lines.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^```[\w]*\n?/gm, "")           // remove opening code fences
    .replace(/^```\s*$/gm, "")               // remove closing code fences
    .replace(/^#{1,3}\s+.+\n?/gm, "")       // remove standalone markdown headers
    .replace(/\n{3,}/g, "\n\n")              // collapse 3+ blank lines to 2
    .trim();
}

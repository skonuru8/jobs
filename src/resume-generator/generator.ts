/**
 * generator.ts — Full-regeneration resume LaTeX generation path.
 *
 * Builds prompt payloads, chooses premium vs fallback models, validates the
 * returned LaTeX, and salvages truncated documents when full regeneration is
 * the selected resume mode.
 *
 * Called by: `index.ts`, resume-generator tests
 * Writes to: nothing
 * Side effects: LLM API calls, console logging, retry backoff sleeps
 */

import { complete } from "@/cover-letter/client";
import { stripLatex } from "@/cover-letter/resume";

import {
  hasExtendedJudgeContext,
  buildSlimJdForPrompts,
  buildSlimProfileForPrompts,
} from "@/shared/artifact-bundle";
import { findBannedStylePhrases } from "@/shared/style-lint";

import { PROMPT_SHA, TOTAL_MODE_PROMPT, renderResumeJudgeAddendum } from "./prompt";
import type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "./types";

/**
 * Generates fully tailored resume LaTeX by asking model to rewrite canonical document.
 *
 * This path keeps canonical preamble structure but allows model to reorder and
 * rewrite content inside document. It retries across premium and fallback
 * models, rejects malformed or hedge-heavy output, and can salvage truncated
 * LaTeX only after all configured attempts fail.
 *
 * @param input - Canonical resume plus judge/profile/job context used to build user prompt.
 * @param config - Model-selection, retry, and completion settings for this generation attempt.
 * @param shortRetryHint - Optional corrective instruction appended only on retry scenarios.
 * @returns Resume generation result with accepted LaTeX or terminal error metadata.
 * @throws {Error} Propagates unexpected errors only if they escape internal completion loop logic.
 */
export async function generateResumeTex(
  input: ResumeGenInput,
  config: ResumeGenConfig,
  shortRetryHint?: string,
): Promise<ResumeGenResult> {
  const generated_at = new Date().toISOString();
  const userMsg = buildUserMessage(input, shortRetryHint);

  const usePremium = Boolean(
    config.premium_model &&
    input.judge_json.verdict === "STRONG" &&
    input.score.total >= (config.premium_min_score ?? 0.70),
  );

  const call = (model: string, stream: boolean) => complete({
    model,
    messages: [
      { role: "system", content: TOTAL_MODE_PROMPT },
      { role: "user",   content: userMsg },
    ],
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    stream,
    timeout_ms: stream ? 300_000 : undefined,
  });

  const primaryAttempts = usePremium
    ? [
        { model: config.premium_model!, stream: config.premium_stream ?? true },
        { model: config.model, stream: false },
        ...(config.fallback_model ? [{ model: config.fallback_model, stream: false }] : []),
      ]
    : [
        { model: config.model, stream: false },
        ...(config.fallback_model ? [{ model: config.fallback_model, stream: false }] : []),
      ];
  const attempts = dedupeAttempts(primaryAttempts);
  const maxPerModel = (config.retries ?? 1) + 1;
  let lastErr = "unknown";
  let lastTruncated: { tex: string; model: string; tokens: { input: number; output: number } } | null = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];
    const attemptsForModel = usePremium && attempt.model === config.premium_model
      ? attempt.stream ? 2 : 1
      : maxPerModel;
    for (let i = 0; i < attemptsForModel; i++) {
      const premiumTag = usePremium && attempt.model === config.premium_model
        ? ` (premium: score=${input.score.total.toFixed(3)} ${input.judge_json.verdict})`
        : "";
      const streamTag = attempt.stream ? " stream" : "";
      const retryTag = attemptsForModel > 1 ? ` attempt ${i + 1}/${attemptsForModel}` : "";
      console.log(`[resume] model: ${attempt.model}${premiumTag}${streamTag}${retryTag}`);
      try {
        const r = await call(attempt.model, attempt.stream);
        let tex = extractLatexDocument(stripFences(r.content).trim());
        tex = tex.replace(/^\uFEFF/, "");
        if (!tex.startsWith("\\documentclass")) {
          lastErr = `missing documentclass; first chars: ${stripFences(r.content).trim().slice(0, 160)}`;
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          continue;
        }
        if (!/\end\{document\}\s*$/s.test(tex)) {
          lastErr = `missing end{document}; last chars: ${tex.slice(-160)}`;
          if (tex.startsWith("\\documentclass")) {
            lastTruncated = { tex, model: r.model, tokens: { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 } };
          }
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          continue;
        }
        const banned = findBannedStylePhrases(tex);
        if (banned.length > 0) {
          lastErr = `banned style phrase: ${banned.join(", ")}`;
          const finalAttempt = attemptIndex === attempts.length - 1 && i === attemptsForModel - 1;
          if (finalAttempt) {
            console.warn(`[resume] final attempt contains banned style phrase; accepting with flag: ${banned.join(", ")}`);
            return {
              status:       "ok",
              tex,
              model:        r.model,
              prompt_sha:   PROMPT_SHA,
              word_count:   countWordsTex(tex),
              tokens:       { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 },
              generated_at,
              warnings:     ["banned_phrase_in_output"],
            };
          }
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          continue;
        }
        const wc = countWordsTex(tex);
        return {
          status:       "ok",
          tex,
          model:        r.model,
          prompt_sha:   PROMPT_SHA,
          word_count:   wc,
          tokens:       { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 },
          generated_at,
        };
      } catch (e) {
        lastErr = String(e);
        const isStreamAbort = lastErr.includes("terminated") || lastErr.includes("aborted");
        if (isStreamAbort && attempt.stream && i === 0) {
          console.warn(`[resume] stream abort on first attempt of ${attempt.model}; retrying once after 5s`);
          await new Promise(res => setTimeout(res, 5000));
        } else {
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          if (i < attemptsForModel - 1) {
            await new Promise(res => setTimeout(res, 2000));
          }
        }
      }
    }
  }

  // Last resort: every model attempt failed and the most recent failure was a
  // truncation. Salvage it rather than emitting no resume at all. This runs only
  // here — after the flash fallback has also failed — so it never preempts fallback.
  if (lastTruncated) {
    const recovered = recoverTruncatedLatex(lastTruncated.tex);
    if (/\end\{document\}\s*$/s.test(recovered) && findBannedStylePhrases(recovered).length === 0) {
      console.warn(`[resume] all attempts failed on truncation; salvaging recovered partial (model=${lastTruncated.model})`);
      return {
        status:       "ok",
        tex:          recovered,
        model:        lastTruncated.model,
        prompt_sha:   PROMPT_SHA,
        word_count:   countWordsTex(recovered),
        tokens:       lastTruncated.tokens,
        generated_at,
      };
    }
  }

  return {
    status:       "error",
    tex:          null,
    model:        config.model,
    prompt_sha:   PROMPT_SHA,
    word_count:   0,
    tokens:       { input: 0, output: 0 },
    generated_at,
    error:        lastErr,
  };
}

/**
 * Emits premium-path fallback logs only when active attempt belongs to premium model.
 *
 * @param usePremium - Whether current run qualified for premium-first generation.
 * @param model - Model used for failed attempt.
 * @param premiumModel - Configured premium model identifier, if any.
 * @param reason - Short terminal or retryable failure summary.
 * @param willRetryPremium - Whether same premium model will be retried before falling back.
 * @param fallbackModel - Next non-premium model that will receive control, if any.
 * @returns Nothing.
 */
function logPremiumFailure(
  usePremium: boolean,
  model: string,
  premiumModel: string | undefined,
  reason: string,
  willRetryPremium: boolean,
  fallbackModel: string | undefined,
): void {
  if (!(usePremium && model === premiumModel)) return;

  if (willRetryPremium) {
    console.warn(`[resume] premium model failed; retrying premium: ${reason.slice(0, 240)}`);
    return;
  }
  if (fallbackModel) {
    console.warn(`[resume] premium model failed; falling back to ${fallbackModel}: ${reason.slice(0, 240)}`);
    return;
  }
  console.warn(`[resume] premium model failed; no fallback remaining: ${reason.slice(0, 240)}`);
}

/**
 * Removes duplicate `(model, stream)` combinations while preserving first-seen order.
 *
 * @param attempts - Candidate completion plans assembled from premium and fallback config.
 * @returns Stable attempt list with duplicate plans removed.
 */
function dedupeAttempts(attempts: Array<{ model: string; stream: boolean }>): Array<{ model: string; stream: boolean }> {
  const seen = new Set<string>();
  return attempts.filter(a => {
    const key = `${a.model}:${a.stream ? "stream" : "plain"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds user message payload that combines canonical resume, job data, judge output, and retries.
 *
 * Slim prompt payloads are used only when judge context is rich enough to avoid
 * sending the full profile/JD. Retry hints are appended as a separate critical
 * addendum so they do not pollute first-attempt prompt hashes.
 *
 * @param input - Resume-generation input bundle for prompt rendering.
 * @param shortHint - Optional concise retry instruction added after judge addendum.
 * @returns Multisection prompt body consumed by `TOTAL_MODE_PROMPT`.
 */
function buildUserMessage(input: ResumeGenInput, shortHint?: string): string {
  const useSlim = hasExtendedJudgeContext(input.judge_json);
  const jdNames = (input.job.required_skills ?? []).map(s => s.name);
  const jdPayload = useSlim ? buildSlimJdForPrompts(input.jd_json) : input.jd_json;
  const profilePayload = useSlim
    ? buildSlimProfileForPrompts(input.profile, jdNames)
    : {
        skills: input.profile.skills,
        years_experience: input.profile.years_experience,
        education: input.profile.education,
        preferred_domains: input.profile.preferred_domains,
        contact: input.profile.contact,
        target_titles: input.profile.target_titles,
      };

  const parts = [
    "CANONICAL_RESUME:",
    input.canonical_resume_tex,
    "",
    "JD_JSON:",
    JSON.stringify(jdPayload, null, 2),
    "",
    "JUDGE_JSON:",
    JSON.stringify(input.judge_json, null, 2),
    "",
    "PROFILE_JSON:",
    JSON.stringify(profilePayload, null, 2),
    "",
    "SCORE_JSON:",
    JSON.stringify(input.score, null, 2),
  ];
  const judgeGapDirectives = (input.judge_json.gap_directives?.length ?? 0) > 0
    ? input.judge_json.gap_directives
    : (input.gap_directives ?? []);
  const judgeTechSwaps = (input.judge_json.tailoring_hints?.tech_swaps?.length ?? 0) > 0
    ? input.judge_json.tailoring_hints?.tech_swaps
    : (input.tech_swaps ?? []);
  const judgeAddendum = renderResumeJudgeAddendum(
    judgeGapDirectives,
    judgeTechSwaps,
  );
  if (judgeAddendum) {
    parts.push("", judgeAddendum);
  }
  if (shortHint) {
    parts.push("", "CRITICAL_ADDENDUM:", shortHint);
  }
  return parts.join("\n");
}

/**
 * Removes accidental Markdown fences from model output before LaTeX validation.
 *
 * @param s - Raw model text that may be wrapped in fenced code blocks.
 * @returns Trimmed text without outer Markdown fences.
 */
function stripFences(s: string): string {
  return s
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Extracts best LaTeX slice starting at `\\documentclass` from model output.
 *
 * @param s - Fence-stripped model output.
 * @returns Full document slice when both boundaries exist, otherwise best-effort truncated tail.
 */
function extractLatexDocument(s: string): string {
  const start = s.indexOf("\\documentclass");
  if (start < 0) return s;
  const end = s.lastIndexOf("\\end{document}");
  if (end >= start) return s.slice(start, end + "\\end{document}".length).trim();
  return s.slice(start).trim(); // truncated: best-effort slice, still missing \end{document}
}

/**
 * Best-effort repair of a LaTeX doc truncated before \end{document}.
 * 1) drop a trailing incomplete macro line (unbalanced braces, e.g. "\vspace{2pt")
 * 2) close still-open environments in LIFO order
 * 3) close the document
 * Recovered output is usually short → resume_too_short fires downstream as a signal.
 *
 * @param partial - Truncated LaTeX text accepted only as last-resort salvage input.
 * @returns Recovered LaTeX with obvious trailing damage removed and document closed.
 */
function recoverTruncatedLatex(partial: string): string {
  const lines = partial.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) { lines.pop(); continue; }
    const open  = (last.match(/\{/g) ?? []).length;
    const close = (last.match(/\}/g) ?? []).length;
    if (open > close) { lines.pop(); } else { break; }
  }
  const cleaned = lines.join("\n");

  const stack: string[] = [];
  const re = /\\(begin|end)\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1] === "begin") stack.push(m[2]);
    else if (stack.length > 0 && stack[stack.length - 1] === m[2]) stack.pop();
  }

  let out = cleaned;
  for (const env of stack.reverse()) {
    if (env === "document") continue; // closed last, below
    out += `\n\\end{${env}}`;
  }
  if (!out.includes("\\end{document}")) out += "\n\\end{document}";
  return out.trim();
}

/**
 * Estimates rendered word count by stripping LaTeX commands first.
 *
 * @param tex - LaTeX document to analyze.
 * @returns Plain-text word count used for downstream min/max flagging.
 */
function countWordsTex(tex: string): number {
  const plain = stripLatex(tex);
  return plain.split(/\s+/).filter(Boolean).length;
}

/**
 * Performs lightweight LaTeX sanity checks before compile stage.
 *
 * This is intentionally cheaper than full compilation and only guards against
 * obviously broken outputs that should already be flagged before persistence.
 *
 * @param tex - Generated LaTeX document candidate.
 * @returns `true` when brace imbalance is small and document boundaries exist.
 */
export function latexStructureOk(tex: string): boolean {
  const open = (tex.match(/\{/g) ?? []).length;
  const close = (tex.match(/\}/g) ?? []).length;
  if (Math.abs(open - close) > 3) return false;
  return tex.includes("\\begin{document}") && tex.includes("\\end{document}");
}

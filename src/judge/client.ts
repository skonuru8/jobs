/**
 * client.ts — OpenRouter API client (OpenAI-compatible).
 * Mirrors extractor/src/client.ts — kept separate for module independence.
 *
 * Features:
 * - Optional `reasoning` passthrough (OpenRouter unified reasoning API).
 *   Pass { enabled: false } to disable thinking on reasoning models (e.g. Qwen 3.5 Flash).
 * - <think>...</think> blocks stripped from all responses (safety net if a
 *   model ignores the reasoning flag).
 */

import { JUDGE_JSON_SCHEMA } from "./schema";

export interface ContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ChatMessage {
  role:    "system" | "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ReasoningConfig {
  enabled?:    boolean;
  effort?:     "low" | "medium" | "high";
  exclude?:    boolean;
  max_tokens?: number;
}

export interface CompletionOptions {
  model:       string;
  messages:    ChatMessage[];
  max_tokens:  number;
  temperature: number;
  reasoning?:  ReasoningConfig;
}

export interface CompletionResult {
  content:        string;
  model:          string;
  input_tokens?:  number;
  output_tokens?: number;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS  = 120_000;

export async function complete(opts: CompletionOptions): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY environment variable not set.\n" +
      "Export it: export OPENROUTER_API_KEY=sk-or-..."
    );
  }

  const body: Record<string, unknown> = {
    model:           opts.model,
    messages:        opts.messages,
    max_tokens:      opts.max_tokens,
    temperature:     opts.temperature,
    response_format: process.env.JUDGE_FORCE_JSON_OBJECT
      ? { type: "json_object" }
      : { type: "json_schema", json_schema: JUDGE_JSON_SCHEMA },
  };
  if (opts.reasoning) body["reasoning"] = opts.reasoning;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "HTTP-Referer":  "https://github.com/job-hunter",
      "X-Title":       "job-hunter-judge",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenRouter API error ${response.status}: ${errBody}`);
  }

  const data    = await response.json() as any;
  const raw     = data?.choices?.[0]?.message?.content ?? "";
  const content = stripThinkBlocks(raw);
  const model   = data?.model ?? opts.model;
  const usage   = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }

  return {
    content,
    model,
    input_tokens:  usage?.prompt_tokens,
    output_tokens: usage?.completion_tokens,
  };
}

/** Remove <think>...</think> and <redacted_thinking>...</redacted_thinking>. */
function stripThinkBlocks(text: string): string {
  return text
    .replace(/<(?:redacted_thinking|think)>[\s\S]*?<\/(?:redacted_thinking|think)>/gi, "")
    .trim();
}

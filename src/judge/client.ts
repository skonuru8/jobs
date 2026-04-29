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

export interface ChatMessage {
  role:    "system" | "user" | "assistant";
  content: string;
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
  content: string;
  model:   string;
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
    response_format: { type: "json_object" },
  };
  if (opts.reasoning) body["reasoning"] = opts.reasoning;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
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

  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }

  return { content, model };
}

/** Remove <think>...</think> blocks. Qwen emits them even with JSON mode. */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

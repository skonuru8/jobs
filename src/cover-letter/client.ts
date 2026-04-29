/**
 * client.ts — OpenRouter API client for cover letter generation.
 * Plain text response (no JSON mode — cover letters are prose).
 *
 * Supports:
 * - thinking: optional extended thinking config (Gemma 4 31B has it enabled)
 * - <think>...</think> stripping: applied to all responses regardless of model
 */

export interface ChatMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}

export interface ThinkingConfig {
  type:          "enabled";
  budget_tokens: number;
}

export interface CompletionOptions {
  model:       string;
  messages:    ChatMessage[];
  max_tokens:  number;
  temperature: number;
  thinking?:   ThinkingConfig;
}

export interface CompletionResult {
  content: string;
  model:   string;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export async function complete(opts: CompletionOptions): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY environment variable not set.\n" +
      "Export it: export OPENROUTER_API_KEY=sk-or-..."
    );
  }

  const body: Record<string, unknown> = {
    model:       opts.model,
    messages:    opts.messages,
    max_tokens:  opts.max_tokens,
    temperature: opts.temperature,
  };

  if (opts.thinking) {
    body["thinking"] = opts.thinking;
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      "HTTP-Referer":  "https://github.com/job-hunter",
      "X-Title":       "job-hunter-cover-letter",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),   // longer timeout: writing + thinking
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenRouter API error ${response.status}: ${errBody}`);
  }

  const data    = await response.json() as any;
  const raw     = (data?.choices?.[0]?.message?.content ?? "").trim();
  const content = stripThinkBlocks(raw);
  const model   = data?.model ?? opts.model;

  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }

  return { content, model };
}

/** Remove <think>...</think> blocks from response content.
 *  Gemma 4 31B (thinking enabled) and Qwen 3.5 Flash both emit these.
 *  No-op for models that don't. */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

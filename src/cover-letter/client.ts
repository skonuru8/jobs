import pLimit from "p-limit";

/**
 * client.ts — OpenRouter API client for cover letter generation.
 * Plain text response (no JSON mode — cover letters are prose).
 *
 * Supports:
 * - thinking: optional extended thinking config (Gemma 4 31B has it enabled)
 * - <think>...</think> stripping: applied to all responses regardless of model
 */

export interface ContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ChatMessage {
  role:    "system" | "user" | "assistant";
  content: string | ContentBlock[];
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
  stream?:     boolean;
  timeout_ms?: number;
}

export interface CompletionResult {
  content:        string;
  model:          string;
  input_tokens?:  number;
  output_tokens?: number;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Shared across ALL resume + cover-letter generation calls (both modules import
// this complete()). Caps simultaneous OpenRouter requests so the job-level
// pLimit(5) in run-pipeline.ts cannot fan out into 10+ concurrent LLM calls and
// blow the per-request timeout. Tune the value if throughput vs. timeout balance
// changes; 3 is safe for the current OpenRouter account and run size.
const _llmLimit = pLimit(3);

export async function complete(opts: CompletionOptions): Promise<CompletionResult> {
  return _llmLimit(() => _complete(opts));
}

async function _complete(opts: CompletionOptions): Promise<CompletionResult> {
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

  if (opts.stream) {
    body["stream"] = true;
    body["stream_options"] = { include_usage: true };
  }

  if (opts.thinking) {
    body["thinking"] = opts.thinking;
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "HTTP-Referer":  "https://github.com/job-hunter",
      "X-Title":       "job-hunter-cover-letter",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout_ms ?? 240_000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenRouter API error ${response.status}: ${errBody}`);
  }

  if (opts.stream) {
    return readStreamingCompletion(response, opts.model);
  }

  const data    = await response.json() as any;
  const raw     = (data?.choices?.[0]?.message?.content ?? "").trim();
  const model   = data?.model ?? opts.model;
  const usage   = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  // Debug: log response shape when content is empty so we can identify the root cause
  if (!raw) {
    const finish_reason = data?.choices?.[0]?.finish_reason ?? "unknown";
    const has_reasoning = Boolean(data?.choices?.[0]?.message?.reasoning);
    const reasoning_preview = typeof data?.choices?.[0]?.message?.reasoning === "string"
      ? data.choices[0].message.reasoning.slice(0, 200)
      : null;
    console.warn("[client] empty content from model=%s finish_reason=%s has_reasoning=%s reasoning_preview=%s",
      model, finish_reason, has_reasoning, reasoning_preview);
  }

  const content = resolveContent(raw);

  return {
    content,
    model,
    input_tokens:  usage?.prompt_tokens,
    output_tokens: usage?.completion_tokens,
  };
}

async function readStreamingCompletion(response: Response, fallbackModel: string): Promise<CompletionResult> {
  if (!response.body) {
    throw new Error("OpenRouter streaming response missing body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let model = fallbackModel;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  const readEvent = (event: string): void => {
    for (const line of event.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;

      let data: any;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }

      if (data?.model) model = data.model;
      const delta = data?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") raw += delta;

      const usage = data?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage) {
        inputTokens = usage.prompt_tokens;
        outputTokens = usage.completion_tokens;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      readEvent(event);
    }
  }
  if (buffer.trim()) {
    readEvent(buffer);
  }

  const content = stripThinkBlocks(raw.trim());
  if (!content) {
    throw new Error("OpenRouter returned empty streaming content");
  }

  return {
    content,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
}

/**
 * Resolves final content from raw model response.
 *
 * Primary: strip think blocks and return what's outside them.
 * Fallback: if outside is empty (model buried its answer inside a think block,
 * or max_tokens was hit mid-think), scan inside think blocks for a JSON object
 * or array and return the last one found. Throws if neither path yields content.
 */
function resolveContent(raw: string): string {
  const outside = stripThinkBlocks(raw);
  if (outside) return outside;

  // Fallback: model put JSON inside the think block
  const inside = extractJsonFromThinkBlocks(raw);
  if (inside) return inside;

  throw new Error("OpenRouter returned empty content");
}

/**
 * Scans inside think blocks for the last JSON object or array.
 * Used when the model mistakenly emits its answer inside <think>...</think>.
 */
function extractJsonFromThinkBlocks(raw: string): string {
  const blockRe = /<(?:redacted_thinking|think)>([\s\S]*?)<\/(?:redacted_thinking|think)>/gi;
  let lastJson = "";
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(raw)) !== null) {
    const inner = match[1];
    // Find the last top-level JSON object or array in this block
    const jsonMatch = inner.match(/(\{[\s\S]*\}|\[[\s\S]*\])(?=[^{[]*$)/);
    if (jsonMatch) lastJson = jsonMatch[1].trim();
  }
  return lastJson;
}

/** Remove <think>...</think> blocks from response content.
 *  Gemma 4 31B (thinking enabled) and Qwen 3.5 Flash both emit these.
 *  No-op for models that don't. */
function stripThinkBlocks(text: string): string {
  return text
    .replace(/<(?:redacted_thinking|think)>[\s\S]*?<\/(?:redacted_thinking|think)>/gi, "")
    .trim();
}

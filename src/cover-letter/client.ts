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
      "HTTP-Referer":  "https://github.com/job-hunter",
      "X-Title":       "job-hunter-cover-letter",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout_ms ?? 120_000),
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

/** Remove <think>...</think> blocks from response content.
 *  Gemma 4 31B (thinking enabled) and Qwen 3.5 Flash both emit these.
 *  No-op for models that don't. */
function stripThinkBlocks(text: string): string {
  return text
    .replace(/<(?:redacted_thinking|think)>[\s\S]*?<\/(?:redacted_thinking|think)>/gi, "")
    .trim();
}

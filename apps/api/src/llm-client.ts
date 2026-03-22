import { z } from "zod";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  model?: string;
};

export type LlmCompletion = {
  content: string;
  usage: LlmUsage | null;
};

export interface LlmClient {
  complete(messages: LlmMessage[]): Promise<string>;
  completeWithUsage(messages: LlmMessage[]): Promise<LlmCompletion>;
}

const envSchema = z.object({
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return 30_000;
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 120_000) {
        return 30_000;
      }
      return parsed;
    })
});

type OpenAiChatResponse = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

class OpenAiCompatibleLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model: string, baseUrl: string, timeoutMs: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  private extractUsage(payload: OpenAiChatResponse): LlmUsage | null {
    const inputFromPrompt = Number(payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0);
    const outputFromCompletion = Number(payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0);
    let inputTokens = Number.isFinite(inputFromPrompt) && inputFromPrompt > 0 ? Math.round(inputFromPrompt) : 0;
    let outputTokens =
      Number.isFinite(outputFromCompletion) && outputFromCompletion > 0 ? Math.round(outputFromCompletion) : 0;
    let totalTokens =
      Number.isFinite(payload.usage?.total_tokens) && Number(payload.usage?.total_tokens) > 0
        ? Math.round(Number(payload.usage?.total_tokens))
        : inputTokens + outputTokens;

    if (totalTokens > 0) {
      if (inputTokens === 0 && outputTokens > 0 && outputTokens <= totalTokens) {
        inputTokens = totalTokens - outputTokens;
      } else if (outputTokens === 0 && inputTokens > 0 && inputTokens <= totalTokens) {
        outputTokens = totalTokens - inputTokens;
      } else if (inputTokens === 0 && outputTokens === 0) {
        inputTokens = totalTokens;
      }
    }

    if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
      return null;
    }

    if (totalTokens <= 0) {
      totalTokens = inputTokens + outputTokens;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      requests: 1,
      model: typeof payload.model === "string" ? payload.model : undefined
    };
  }

  async complete(messages: LlmMessage[]): Promise<string> {
    const completion = await this.completeWithUsage(messages);
    return completion.content;
  }

  async completeWithUsage(messages: LlmMessage[]): Promise<LlmCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages
        })
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(`LLM request failed (${response.status}): ${details.slice(0, 400)}`);
      }

      const payload = (await response.json()) as OpenAiChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("LLM response missing message content");
      }

      return {
        content,
        usage: this.extractUsage(payload)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEnvLlmClient(): LlmClient | null {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    return null;
  }

  return new OpenAiCompatibleLlmClient(
    parsed.data.LLM_API_KEY,
    parsed.data.LLM_MODEL,
    parsed.data.LLM_BASE_URL,
    parsed.data.LLM_TIMEOUT_MS
  );
}

import { z } from "zod";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface LlmClient {
  complete(messages: LlmMessage[]): Promise<string>;
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

  async complete(messages: LlmMessage[]): Promise<string> {
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

      return content;
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

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
  completeWithUsageStream(
    messages: LlmMessage[],
    onDelta: (chunk: string) => void
  ): Promise<LlmCompletion>;
}

const envSchema = z.object({
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
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

type ChatCompletionsResponse = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
    message?: {
      content?: string | null;
    };
  }>;
};

class ChatCompletionsLlmClient implements LlmClient {
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

  private extractUsage(payload: ChatCompletionsResponse): LlmUsage | null {
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

  private buildRequestBody(messages: LlmMessage[], includeJsonResponseFormat: boolean): string {
    const payload: Record<string, unknown> = {
      model: this.model,
      temperature: 0.1,
      messages
    };
    if (includeJsonResponseFormat) {
      payload.response_format = { type: "json_object" };
    }
    return JSON.stringify(payload);
  }

  private shouldRetryWithoutJsonResponseFormat(status: number, details: string): boolean {
    if (status !== 400 && status !== 422) {
      return false;
    }
    return /(response_format|json_object|unsupported|unknown field|invalid request|schema)/i.test(
      details
    );
  }

  private async requestCompletion(
    messages: LlmMessage[],
    includeJsonResponseFormat: boolean,
    controller: AbortController
  ): Promise<Response> {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: this.buildRequestBody(messages, includeJsonResponseFormat)
    });
  }

  private async requestCompletionStream(
    messages: LlmMessage[],
    includeJsonResponseFormat: boolean,
    controller: AbortController
  ): Promise<Response> {
    const payload: Record<string, unknown> = {
      model: this.model,
      temperature: 0.1,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };
    if (includeJsonResponseFormat) {
      payload.response_format = { type: "json_object" };
    }
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });
  }

  private async parseSseCompletion(
    response: Response,
    onDelta: (chunk: string) => void
  ): Promise<LlmCompletion> {
    if (!response.body) {
      throw new Error("LLM streaming response body is missing");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: LlmUsage | null = null;

    const processDataLine = (line: string) => {
      if (!line.startsWith("data:")) {
        return;
      }
      const data = line.slice("data:".length).trim();
      if (!data || data === "[DONE]") {
        return;
      }

      let payload: ChatCompletionsResponse;
      try {
        payload = JSON.parse(data) as ChatCompletionsResponse;
      } catch {
        return;
      }

      const delta = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
      if (typeof delta === "string" && delta.length > 0) {
        content += delta;
        onDelta(delta);
      }

      const extractedUsage = this.extractUsage(payload);
      if (extractedUsage) {
        usage = extractedUsage;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const eventBlock of events) {
        const lines = eventBlock
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        for (const line of lines) {
          processDataLine(line);
        }
      }
    }

    if (buffer.trim().length > 0) {
      const lines = buffer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        processDataLine(line);
      }
    }

    if (!content) {
      throw new Error("LLM streaming response missing message content");
    }

    return { content, usage };
  }

  async completeWithUsage(messages: LlmMessage[]): Promise<LlmCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response = await this.requestCompletion(messages, true, controller);
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        if (this.shouldRetryWithoutJsonResponseFormat(response.status, details)) {
          response = await this.requestCompletion(messages, false, controller);
        } else {
          throw new Error(`LLM request failed (${response.status}): ${details.slice(0, 400)}`);
        }
      }

      if (!response.ok) {
        const retryDetails = await response.text().catch(() => "");
        throw new Error(`LLM request failed (${response.status}): ${retryDetails.slice(0, 400)}`);
      }

      const payload = (await response.json()) as ChatCompletionsResponse;
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

  async completeWithUsageStream(
    messages: LlmMessage[],
    onDelta: (chunk: string) => void
  ): Promise<LlmCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response = await this.requestCompletionStream(messages, true, controller);
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        if (this.shouldRetryWithoutJsonResponseFormat(response.status, details)) {
          response = await this.requestCompletionStream(messages, false, controller);
        } else {
          throw new Error(`LLM request failed (${response.status}): ${details.slice(0, 400)}`);
        }
      }

      if (!response.ok) {
        const retryDetails = await response.text().catch(() => "");
        throw new Error(`LLM request failed (${response.status}): ${retryDetails.slice(0, 400)}`);
      }

      return await this.parseSseCompletion(response, onDelta);
    } catch (error) {
      // Provider streaming may be unsupported; fallback to non-streaming completion.
      const completion = await this.completeWithUsage(messages);
      if (completion.content) {
        onDelta(completion.content);
      }
      return completion;
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

  return new ChatCompletionsLlmClient(
    parsed.data.LLM_API_KEY,
    parsed.data.LLM_MODEL,
    parsed.data.LLM_BASE_URL,
    parsed.data.LLM_TIMEOUT_MS
  );
}

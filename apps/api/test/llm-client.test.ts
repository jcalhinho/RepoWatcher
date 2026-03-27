import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvLlmClient } from "../src/llm-client.js";

const previousEnv = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS
};

afterEach(() => {
  vi.restoreAllMocks();
  if (previousEnv.LLM_API_KEY === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = previousEnv.LLM_API_KEY;
  if (previousEnv.LLM_MODEL === undefined) delete process.env.LLM_MODEL;
  else process.env.LLM_MODEL = previousEnv.LLM_MODEL;
  if (previousEnv.LLM_BASE_URL === undefined) delete process.env.LLM_BASE_URL;
  else process.env.LLM_BASE_URL = previousEnv.LLM_BASE_URL;
  if (previousEnv.LLM_TIMEOUT_MS === undefined) delete process.env.LLM_TIMEOUT_MS;
  else process.env.LLM_TIMEOUT_MS = previousEnv.LLM_TIMEOUT_MS;
});

describe("createEnvLlmClient", () => {
  it("retries without response_format when provider rejects json_object", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "test-model";
    process.env.LLM_BASE_URL = "https://llm.local/v1";
    process.env.LLM_TIMEOUT_MS = "5000";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "response_format is not supported"
            }
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "test-model",
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20
            },
            choices: [{ message: { content: '{"final":"ok"}' } }]
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = createEnvLlmClient();
    expect(client).not.toBeNull();

    const completion = await client!.completeWithUsage([{ role: "user", content: "ping" }]);
    expect(completion.content).toBe('{"final":"ok"}');
    expect(completion.usage?.requests).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCallInit = fetchMock.mock.calls[0][1] as { body?: string };
    const secondCallInit = fetchMock.mock.calls[1][1] as { body?: string };
    const firstBody = JSON.parse(String(firstCallInit.body));
    const secondBody = JSON.parse(String(secondCallInit.body));

    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody.response_format).toBeUndefined();
  });
});

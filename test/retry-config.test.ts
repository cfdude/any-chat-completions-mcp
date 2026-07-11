import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("AI_CHAT_MAX_RETRIES", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("makes exactly one attempt when AI_CHAT_MAX_RETRIES=0 and the API returns a retryable 500", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({ status: 500, json: { error: { message: "mock server error" } } }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL, AI_CHAT_MAX_RETRIES: "0" });

    const result: any = await server.client.callTool({ name: "chat-with-test-bot", arguments: { content: "hi" } });

    expect(result.isError).toBe(true);
    const attempts = mock.requests.filter((r) => r.path.includes("/chat/completions")).length;
    expect(attempts).toBe(1);
  });

  it("retries according to AI_CHAT_MAX_RETRIES when the API returns a retryable 500", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({ status: 500, json: { error: { message: "mock server error" } } }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL, AI_CHAT_MAX_RETRIES: "1" });

    const result: any = await server.client.callTool({ name: "chat-with-test-bot", arguments: { content: "hi" } });

    expect(result.isError).toBe(true);
    const attempts = mock.requests.filter((r) => r.path.includes("/chat/completions")).length;
    expect(attempts).toBe(2); // 1 initial attempt + 1 retry
  }, 20000);
});

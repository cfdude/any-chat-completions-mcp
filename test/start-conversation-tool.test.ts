import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("start-conversation-with-{name} tool", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("creates a conversation and returns its ID as tool-result text", async () => {
    mock = await startMockOpenAIServer({
      conversations: () => ({
        status: 200,
        json: { id: "conv_mock_123", created_at: 0, metadata: {}, object: "conversation" },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "start-conversation-with-test-bot",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("conv_mock_123");
  });

  it("returns isError without crashing when the API call fails", async () => {
    mock = await startMockOpenAIServer({
      conversations: () => ({
        status: 500,
        json: { error: { message: "mock conversation creation failed" } },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "start-conversation-with-test-bot",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/mock conversation creation failed/);

    // Server must still be alive after the error.
    const { tools } = await server.client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("chat-with-{name}: conversation threading", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("uses the Chat Completions path when no conversationId is given (unchanged behavior)", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: (body) => ({
        status: 200,
        json: {
          id: "chatcmpl_mock",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: "stateless reply" }, finish_reason: "stop" }],
        },
      }),
      responses: () => ({ status: 500, json: { error: { message: "responses endpoint should not be called" } } }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hello" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("stateless reply");
    expect(mock.requests.some((r) => r.path.includes("/responses"))).toBe(false);
  });

  it("threads through the Responses API when a conversationId is given", async () => {
    mock = await startMockOpenAIServer({
      responses: (body) => ({
        status: 200,
        json: {
          id: "resp_mock_1",
          created_at: 0,
          output_text: `threaded reply to: ${body.input}`,
          error: null,
          conversation: { id: body.conversation },
        },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "follow up", conversationId: "conv_abc" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("threaded reply to: follow up");

    const responsesRequest = mock.requests.find((r) => r.path.includes("/responses"));
    expect(responsesRequest).toBeDefined();
    expect(responsesRequest!.body.conversation).toBe("conv_abc");
    expect(responsesRequest!.body.input).toBe("follow up");
  });

  it("includes instructions on the Responses call when AI_CHAT_SYSTEM_PROMPT is set", async () => {
    mock = await startMockOpenAIServer({
      responses: (body) => ({
        status: 200,
        json: { id: "resp_mock_2", created_at: 0, output_text: "ok", error: null },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
      AI_CHAT_SYSTEM_PROMPT: "Be terse.",
    });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", conversationId: "conv_abc" },
    });

    const responsesRequest = mock.requests.find((r) => r.path.includes("/responses"));
    expect(responsesRequest!.body.instructions).toBe("Be terse.");
  });

  it("omits instructions entirely when AI_CHAT_SYSTEM_PROMPT is unset", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_mock_3", created_at: 0, output_text: "ok", error: null },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", conversationId: "conv_abc" },
    });

    const responsesRequest = mock.requests.find((r) => r.path.includes("/responses"));
    expect(responsesRequest!.body).not.toHaveProperty("instructions");
  });

  it("returns isError without crashing on an invalid conversationId", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 404,
        json: { error: { message: "No conversation found with id 'conv_invalid'." } },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", conversationId: "conv_invalid" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No conversation found/);

    const { tools } = await server.client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});

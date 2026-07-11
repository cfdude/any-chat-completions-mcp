import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("chat-with-{name}: previous_response_id chaining", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("threads via previous_response_id and sets store: true", async () => {
    mock = await startMockOpenAIServer({
      responses: (body) => ({
        status: 200,
        json: { id: "resp_new_1", created_at: 0, output_text: `chained: ${body.input}`, error: null },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "follow up", previousResponseId: "resp_prior" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("chained: follow up");

    const req = mock.requests.find((r) => r.path.includes("/responses"));
    expect(req).toBeDefined();
    expect(req!.body.previous_response_id).toBe("resp_prior");
    expect(req!.body.store).toBe(true);
    expect(req!.body.conversation).toBeUndefined();
  });

  it("returns isError without crashing on an invalid previousResponseId", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 404,
        json: { error: { message: "No response found with id 'resp_invalid'." } },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", previousResponseId: "resp_invalid" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No response found/);

    const { tools } = await server.client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});

describe("chat-with-{name}: response ID surfacing", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("appends a conversationResponseId block on the conversationId path", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_via_conv", created_at: 0, output_text: "reply text", error: null },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", conversationId: "conv_abc" },
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe("reply text");
    expect(result.content[1].text).toBe("conversationResponseId: resp_via_conv");
  });

  it("appends a conversationResponseId block on the previousResponseId path", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_via_chain", created_at: 0, output_text: "reply text 2", error: null },
      }),
    });
    server = await startTestServer({
      AI_CHAT_ENABLE_CONVERSATIONS: "true",
      AI_CHAT_BASE_URL: mock.baseURL,
    });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", previousResponseId: "resp_prior" },
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe("reply text 2");
    expect(result.content[1].text).toBe("conversationResponseId: resp_via_chain");
  });

  it("does not append a conversationResponseId block on the default stateless path", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_x",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "stateless reply" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi" },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("stateless reply");
  });
});

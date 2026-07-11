import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("chat-with-{name}: structured (JSON schema) outputs", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("advertises optional responseSchema, responseSchemaName, and strict properties", async () => {
    server = await startTestServer();
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool!.inputSchema.properties).toHaveProperty("responseSchema");
    expect(chatTool!.inputSchema.properties).toHaveProperty("responseSchemaName");
    expect(chatTool!.inputSchema.properties).toHaveProperty("strict");
    expect(chatTool!.inputSchema.required).not.toContain("responseSchema");
  });

  it("omits response_format from the request when responseSchema is not supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_a", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "free text" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({ name: "chat-with-test-bot", arguments: { content: "hi" } });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body).not.toHaveProperty("response_format");
  });

  it("sends response_format: json_schema with the supplied schema, name, and strict", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_b", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: '{"answer":42}' }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const schema = { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] };
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "what is the answer?", responseSchema: schema, responseSchemaName: "answer_response" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('{"answer":42}');

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer_response", schema, strict: true },
    });
  });

  it("defaults responseSchemaName to 'response' and strict to true when omitted", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_c", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: '{}' }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const schema = { type: "object", properties: {} };
    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", responseSchema: schema },
    });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "response", schema, strict: true },
    });
  });

  it("honors strict: false when explicitly supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_d", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: '{}' }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", responseSchema: { type: "object" }, strict: false },
    });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body.response_format.json_schema.strict).toBe(false);
  });

  it("rejects responseSchema combined with conversation-mode threading (out of scope for this epic)", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", responseSchema: { type: "object" }, conversationId: "conv_abc" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not supported/i);
  });

  it("returns isError without crashing when responseSchema is not a plain object", async () => {
    server = await startTestServer();
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", responseSchema: "not-an-object" },
    });
    expect(result.isError).toBe(true);
  });
});

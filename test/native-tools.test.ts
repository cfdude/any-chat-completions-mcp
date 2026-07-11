import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("chat-with-{name}: native tools via Responses API", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("routes a standalone web_search call through the Responses API (no threading)", async () => {
    mock = await startMockOpenAIServer({
      responses: (body) => ({
        status: 200,
        json: { id: "resp_ws", created_at: 0, output_text: `searched: ${body.input}`, error: null },
      }),
      chatCompletions: () => ({ status: 500, json: { error: { message: "should not be called" } } }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "what's new today?", tools: ["web_search"] },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("searched: what's new today?");

    const req = mock.requests.find((r) => r.path.includes("/responses"));
    expect(req!.body.tools).toEqual([{ type: "web_search" }]);
    expect(req!.body.conversation).toBeUndefined();
    expect(req!.body.previous_response_id).toBeUndefined();
  });

  it("sends code_interpreter with an auto-provisioned container", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_ci", created_at: 0, output_text: "computed", error: null },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "compute 2+2", tools: ["code_interpreter"] },
    });

    const req = mock.requests.find((r) => r.path.includes("/responses"));
    expect(req!.body.tools).toEqual([{ type: "code_interpreter", container: { type: "auto" } }]);
  });

  it("sends both tools in one array, in the order supplied", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_both", created_at: 0, output_text: "ok", error: null },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["web_search", "code_interpreter"] },
    });

    const req = mock.requests.find((r) => r.path.includes("/responses"));
    expect(req!.body.tools).toEqual([
      { type: "web_search" },
      { type: "code_interpreter", container: { type: "auto" } },
    ]);
  });

  it("combines tools with an existing conversationId in one call", async () => {
    mock = await startMockOpenAIServer({
      responses: (body) => ({
        status: 200,
        json: { id: "resp_combo", created_at: 0, output_text: "ok", error: null, conversation: { id: body.conversation } },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["web_search"], conversationId: "conv_xyz" },
    });

    const req = mock.requests.find((r) => r.path.includes("/responses"));
    expect(req!.body.tools).toEqual([{ type: "web_search" }]);
    expect(req!.body.conversation).toBe("conv_xyz");
    // Threaded path still gets the conversationResponseId marker.
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toBe("conversationResponseId: resp_combo");
  });

  it("does not add a conversationResponseId marker on a standalone tools-only call", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_standalone", created_at: 0, output_text: "reply only", error: null },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["web_search"] },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("reply only");
  });
});

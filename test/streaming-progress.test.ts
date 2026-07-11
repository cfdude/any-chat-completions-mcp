import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

function chunk(content: string | undefined, finish = false) {
  return {
    id: "chatcmpl_stream",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{
      index: 0,
      delta: content !== undefined ? { content } : (finish ? {} : { role: "assistant" }),
      finish_reason: finish ? "stop" : null,
    }],
  };
}

describe("streaming progress notifications", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("sends progress notifications for a plain-content call with a progress token", async () => {
    mock = await startMockOpenAIServer({
      chatCompletionsStream: () => ({
        chunks: [chunk(undefined), chunk("Hel"), chunk("lo!"), chunk(undefined, true)],
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    const result: any = await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi" } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("Hello!");
    expect(notifications.length).toBeGreaterThan(0);
  });

  it("sends zero progress notifications when no onprogress/progressToken is used", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_plain", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "plain reply" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({ name: "chat-with-test-bot", arguments: { content: "hi" } });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("plain reply");
    // No streaming request should have been attempted.
    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body.stream).toBeFalsy();
  });

  it("falls back to non-streaming when progress token is present but conversationId is also supplied", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_x", created_at: 0, output_text: "threaded reply", error: null },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    const result: any = await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", conversationId: "conv_abc" } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(result.isError).toBeFalsy();
    expect(notifications.length).toBe(0);
  });

  it("falls back to non-streaming when progress token is present but previousResponseId is also supplied", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_prid", created_at: 0, output_text: "chained reply", error: null },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    const result: any = await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", previousResponseId: "resp_prior" } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(result.isError).toBeFalsy();
    expect(notifications.length).toBe(0);
  });

  it("falls back to non-streaming when progress token is present but tools is also supplied", async () => {
    mock = await startMockOpenAIServer({
      responses: () => ({
        status: 200,
        json: { id: "resp_tools", created_at: 0, output_text: "tool reply", error: null },
      }),
    });
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true", AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", tools: ["web_search"] } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(notifications.length).toBe(0);
  });

  it("falls back to non-streaming when progress token is present but images is also supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_img", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "saw it" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", images: ["https://example.com/a.png"] } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(notifications.length).toBe(0);
  });

  it("falls back to non-streaming when progress token is present but files is also supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_files", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "read it" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", files: [{ filename: "a.pdf", mimeType: "application/pdf", data: "ZGF0YQ==" }] } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(notifications.length).toBe(0);
  });

  it("falls back to non-streaming when progress token is present but responseSchema is also supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_schema", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", responseSchema: { type: "object" } } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(notifications.length).toBe(0);
  });

  it("still streams when tools/images/files are explicitly empty arrays (no other feature args)", async () => {
    mock = await startMockOpenAIServer({
      chatCompletionsStream: () => ({ chunks: [chunk("ok"), chunk(undefined, true)] }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    const result: any = await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi", tools: [], images: [], files: [] } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    expect(result.content[0].text).toBe("ok");
    expect(notifications.length).toBeGreaterThan(0);
  });

  it("accumulates message text across notifications (not just the delta)", async () => {
    mock = await startMockOpenAIServer({
      chatCompletionsStream: () => ({
        chunks: [chunk(undefined), chunk("A"), chunk("B"), chunk("C"), chunk(undefined, true)],
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi" } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    const messages = notifications.map((n) => n.message);
    expect(messages).toEqual(["A", "AB", "ABC"]);
  });

  it("sends strictly increasing progress values", async () => {
    mock = await startMockOpenAIServer({
      chatCompletionsStream: () => ({
        chunks: [chunk("A"), chunk("B"), chunk("C")],
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const notifications: any[] = [];
    await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi" } },
      undefined,
      { onprogress: (p) => notifications.push(p) }
    );

    const progressValues = notifications.map((n) => n.progress);
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
    }
  });

  it("returns isError with no partial text when the stream errors mid-way", async () => {
    mock = await startMockOpenAIServer({
      chatCompletionsStream: () => ({
        chunks: [chunk("partial text that should not leak")],
        errorAfter: 1,
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool(
      { name: "chat-with-test-bot", arguments: { content: "hi" } },
      undefined,
      { onprogress: () => {} }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toMatch(/partial text/);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";
import { startMockOpenAIServer } from "./mock-openai-server.js";

describe("chat-with-{name}: multimodal input (images/files)", () => {
  let server: TestServerHandle | undefined;
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    await mock?.close();
    server = undefined;
    mock = undefined;
  });

  it("advertises optional images and files properties on the input schema (always, not gated by conversation mode)", async () => {
    server = await startTestServer();
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool!.inputSchema.properties).toHaveProperty("images");
    expect(chatTool!.inputSchema.properties).toHaveProperty("files");
    expect(chatTool!.inputSchema.required).not.toContain("images");
    expect(chatTool!.inputSchema.required).not.toContain("files");
  });

  it("sends plain string content when neither images nor files are supplied (unchanged default behavior)", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_x", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "plain reply" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({ name: "chat-with-test-bot", arguments: { content: "hello" } });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body.messages.at(-1).content).toBe("hello");
  });

  it("sends plain string content when images/files are explicitly empty arrays", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_empty", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "plain reply" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hello", images: [], files: [] },
    });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    expect(req!.body.messages.at(-1).content).toBe("hello");
  });

  it("returns isError without crashing on malformed files entries", async () => {
    server = await startTestServer();
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", files: [{ filename: "x.pdf" }] },
    });
    expect(result.isError).toBe(true);
  });

  it("sends a content-parts array with a text part and an image_url part when images are supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_y", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "saw the image" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "what is this?", images: ["https://example.com/cat.png"] },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("saw the image");

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    const lastMessageContent = req!.body.messages.at(-1).content;
    expect(lastMessageContent).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
    ]);
  });

  it("sends a content-parts array with a file part when files are supplied", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_z", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "read the file" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: {
        content: "summarize this",
        files: [{ filename: "doc.pdf", mimeType: "application/pdf", data: "YmFzZTY0LWRhdGE=" }],
      },
    });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    const lastMessageContent = req!.body.messages.at(-1).content;
    // file_data must be a full data: URI (data:<mime>;base64,<data>), not bare base64 -
    // OpenAI's file-inputs API rejects/mis-parses raw base64 without the prefix.
    expect(lastMessageContent).toEqual([
      { type: "text", text: "summarize this" },
      { type: "file", file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,YmFzZTY0LWRhdGE=" } },
    ]);
  });

  it("combines images and files with the text part in one content array", async () => {
    mock = await startMockOpenAIServer({
      chatCompletions: () => ({
        status: 200,
        json: {
          id: "chatcmpl_w", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        },
      }),
    });
    server = await startTestServer({ AI_CHAT_BASE_URL: mock.baseURL });

    await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: {
        content: "look at both",
        images: ["https://example.com/a.png"],
        files: [{ filename: "b.pdf", mimeType: "application/pdf", data: "ZGF0YQ==" }],
      },
    });

    const req = mock.requests.find((r) => r.path.includes("/chat/completions"));
    const lastMessageContent = req!.body.messages.at(-1).content;
    expect(lastMessageContent).toHaveLength(3);
    expect(lastMessageContent[0]).toEqual({ type: "text", text: "look at both" });
    expect(lastMessageContent[1].type).toBe("image_url");
    expect(lastMessageContent[2].type).toBe("file");
  });

  it("rejects images/files combined with conversation-mode threading (out of scope for this epic)", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });

    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", images: ["https://example.com/a.png"], conversationId: "conv_abc" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not supported/i);
  });
});

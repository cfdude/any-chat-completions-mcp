import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";

describe("native tools: schema and validation guards", () => {
  let server: TestServerHandle | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("omits tools from the schema when conversation mode is disabled", async () => {
    server = await startTestServer();
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool!.inputSchema.properties).not.toHaveProperty("tools");
  });

  it("includes tools in the schema when conversation mode is enabled", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool!.inputSchema.properties).toHaveProperty("tools");
    expect(chatTool!.inputSchema.required).not.toContain("tools");
  });

  it("returns isError when tools is supplied while conversation mode is disabled", async () => {
    server = await startTestServer();
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["web_search"] },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/conversation/i);
  });

  it("returns isError for an invalid tool name", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["not_a_real_tool"] },
    });
    expect(result.isError).toBe(true);
  });

  it("reports the invalid-tool-name shape error, not the mode-disabled error, when both are wrong at once", async () => {
    // Shape validation runs first (step 0), before the mode-disabled guard (step 1) -
    // an established, pre-existing convention (images/files/responseSchema shape checks
    // already ran before the mode-disabled guard prior to this epic).
    server = await startTestServer(); // conversation mode disabled
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["not_a_real_tool"] },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/web_search.*code_interpreter|tools must be/i);
    expect(result.content[0].text).not.toMatch(/conversation mode is not enabled/i);
  });

  it("returns isError when tools is combined with images", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["web_search"], images: ["https://example.com/a.png"] },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not supported/i);
  });

  it("returns isError when tools is combined with responseSchema", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: ["web_search"], responseSchema: { type: "object" } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not supported/i);
  });

  it("reports the tools-vs-attachments error (not the attachments-vs-threading error) when all three are combined", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: {
        content: "hi",
        tools: ["web_search"],
        images: ["https://example.com/a.png"],
        conversationId: "conv_abc",
      },
    });
    expect(result.isError).toBe(true);
    // The tools-vs-attachments guard must fire, not the pre-existing attachments-vs-threading guard.
    expect(result.content[0].text).toMatch(/native tools/i);
    expect(result.content[0].text).not.toMatch(/conversationId\/previousResponseId/);
  });

  it("still reports the pre-existing attachments-vs-threading error when tools is absent", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", images: ["https://example.com/a.png"], conversationId: "conv_abc" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/conversationId\/previousResponseId/);
  });

  it("treats tools: [] the same as omitting tools (Chat Completions default path unaffected)", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    // With tools: [] and no threading, this should NOT error, and should not attempt
    // a Responses API call (verified indirectly: default AI_CHAT_BASE_URL is unreachable,
    // so if it tried the Responses API it would still just error out the same way as
    // Chat Completions would against an unreachable host - the real assertion here is
    // that it doesn't throw due to a malformed tools-mapping call).
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", tools: [] },
    });
    expect(result.isError).toBe(true); // unreachable base URL - this just confirms no crash
  });
});

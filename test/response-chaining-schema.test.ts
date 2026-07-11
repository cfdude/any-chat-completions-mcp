import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";

describe("previousResponseId: schema and validation guards", () => {
  let server: TestServerHandle | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("omits previousResponseId from chat-with-{name}'s schema when conversation mode is disabled", async () => {
    server = await startTestServer();
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool!.inputSchema.properties).not.toHaveProperty("previousResponseId");
  });

  it("includes an optional previousResponseId property when conversation mode is enabled", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool!.inputSchema.properties).toHaveProperty("previousResponseId");
    expect(chatTool!.inputSchema.required).not.toContain("previousResponseId");
  });

  it("returns isError when previousResponseId is supplied while conversation mode is disabled", async () => {
    server = await startTestServer();
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", previousResponseId: "resp_whatever" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/conversation/i);
  });

  it("returns isError for mutual exclusion when both conversationId and previousResponseId are supplied (mode enabled)", async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", conversationId: "conv_abc", previousResponseId: "resp_abc" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/mutually exclusive/i);
  });

  it("reports the mode-disabled error (not mutual exclusion) when both params are supplied and mode is disabled", async () => {
    server = await startTestServer();
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hi", conversationId: "conv_abc", previousResponseId: "resp_abc" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/conversation mode is not enabled|conversation mode/i);
    expect(result.content[0].text).not.toMatch(/mutually exclusive/i);
  });
});

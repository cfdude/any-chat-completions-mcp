import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";

describe("conversation mode: disabled (default)", () => {
  let server: TestServerHandle;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("omits start-conversation-with-{name} from the tool list", async () => {
    const { tools } = await server.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("start-conversation-with-test-bot");
  });

  it("omits conversationId from chat-with-{name}'s input schema", async () => {
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool).toBeDefined();
    expect(chatTool!.inputSchema.properties).not.toHaveProperty("conversationId");
  });

  it("returns isError when conversationId is supplied anyway", async () => {
    const result: any = await server.client.callTool({
      name: "chat-with-test-bot",
      arguments: { content: "hello", conversationId: "conv_whatever" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/conversation/i);
  });
});

describe("conversation mode: enabled", () => {
  let server: TestServerHandle;

  beforeAll(async () => {
    server = await startTestServer({ AI_CHAT_ENABLE_CONVERSATIONS: "true" });
  });

  afterAll(async () => {
    await server.close();
  });

  it("includes start-conversation-with-{name} in the tool list", async () => {
    const { tools } = await server.client.listTools();
    expect(tools.map((t) => t.name)).toContain("start-conversation-with-test-bot");
  });

  it("includes an optional conversationId property on chat-with-{name}'s input schema", async () => {
    const { tools } = await server.client.listTools();
    const chatTool = tools.find((t) => t.name === "chat-with-test-bot");
    expect(chatTool).toBeDefined();
    expect(chatTool!.inputSchema.properties).toHaveProperty("conversationId");
    expect(chatTool!.inputSchema.required).not.toContain("conversationId");
  });
});

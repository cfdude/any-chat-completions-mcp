import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Black-box smoke test: spawns the built server exactly as a real MCP host
 * would, over stdio, and drives it with the real MCP SDK client. Exists to
 * catch breakage from the openai v4->v6 upgrade at the "does the server
 * still boot and answer tools/list" level, without needing a live OpenAI key.
 */
describe("server smoke test (built artifact, no live API calls)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: ["build/index.js"],
      env: {
        AI_CHAT_BASE_URL: "https://example.invalid/v1",
        AI_CHAT_KEY: "test-key",
        AI_CHAT_MODEL: "test-model",
        AI_CHAT_NAME: "Test Bot",
      },
    });
    client = new Client({ name: "smoke-test-client", version: "0.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it("lists the chat tool with the expected name", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("chat-with-test-bot");
  });

  it("does not register conversation tools when AI_CHAT_ENABLE_CONVERSATIONS is unset", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("start-conversation-with-test-bot");
  });
});

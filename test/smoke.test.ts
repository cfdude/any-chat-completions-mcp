import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServerHandle } from "./mcp-test-client.js";

/**
 * Black-box smoke test: spawns the built server exactly as a real MCP host
 * would, over stdio, and drives it with the real MCP SDK client. Exists to
 * catch breakage from the openai v4->v6 upgrade at the "does the server
 * still boot and answer tools/list" level, without needing a live OpenAI key.
 */
describe("server smoke test (built artifact, no live API calls)", () => {
  let server: TestServerHandle;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("lists the chat tool with the expected name", async () => {
    const { tools } = await server.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("chat-with-test-bot");
  });

  it("does not register conversation tools when AI_CHAT_ENABLE_CONVERSATIONS is unset", async () => {
    const { tools } = await server.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("start-conversation-with-test-bot");
  });
});

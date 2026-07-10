import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface TestServerHandle {
  client: Client;
  close: () => Promise<void>;
}

const DEFAULT_ENV = {
  AI_CHAT_BASE_URL: "https://example.invalid/v1",
  AI_CHAT_KEY: "test-key",
  AI_CHAT_MODEL: "test-model",
  AI_CHAT_NAME: "Test Bot",
};

/** Spawns the built server (build/index.js) over stdio and connects a real MCP client to it. */
export async function startTestServer(
  env: Partial<Record<string, string>> = {},
): Promise<TestServerHandle> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
    env: { ...DEFAULT_ENV, ...env },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    close: () => client.close(),
  };
}

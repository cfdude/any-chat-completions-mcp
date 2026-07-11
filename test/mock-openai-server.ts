import http from "node:http";
import type { AddressInfo } from "node:net";

export type MockHandler = (body: any, req: http.IncomingMessage) => { status: number; json: any };

/**
 * Streaming (SSE) handler for /chat/completions when body.stream === true.
 * `chunks` are JSON objects sent as `data: <json>\n\n` frames. If `errorAfter`
 * is set, the connection is abruptly destroyed after that many chunks
 * (simulating a mid-stream network error) instead of sending the `[DONE]`
 * terminator - matching what the openai SDK's stream parser
 * (core/streaming.ts) actually expects on the wire.
 */
export type SSEHandler = (body: any, req: http.IncomingMessage) => { chunks: any[]; errorAfter?: number };

export interface MockServerHandlers {
  chatCompletions?: MockHandler;
  chatCompletionsStream?: SSEHandler;
  conversations?: MockHandler;
  responses?: MockHandler;
}

export interface MockRequestLog {
  path: string;
  body: any;
}

/**
 * Ephemeral local HTTP server standing in for OpenAI's API. Lets tests
 * exercise the real openai SDK (real fetch, real request/response parsing)
 * against controlled, per-scenario responses instead of mocking the SDK
 * itself — the server process under test never knows it's not talking to
 * OpenAI.
 */
export async function startMockOpenAIServer(handlers: MockServerHandlers) {
  const requests: MockRequestLog[] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: any = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      requests.push({ path: req.url || "", body });

      if (req.url?.includes("/chat/completions") && body.stream === true && handlers.chatCompletionsStream) {
        const { chunks, errorAfter } = handlers.chatCompletionsStream(body, req);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const limit = errorAfter !== undefined ? errorAfter : chunks.length;
        for (let i = 0; i < limit; i++) {
          res.write(`data: ${JSON.stringify(chunks[i])}\n\n`);
        }
        if (errorAfter !== undefined) {
          req.socket.destroy();
        } else {
          res.write(`data: [DONE]\n\n`);
          res.end();
        }
        return;
      }

      let handler: MockHandler | undefined;
      if (req.url?.includes("/chat/completions")) handler = handlers.chatCompletions;
      else if (req.url?.includes("/conversations")) handler = handlers.conversations;
      else if (req.url?.includes("/responses")) handler = handlers.responses;

      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `no mock handler configured for ${req.url}` } }));
        return;
      }

      const { status, json } = handler(body, req);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${port}/v1`;

  return {
    baseURL,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

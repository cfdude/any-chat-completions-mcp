## Why

Every `chat-with-{name}` call today blocks silently until the full reply is ready, however long that takes — a client has no signal that anything is happening. The MCP protocol supports out-of-band `notifications/progress` messages tied to a client-supplied `progressToken`, and the underlying OpenAI SDK supports streaming (`stream: true`) chat completions. Wiring these together lets a client that opts in (by supplying a progress token) see live incremental progress while a long reply is generated, instead of staring at a blocked call — better UX for slow responses, at zero cost to clients that don't ask for it.

## What Changes

- When a `chat-with-{name}` call's MCP request includes `_meta.progressToken` (the client opting in to progress notifications per the MCP spec), AND the call is the simplest case — plain `content` only, none of `conversationId`/`previousResponseId`/`tools`/`images`/`files`/`responseSchema` — the server SHALL call `client.chat.completions.create({ stream: true, ... })`, iterate the resulting chunk stream, and send a `notifications/progress` message after each chunk with the accumulated reply text so far as `message` and a monotonically increasing `progress` count.
- The final `CallToolResult` returned to the client is unchanged in shape from today: the complete accumulated text as a single content block. Progress notifications are purely an additional, out-of-band UX signal — they do not replace or alter the final result.
- When no `progressToken` is supplied, OR when any of the more complex arguments (`conversationId`/`previousResponseId`/`tools`/`images`/`files`/`responseSchema`) are present, behavior is unchanged: a single non-streaming call, exactly as today.

**BREAKING**: none. Purely additive; a client that never supplies a `progressToken` sees zero behavior change.

## Capabilities

### New Capabilities
- `streaming-progress`: streams the default (simplest-case) Chat Completions call and emits MCP progress notifications when the caller has opted in via `_meta.progressToken`.

### Modified Capabilities
(none)

## Impact

- `src/index.ts`: the `CallToolRequestSchema` handler gains its second parameter (`extra`, providing `sendNotification`) to emit progress notifications; the plain-content Chat Completions branch gains a streaming variant, selected only when a progress token is present and no other feature argument is in use.
- `test/`: new coverage using a mock SSE-style streaming response, asserting the progress-notification sequence and that the final result is unchanged.
- `README.md`: document the opt-in mechanism and its scope boundary.
- **Explicitly out of scope**: streaming for the conversation-mode (Responses API) path, native tools, multimodal input, and structured outputs — each of those either has a different streaming event shape (Responses API uses SSE events, not chat-completion chunks) or adds enough combinatorial complexity that scoping this to the single simplest call shape is the right first step. Can be extended later if a concrete need shows up.

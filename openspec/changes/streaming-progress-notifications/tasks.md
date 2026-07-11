## 1. Handler wiring (RED)

Note on test harness: this project's tests drive the built server via the real `@modelcontextprotocol/sdk` `Client` over stdio (see `test/mcp-test-client.ts`). `Client.callTool(params, resultSchema?, options?)` accepts `options.onprogress`, a callback invoked for each `notifications/progress` message received for that call. Verified in the SDK source (`shared/protocol.js`): simply passing `onprogress` automatically attaches a `_meta.progressToken` to the outgoing request (derived from the request's message ID) — no manual `_meta` construction needed on the test side. Use `client.callTool({ name, arguments }, undefined, { onprogress: (p) => notifications.push(p) })` directly.

- [ ] 1.1 Write a failing test: a plain-content call with `_meta.progressToken` set (and an `onprogress` callback registered) receives at least one `notifications/progress` message before the final result.
- [ ] 1.2 Write a failing test: a plain-content call with NO `_meta.progressToken` sends zero progress notifications (unchanged default behavior).
- [ ] 1.3 Write a failing test: a call with `_meta.progressToken` set AND `conversationId` also present sends zero progress notifications (falls back to the existing non-streaming conversation-mode path).
- [ ] 1.4 Write a failing test: a call with `_meta.progressToken` set AND a non-empty `tools` also present sends zero progress notifications.
- [ ] 1.5 Write a failing test: a call with `_meta.progressToken` set AND a non-empty `images` also present sends zero progress notifications.
- [ ] 1.6 Write a failing test: a call with `_meta.progressToken` set AND `responseSchema` also present sends zero progress notifications.
- [ ] 1.7 Write a failing test: a call with `_meta.progressToken` set AND `tools: []` (empty array, no other feature argument) DOES stream and send progress notifications — confirms the empty-array-means-absent convention is honored for streaming eligibility, not just for the other guards.

## 2. Handler wiring (GREEN)

- [ ] 2.1 Add the `extra` parameter to the `CallToolRequestSchema` handler signature to access `extra.sendNotification`.
- [ ] 2.2 Read `request.params._meta?.progressToken` and reuse the EXISTING `isThreaded`/`hasTools`/`hasAttachments`/`responseSchema !== undefined` booleans (already computed for the guard chain) to determine "plain" — do not re-derive these independently.
- [ ] 2.3 Re-run tests from Section 1, confirm green.

## 3. Streaming call and progress emission (RED)

- [ ] 3.0 Extend `test/mock-openai-server.ts` with SSE response support: a handler variant that writes `Content-Type: text/event-stream` and a sequence of `data: <json>\n\n` frames followed by a terminal `data: [DONE]\n\n` (verified against the openai SDK's actual stream parser in `core/streaming.ts`, which requires exactly this framing).
- [ ] 3.1 Write a failing test: with a progress token and a mock server returning multiple SSE chunks, the final result's text equals the full concatenation of all chunks' non-empty content deltas.
- [ ] 3.2 Write a failing test: each progress notification's `message` equals the accumulated text up to and including that chunk (not just the delta).
- [ ] 3.3 Write a failing test: `progress` values are strictly increasing across notifications for a single call.
- [ ] 3.4 Write a failing test: a mid-stream error (mock server closes/errors partway through the chunk sequence) returns `isError: true` with no partial text presented as complete.
- [ ] 3.5 Write a failing test: chunks with no `delta.content` (role-only first chunk, finish-reason-only terminal chunk) do not append the string "undefined" to the accumulated text and do not trigger a spurious progress notification with garbage content.

## 4. Streaming call and progress emission (GREEN)

- [ ] 4.1 Implement the streaming branch: call `client.chat.completions.create({ ..., stream: true })` when progressToken is present and the call is plain; iterate chunks, appending `chunk.choices[0]?.delta?.content` ONLY when it's a non-empty string (guard against `undefined`), then call `extra.sendNotification` per chunk that had content.
- [ ] 4.2 On stream completion, return the same `CallToolResult` shape as the non-streaming path (single text content block, no `isError`).
- [ ] 4.3 On a stream iteration error, return `toErrorResult` with no partial text.
- [ ] 4.4 Re-run tests from Section 3, confirm green.

## 5. Refactor

- [ ] 5.1 Review for duplication between the streaming and non-streaming Chat Completions branches; extract shared logic if it reduces repetition without adding premature abstraction.
- [ ] 5.2 Confirm `npm run build` (tsc) is clean with no new type errors.
- [ ] 5.3 Run the full test suite, confirm no regressions in previously-passing tests.

## 6. Documentation

- [ ] 6.1 Add a README subsection documenting the `_meta.progressToken` opt-in mechanism, what triggers streaming, and the explicit scope boundary (plain-content calls only).

## 7. Verification

- [ ] 7.1 Manually run the MCP server with a real OpenAI API key using an MCP client capable of setting `_meta.progressToken` (e.g. the MCP Inspector, if it supports this) and confirm progress notifications are observed during a longer reply.

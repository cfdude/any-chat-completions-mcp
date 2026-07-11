## Why

`conversations-api-support` (shipped) solves multi-turn chat via a durable, explicitly-created OpenAI Conversation object — but that object has no TTL and must be created and (optionally) cleaned up separately. OpenAI's Responses API also supports a lighter-weight threading mechanism: passing `previous_response_id` on the next call chains it to the prior response's context, with no object to create or manage. This gives callers a second, simpler multi-turn option for cases where a full conversation object is unnecessary overhead (e.g. a short back-and-forth that doesn't need to be revisited later) — directly serving the "have an actual conversation with multiple requests and responses" need this project is exploring, via a different (and genuinely simpler) mechanism than the Conversations API.

## What Changes

- Extend `chat-with-{name}`'s opt-in conversation mode (still gated by `AI_CHAT_ENABLE_CONVERSATIONS`) with a second optional argument, `previousResponseId`.
- When `previousResponseId` is present (and `conversationId` is not), the call routes through `client.responses.create({ previous_response_id: previousResponseId, input, instructions?, store: true })` — chaining to the prior response's context without any conversation object.
- Every conversation-mode response (whether started via `conversationId` or via a bare first call in conversation mode) returns its own response `id` in the tool result, so the caller can pass it as `previousResponseId` on the next call to continue the thread.
- `conversationId` and `previousResponseId` are mutually exclusive on a single call (the underlying API rejects both being set); supplying both is a client error, not routed to the API.
- Document the new parameter and the trade-off vs. `conversationId` in the README.

**BREAKING**: none to the default (stateless) path. However, this is **not** a no-op change to the already-shipped `conversationId` path: every conversation-mode response (via either `conversationId` or the new `previousResponseId`) now returns a second content block (`conversationResponseId: <id>`) in addition to the reply. No existing test asserts against the full `content` array shape, so nothing currently breaks, but any downstream caller of `conversationId` that serializes the entire `content` array (rather than just its first element) will see new text appear. This is a deliberate, non-opt-out change to that path — documented here rather than silently shipped.

## Capabilities

### New Capabilities
(none — this extends the existing `conversation-state` capability rather than introducing a new one)

### Modified Capabilities
- `conversation-state`: adds `previous_response_id`-based threading as a second multi-turn mechanism alongside the existing Conversations-object mechanism; every conversation-mode response now surfaces its response ID to the caller.

## Impact

- `src/index.ts`: widen `chat-with-{name}`'s input schema with `previousResponseId`; add the mutual-exclusion check; add the `previous_response_id` branch to the existing Responses API call path; include the response `id` in tool output.
- `test/`: new test coverage for the chaining path and the mutual-exclusion error case.
- `README.md`: document `previousResponseId` and when to prefer it over `conversationId`.
- No changes to `start-conversation-with-{name}` or the Chat Completions default path.

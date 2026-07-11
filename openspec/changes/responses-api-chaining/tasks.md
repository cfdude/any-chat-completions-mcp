## 1. Schema and validation guards (RED)

- [x] 1.1 Write a failing test: `chat-with-{name}`'s input schema includes an optional `previousResponseId` property when conversation mode is enabled (and omits it when disabled).
- [x] 1.2 Write a failing test: supplying `previousResponseId` while `AI_CHAT_ENABLE_CONVERSATIONS` is unset returns `isError: true` explaining conversation mode is disabled (parallel to the existing `conversationId`-while-disabled test), and does not hit the mock API.
- [x] 1.3 Write a failing test: supplying both `conversationId` and `previousResponseId` (with conversation mode enabled) returns `isError: true` explaining mutual exclusion, and does not hit the mock API at all.
- [x] 1.4 Write a failing test: supplying both `conversationId` and `previousResponseId` while conversation mode is ALSO disabled returns the mode-disabled error specifically (not the mutual-exclusion error) — confirms guard ordering.

## 2. Schema and validation guards (GREEN)

- [x] 2.1 Add the optional `previousResponseId` property to `chat-with-{name}`'s `inputSchema` alongside `conversationId` (both gated by `AI_CHAT_ENABLE_CONVERSATIONS`).
- [x] 2.2 Extend the existing disabled-mode guard to cover `previousResponseId` the same way it covers `conversationId`.
- [x] 2.3 Add the mutual-exclusion check, ordered AFTER the disabled-mode guard and BEFORE any API call: both present → `isError` result.
- [x] 2.4 Re-run tests from Section 1, confirm green.

## 3. previous_response_id threading (RED)

- [x] 3.1 Write a failing test: `chat-with-{name}` called with `previousResponseId` calls `client.responses.create({ previous_response_id: previousResponseId, input: content, store: true, ...instructions? })`.
- [x] 3.2 Write a failing test: invalid/unrecognized `previousResponseId` → tool returns `isError: true` with the underlying message, no crash.

## 4. previous_response_id threading (GREEN)

- [x] 4.1 Implement the `previousResponseId` branch in `chat-with-{name}`'s handler, reusing the existing Responses API call machinery from the `conversationId` branch where possible.
- [x] 4.2 Re-run tests from Section 3, confirm green.

## 5. Response-ID surfacing (RED then GREEN)

- [x] 5.1 Write a failing test: a conversation-mode call via `conversationId` returns a tool result with two content blocks — the reply text, then a second block reading exactly `conversationResponseId: <id>`.
- [x] 5.2 Write a failing test: a conversation-mode call via `previousResponseId` returns the same two-block shape.
- [x] 5.3 Write a failing test: the default stateless path (no `conversationId`, no `previousResponseId`) returns only a single content block — no `conversationResponseId` block — confirming no behavior change to the untouched path.
- [x] 5.4 Implement: both the `conversationId` and `previousResponseId` branches set `store: true` and append the second content block using `response.id`.
- [x] 5.5 Re-run tests from 5.1–5.3, confirm green.

## 6. Refactor

- [x] 6.1 Review for duplication between the `conversationId` and `previousResponseId` branches (both call the Responses API with only the threading parameter differing); extract a shared helper if it reduces repetition without adding premature abstraction.
- [x] 6.2 Confirm `npm run build` (tsc) is clean with no new type errors.
- [x] 6.3 Run the full test suite, confirm no regressions in previously-passing tests (smoke, schema, start-conversation, existing chat-threading tests).

## 7. Documentation

- [x] 7.1 Add a README subsection documenting `previousResponseId`, the `conversationResponseId:` output marker (explicitly noting this marker now also appears on the pre-existing `conversationId` path, not just the new one), the mutual-exclusion rule with `conversationId`, and when to prefer this over the durable Conversations-object flow (short/ad hoc threads vs. named durable conversations).

## 8. Verification

- [ ] 8.1 Manually run the MCP server with `AI_CHAT_ENABLE_CONVERSATIONS=true` against a real OpenAI API key: send a message, extract the `conversationResponseId`, pass it as `previousResponseId` on a follow-up, confirm the model demonstrates awareness of the first turn.

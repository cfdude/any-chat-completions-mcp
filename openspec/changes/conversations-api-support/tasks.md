## 1. Prerequisites

- [ ] 1.1 Confirm `openai-sdk-modernization` epic is landed on `main` (package.json pins `openai@^6.x`, `client.responses` and `client.conversations` resources available) — this change cannot start before that lands.

## 2. Test infrastructure

- [ ] 2.1 Add a minimal test runner (e.g. `vitest`) as a devDependency, since the project currently has none.
- [ ] 2.2 Add an npm `test` script.

## 3. Configuration and schema (RED)

- [ ] 3.1 Write a failing test asserting the tool list omits `start-conversation-with-{name}` and `chat-with-{name}`'s schema omits `conversationId` when `AI_CHAT_ENABLE_CONVERSATIONS` is unset.
- [ ] 3.2 Write a failing test asserting the tool list includes `start-conversation-with-{name}` and `chat-with-{name}`'s schema includes optional `conversationId` when `AI_CHAT_ENABLE_CONVERSATIONS=true`.
- [ ] 3.3 Write a failing test asserting that calling `chat-with-{name}` with a `conversationId` argument while `AI_CHAT_ENABLE_CONVERSATIONS` is unset returns `isError: true` with a message explaining conversation mode is disabled (rather than silently ignoring the argument).

## 4. Configuration and schema (GREEN)

- [ ] 4.1 Parse `AI_CHAT_ENABLE_CONVERSATIONS` in `src/index.ts` (truthy-string check).
- [ ] 4.2 Conditionally include `start-conversation-with-{name}` in the `ListToolsRequestSchema` handler's tool array.
- [ ] 4.3 Conditionally add the optional `conversationId` property to `chat-with-{name}`'s `inputSchema` when the flag is set.
- [ ] 4.4 In the `CallToolRequestSchema` handler for `chat-with-{name}`, check for a `conversationId` argument regardless of schema declaration; if present while the flag is unset, return the `isError: true` result from 3.3 before doing anything else.
- [ ] 4.5 Re-run tests from Section 3, confirm green.

## 5. `start-conversation-with-{name}` tool (RED then GREEN)

- [ ] 5.1 Write a failing test: calling the tool creates a conversation via `client.conversations.create()` and returns its ID as tool-result text.
- [ ] 5.2 Write a failing test: calling the tool against a mocked API error returns `isError: true` with the underlying message, and does not throw/crash the process.
- [ ] 5.3 Implement the `start-conversation-with-{name}` case in the `CallToolRequestSchema` handler.
- [ ] 5.4 Re-run tests from 5.1–5.2, confirm green.

## 6. `chat-with-{name}` conversation threading (RED then GREEN)

- [ ] 6.1 Write a failing test: `chat-with-{name}` called with `content` only (no `conversationId`) still uses the existing `chat.completions.create` path, response unchanged from current behavior.
- [ ] 6.2 Write a failing test: `chat-with-{name}` called with `content` + valid `conversationId` calls `client.responses.create({ conversation: conversationId, input: content })` (plain string `input`, not a message array — this tool sends one user turn per call, with prior turns supplied by the conversation object) and returns `response.output_text` as the tool result (not `choices[0].message.content`, which does not exist on a Responses API result).
- [ ] 6.3 Write a failing test: `AI_CHAT_SYSTEM_PROMPT` set + `conversationId` present → the Responses call includes `instructions` set to that value; when unset, `instructions` is omitted entirely (not passed as `undefined`).
- [ ] 6.4 Write a failing test: invalid/unrecognized `conversationId` → tool returns `isError: true` with the underlying message, no crash.
- [ ] 6.5 Implement the branch in `chat-with-{name}`'s handler: route to Responses API when `conversationId` is present, else keep existing Chat Completions path untouched.
- [ ] 6.6 Re-run tests from 6.1–6.4, confirm green.

## 7. Refactor

- [ ] 7.1 Review the handler for duplication between the two code paths (Chat Completions vs. Responses); extract shared error-formatting logic if it reduces repetition without adding premature abstraction.
- [ ] 7.2 Confirm `npm run build` (tsc) is clean with no new type errors.

## 8. Documentation

- [ ] 8.1 Add a README section documenting `AI_CHAT_ENABLE_CONVERSATIONS`, the new tool, the `conversationId` parameter, and the explicit caveat that this only works against real OpenAI (or a provider that documents Conversations API support) — not generic Chat-Completions-only backends.

## 9. Verification

- [ ] 9.1 Manually run the MCP server with `AI_CHAT_ENABLE_CONVERSATIONS=true` against a real OpenAI API key: start a conversation, send two follow-up messages, confirm the second response demonstrates awareness of the first turn's content.
- [ ] 9.2 Manually confirm default behavior (flag unset) is unchanged against the existing default configuration.

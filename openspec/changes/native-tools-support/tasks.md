## 1. Schema and validation (RED)

- [ ] 1.1 Write a failing test: `chat-with-{name}`'s input schema includes an optional `tools` property when conversation mode is enabled (and omits it when disabled).
- [ ] 1.2 Write a failing test: `tools` supplied while conversation mode is disabled returns `isError: true`.
- [ ] 1.3 Write a failing test: an invalid entry in `tools` (not `"web_search"`/`"code_interpreter"`) returns `isError: true` without calling the API.
- [ ] 1.4 Write a failing test: non-empty `tools` combined with `images`, `files`, or `responseSchema` returns `isError: true` explaining the conflict, without calling the API.
- [ ] 1.5 Write a failing test: `tools: []` (empty array) behaves identically to omitting `tools` (falls through to Chat Completions when no threading params are present).
- [ ] 1.6 Write a failing test: `tools` + `images` + `conversationId` supplied together returns the tools-vs-attachments error specifically (NOT the pre-existing attachments-vs-threading error) — pins the guard ordering decided in design.md.
- [ ] 1.7 Write a regression test (should already pass, since it's pre-existing behavior): `images`/`files` + `conversationId`, with NO `tools` at all, still returns the pre-existing "images/files are not supported together with conversationId/previousResponseId" error unchanged.

## 2. Schema and validation (GREEN)

- [ ] 2.1 Add the optional `tools` property (array of `"web_search"` | `"code_interpreter"`) to `chat-with-{name}`'s `inputSchema`, gated by `AI_CHAT_ENABLE_CONVERSATIONS`.
- [ ] 2.2 Add runtime validation: `tools` must be an array of only the two allowed string values.
- [ ] 2.3 Add the disabled-mode guard for `tools` (parallel to the existing `conversationId`/`previousResponseId` guard).
- [ ] 2.4 Introduce a `hasTools` boolean (`tools !== undefined && tools.length > 0`), kept strictly SEPARATE from `isThreaded` — do not widen `isThreaded` to include `tools`.
- [ ] 2.5 Add the tools-vs-attachments conflict guard (`hasTools && (hasAttachments || responseSchema !== undefined)`), positioned BEFORE the pre-existing `hasAttachments && isThreaded` guard in the code so it takes precedence per the ordering in the delta spec.
- [ ] 2.6 Re-run tests from Section 1 (including 1.6 and 1.7), confirm green.

## 3. Tool-definition mapping and Responses-API routing (RED)

- [ ] 3.1 Write a failing test: `tools: ["web_search"]` with no `conversationId`/`previousResponseId` still routes through `client.responses.create` (not Chat Completions), sending `tools: [{ type: "web_search" }]`.
- [ ] 3.2 Write a failing test: `tools: ["code_interpreter"]` sends `tools: [{ type: "code_interpreter", container: { type: "auto" } }]`.
- [ ] 3.3 Write a failing test: `tools: ["web_search", "code_interpreter"]` sends both definitions in one array, in the order supplied.
- [ ] 3.4 Write a failing test: `tools` combined with a valid `conversationId` sends both the tool definitions AND `conversation` in the same Responses API call.
- [ ] 3.5 Write a failing test: a standalone `tools`-only call (no `conversationId`/`previousResponseId`) returns a tool result with exactly ONE content block (no `conversationResponseId:` marker).

## 4. Tool-definition mapping and Responses-API routing (GREEN)

- [ ] 4.1 Add a mapping function from the `tools` string array to the Responses API tool-definition array.
- [ ] 4.2 Update the routing condition to `isThreaded || hasTools` (using the separate `hasTools` boolean from task 2.4, NOT a widened `isThreaded`) so a non-empty `tools` array also triggers the Responses API path.
- [ ] 4.3 Pass the mapped tool definitions into the existing `client.responses.create` call alongside the existing `conversation`/`previous_response_id`/`instructions` params.
- [ ] 4.4 Ensure the `conversationResponseId:` second content block is only appended when `isThreaded` (not merely `hasTools`) — matches scenario 3.5.
- [ ] 4.5 Re-run tests from Section 3, confirm green.

## 5. Refactor

- [ ] 5.1 Review the routing condition and Responses-API call construction for clarity given the added `tools` branch; simplify if it reduces complexity without premature abstraction.
- [ ] 5.2 Confirm `npm run build` (tsc) is clean with no new type errors.
- [ ] 5.3 Run the full test suite, confirm no regressions in previously-passing tests.

## 6. Documentation

- [ ] 6.1 Add a README subsection documenting `tools`, its two supported values, the `AI_CHAT_ENABLE_CONVERSATIONS` requirement, the conflict with `images`/`files`/`responseSchema`, and the explicit non-support of `file_search` (with the reason why).

## 7. Verification

- [ ] 7.1 Manually run the MCP server with `AI_CHAT_ENABLE_CONVERSATIONS=true` against a real OpenAI API key: send a current-events question with `tools: ["web_search"]` and confirm the reply reflects real-time information rather than training-data knowledge.

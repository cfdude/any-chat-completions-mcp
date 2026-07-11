## Why

OpenAI's Responses API (already used by this server's opt-in conversation mode) supports native, server-executed tools — `web_search` gives the model real-time internet-grounded answers, and `code_interpreter` lets it run Python to compute or analyze data, both without this MCP server having to implement any tool logic itself. Today the server has no way to enable either. Adding them is a real capability upgrade: a caller can ask a grounded, current-events question or a computational question and get an answer backed by an actual search/execution, not just the model's training data.

## What Changes

- Add an optional `tools` argument to `chat-with-{name}`: an array whose entries are one of `"web_search"` or `"code_interpreter"`.
- When `tools` is non-empty, the call routes through the Responses API (`client.responses.create`) with the corresponding tool definitions, regardless of whether `conversationId`/`previousResponseId` is also supplied — tools work equally well on a single one-off query as within an ongoing conversation.
- `code_interpreter` uses `container: { type: "auto" }` (an OpenAI-auto-provisioned ephemeral container) — no additional configuration required from the caller.
- `tools` requires `AI_CHAT_ENABLE_CONVERSATIONS=true` (the existing gate for any Responses-API behavior) and is rejected in combination with `images`/`files`/`responseSchema` (the existing Chat-Completions-only features), consistent with this project's established scope-boundary pattern from the `multimodal-input` and `structured-outputs` epics.
- Document the new argument, its two supported values, and its OpenAI-only/conversation-mode-only constraint in the README.

**BREAKING**: none. Purely additive; default behavior (no `tools` argument) is unchanged.

## Capabilities

### New Capabilities
(none — extends the existing `conversation-state` capability, since it's gated by the same flag and uses the same Responses API call path)

### Modified Capabilities
- `conversation-state`: adds an optional `tools` argument to `chat-with-{name}` enabling native `web_search`/`code_interpreter` execution via the Responses API.

## Impact

- `src/index.ts`: widen `chat-with-{name}`'s input schema with `tools`; add validation and the tool-definition mapping; route to `responses.create` when `tools` is present even without threading params.
- `test/`: new coverage for tool-definition mapping, the standalone (non-threaded) tools path, and the rejection of `tools` combined with attachments/structured-output arguments.
- `README.md`: document `tools`, its two values, and its constraints.
- **Explicitly out of scope**: `file_search` is NOT included in this change — it requires a caller-supplied `vector_store_ids` array from OpenAI's separate Vector Stores API, which this server has no mechanism to create or manage. Adding it without that prerequisite would ship a parameter nobody could actually use. Tracked as a follow-up if a real need for file-backed search surfaces.

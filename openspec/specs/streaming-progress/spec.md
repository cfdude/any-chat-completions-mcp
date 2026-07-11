## Purpose

Give MCP clients that opt in via the standard `_meta.progressToken` mechanism live progress updates during a long-running plain-text `chat-with-{name}` reply, by streaming the underlying Chat Completions call, without changing the final result shape or requiring any new tool argument.

## Requirements

### Requirement: Progress notifications for the default (simplest-case) chat path
When a `chat-with-{name}` tool call's request includes `_meta.progressToken`, AND the call is "plain" — defined as `!isThreaded && !hasTools && !hasAttachments && responseSchema === undefined`, reusing the exact same boolean variables the handler already computes for its existing validation guard chain (never re-derived independently) — the system SHALL stream the underlying Chat Completions call and emit a `notifications/progress` message after each received chunk, carrying the accumulated reply text so far. Because `hasTools`/`hasAttachments` already treat empty arrays (`tools: []`, `images: []`, `files: []`) as "not supplied," a call with an empty array for any of those IS eligible for streaming, consistent with how those arguments are treated everywhere else in this codebase.

#### Scenario: Progress token present on a plain-content call
- **WHEN** the caller invokes `chat-with-{name}` with only `content`, and the request's `_meta.progressToken` is set
- **THEN** the system SHALL call `client.chat.completions.create` with `stream: true`
- **AND** for each chunk received where `delta.content` is a non-empty string, the system SHALL append it to the accumulated text and send a `notifications/progress` notification with the supplied `progressToken`, a monotonically increasing `progress` value, and `message` equal to the accumulated reply text so far
- **AND** chunks where `delta.content` is absent/undefined (e.g. the initial role-only chunk, the terminal finish-reason chunk) SHALL NOT append anything and SHALL NOT be treated as an error
- **AND** the final `CallToolResult` SHALL contain the complete accumulated text as a single content block, identical in shape to the non-streaming path

#### Scenario: No progress token supplied
- **WHEN** the caller invokes `chat-with-{name}` with only `content`, and the request's `_meta.progressToken` is absent
- **THEN** the system SHALL use the existing non-streaming Chat Completions call, exactly as before this change
- **AND** no progress notifications SHALL be sent

#### Scenario: Progress token present but conversation threading is also supplied
- **WHEN** the caller invokes `chat-with-{name}` with `_meta.progressToken` set AND a `conversationId` or `previousResponseId`
- **THEN** the system SHALL use the existing (non-streaming) Responses API call path, unaffected by the presence of the progress token
- **AND** no progress notifications SHALL be sent for this call

#### Scenario: Progress token present but native tools are also supplied
- **WHEN** the caller invokes `chat-with-{name}` with `_meta.progressToken` set AND a non-empty `tools` argument
- **THEN** the system SHALL use the existing (non-streaming) tools call path, unaffected by the presence of the progress token
- **AND** no progress notifications SHALL be sent for this call

#### Scenario: Progress token present but multimodal attachments are also supplied
- **WHEN** the caller invokes `chat-with-{name}` with `_meta.progressToken` set AND a non-empty `images` or `files` argument
- **THEN** the system SHALL use the existing (non-streaming) Chat Completions call path with the multi-part content array, unaffected by the presence of the progress token
- **AND** no progress notifications SHALL be sent for this call

#### Scenario: Progress token present but responseSchema is also supplied
- **WHEN** the caller invokes `chat-with-{name}` with `_meta.progressToken` set AND `responseSchema`
- **THEN** the system SHALL use the existing (non-streaming) structured-output call path, unaffected by the presence of the progress token
- **AND** no progress notifications SHALL be sent for this call

#### Scenario: Streaming call errors partway through
- **WHEN** a streamed Chat Completions call (progress token present, plain-content-only) fails partway through iterating chunks
- **THEN** the system SHALL return an error result (`isError: true`) containing the underlying error message
- **AND** SHALL NOT return any partial accumulated text as if it were a complete reply

## ADDED Requirements

### Requirement: Native tool support via the Responses API
When conversation mode is enabled, the system SHALL accept an optional `tools` argument on `chat-with-{name}`: an array whose entries are one of `"web_search"` or `"code_interpreter"`. When `tools` is non-empty, the system SHALL route the call through the Responses API with the corresponding tool definitions, regardless of whether `conversationId` or `previousResponseId` is also supplied. A non-empty `tools` array SHALL be tracked independently of `conversationId`/`previousResponseId` threading (a separate condition, not merged into it), so that validation and error messages remain accurate regardless of which arguments are combined. Validation SHALL be checked in this order: (1) mode-disabled guard — fires if `conversationId`, `previousResponseId`, or `tools` is present while `AI_CHAT_ENABLE_CONVERSATIONS` is disabled; (2) `conversationId`+`previousResponseId` mutual exclusion; (3) `tools` value validation; (4) tools-vs-attachments conflict — non-empty `tools` combined with `images`, `files`, or `responseSchema`; (5) attachments-vs-threading conflict — `images`/`files` combined with `conversationId`/`previousResponseId` when `tools` is NOT involved (pre-existing behavior, unaffected by this change); (6) routing — Responses API if threaded or tools are present, otherwise Chat Completions. This ordering guarantees that a request combining `tools`, attachments, AND threading all at once deterministically reports the tools-conflict error (step 4), not the pre-existing attachments-threading error (step 5).

#### Scenario: Standalone web_search call (no threading)
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with `content` and `tools: ["web_search"]`, with no `conversationId` or `previousResponseId`
- **THEN** the system SHALL call the Responses API with `tools: [{ type: "web_search" }]`
- **AND** the tool result SHALL contain the reply text

#### Scenario: code_interpreter call with an auto-provisioned container
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with `content` and `tools: ["code_interpreter"]`
- **THEN** the system SHALL call the Responses API with `tools: [{ type: "code_interpreter", container: { type: "auto" } }]`
- **AND** the tool result SHALL contain the reply text

#### Scenario: Both tools requested together
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with `tools: ["web_search", "code_interpreter"]`
- **THEN** the system SHALL call the Responses API with both corresponding tool definitions in the `tools` array

#### Scenario: tools combined with conversation threading
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with `tools` and a valid `conversationId`
- **THEN** the system SHALL call the Responses API with both the tool definitions AND the conversation binding in the same call

#### Scenario: tools supplied while conversation mode is disabled
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **AND** the caller invokes `chat-with-{name}` with a `tools` argument anyway (a non-schema-compliant call)
- **THEN** the system SHALL return an error result (`isError: true`) explaining that conversation mode is not enabled

#### Scenario: tools combined with images, files, or responseSchema
- **WHEN** the caller invokes `chat-with-{name}` with a non-empty `tools` argument AND any of `images`, `files`, or `responseSchema`
- **THEN** the system SHALL return an error result (`isError: true`) explaining that native tools are not supported together with those Chat-Completions-only arguments, without calling the API

#### Scenario: tools, attachments, and conversation threading all supplied together
- **WHEN** the caller invokes `chat-with-{name}` with a non-empty `tools` argument, a non-empty `images` or `files` argument, AND a `conversationId`
- **THEN** the system SHALL return the tools-vs-attachments error (the same error as the "tools combined with images, files, or responseSchema" scenario), not the attachments-vs-threading error, per the validation ordering in this requirement's description

#### Scenario: Pre-existing attachments-vs-threading behavior is unaffected when tools is absent
- **WHEN** the caller invokes `chat-with-{name}` with a non-empty `images` or `files` argument and a `conversationId`, with NO `tools` argument at all
- **THEN** the system SHALL return the pre-existing error ("images/files are not supported together with conversationId/previousResponseId"), exactly as it did before this change

#### Scenario: Standalone tools-only call does not surface a conversationResponseId marker
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with `tools` but NEITHER `conversationId` NOR `previousResponseId`
- **THEN** the tool result's `content` array SHALL contain only the reply text — no second `conversationResponseId: <id>` block, since that marker is specific to the threaded (conversationId/previousResponseId) paths, not standalone tool use

#### Scenario: Invalid tool name
- **WHEN** the caller invokes `chat-with-{name}` with a `tools` array containing a value other than `"web_search"` or `"code_interpreter"`
- **THEN** the system SHALL return an error result (`isError: true`) explaining the invalid value, without calling the API

#### Scenario: Empty tools array behaves as if tools were not supplied
- **WHEN** the caller invokes `chat-with-{name}` with `tools: []`
- **THEN** the system SHALL use the same call path it would use with no `tools` argument at all (Chat Completions by default, or the existing conversationId/previousResponseId Responses path if either is present)

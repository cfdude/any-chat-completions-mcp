## Purpose

Manage creation of, and multi-turn interaction with, a durable OpenAI Conversation object — an opt-in alternative to the server's default stateless single-turn chat behavior, for backends that support OpenAI's Conversations and Responses APIs.

## Requirements

### Requirement: Conversation mode is opt-in via configuration
The system SHALL only register the `start-conversation-with-{name}` tool and only honor a `conversationId` or `previousResponseId` argument on `chat-with-{name}` when the `AI_CHAT_ENABLE_CONVERSATIONS` environment variable is set to a truthy value. When unset, the system SHALL behave identically to the pre-existing stateless chat behavior.

#### Scenario: Conversations disabled by default
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **THEN** the tool list SHALL NOT include `start-conversation-with-{name}`
- **AND** `chat-with-{name}`'s input schema SHALL NOT include a `conversationId` property
- **AND** `chat-with-{name}`'s input schema SHALL NOT include a `previousResponseId` property

#### Scenario: Conversations enabled via configuration
- **WHEN** the server starts with `AI_CHAT_ENABLE_CONVERSATIONS=true`
- **THEN** the tool list SHALL include `start-conversation-with-{name}`
- **AND** `chat-with-{name}`'s input schema SHALL include an optional `conversationId` property
- **AND** `chat-with-{name}`'s input schema SHALL include an optional `previousResponseId` property

#### Scenario: Conversation ID supplied while conversation mode is disabled
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **AND** the caller invokes `chat-with-{name}` with a `conversationId` argument anyway (a non-schema-compliant call)
- **THEN** the system SHALL return an error result (`isError: true`) explaining that conversation mode is not enabled, rather than silently ignoring the argument and falling back to stateless behavior

#### Scenario: Previous response ID supplied while conversation mode is disabled
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **AND** the caller invokes `chat-with-{name}` with a `previousResponseId` argument anyway (a non-schema-compliant call)
- **THEN** the system SHALL return an error result (`isError: true`) explaining that conversation mode is not enabled, rather than silently ignoring the argument and falling back to stateless behavior

### Requirement: Starting a new conversation
When conversation mode is enabled, the system SHALL expose a `start-conversation-with-{name}` tool that creates a new durable OpenAI Conversation object and returns its identifier to the caller.

#### Scenario: Successful conversation creation
- **WHEN** the caller invokes `start-conversation-with-{name}` with no arguments
- **THEN** the system SHALL call the configured endpoint's Conversations API to create a new conversation
- **AND** the tool result SHALL contain the new conversation's identifier as text

#### Scenario: Conversation creation fails against an incompatible endpoint
- **WHEN** the caller invokes `start-conversation-with-{name}` against an `AI_CHAT_BASE_URL` that does not implement the Conversations API
- **THEN** the tool SHALL return an error result (`isError: true`) containing the underlying API error message, without crashing the server

### Requirement: Continuing an existing conversation
When conversation mode is enabled, the system SHALL accept an optional `conversationId` argument on `chat-with-{name}` and, when present, SHALL thread the request through the identified conversation instead of starting a stateless exchange. The system SHALL also accept an optional `previousResponseId` argument as a lightweight alternative: when present, the system SHALL thread the request via the Responses API's `previous_response_id` chaining instead of a Conversation object. `conversationId` and `previousResponseId` are mutually exclusive on a single call. Validation SHALL be checked in this order: (1) conversation-mode-disabled guard for either parameter, (2) mutual-exclusion guard, (3) routing to the appropriate call path — so a request violating multiple rules at once (e.g. mode disabled AND both parameters supplied) deterministically reports the mode-disabled error.

#### Scenario: Follow-up call with a conversation ID
- **WHEN** the caller invokes `chat-with-{name}` with both `content` and a valid `conversationId` obtained from a prior `start-conversation-with-{name}` call
- **THEN** the system SHALL call the Responses API with the conversation bound to that ID
- **AND** the model's response SHALL have access to the full prior history of that conversation
- **AND** the tool result SHALL contain the new response text

#### Scenario: Call without a conversation ID behaves as today
- **WHEN** the caller invokes `chat-with-{name}` with only `content` (no `conversationId`, no `previousResponseId`), regardless of whether conversation mode is enabled
- **THEN** the system SHALL use the existing stateless Chat Completions call path
- **AND** behavior SHALL be identical to the system's behavior before this change

#### Scenario: Invalid or expired conversation ID
- **WHEN** the caller invokes `chat-with-{name}` with a `conversationId` that the endpoint does not recognize
- **THEN** the system SHALL return an error result (`isError: true`) containing the underlying API error message, without crashing the server

#### Scenario: Follow-up call with a previous response ID
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with `content` and a `previousResponseId` obtained from a prior conversation-mode response
- **THEN** the system SHALL call the Responses API with `previous_response_id` set to that value and `store: true`
- **AND** the model's response SHALL have access to the context of the referenced prior response
- **AND** the tool result SHALL contain the new response text and the new response's own ID for further chaining

#### Scenario: Both conversationId and previousResponseId supplied
- **WHEN** the caller invokes `chat-with-{name}` with both `conversationId` and `previousResponseId` set
- **THEN** the system SHALL return an error result (`isError: true`) explaining the two are mutually exclusive, without calling the API

#### Scenario: Invalid or expired previous response ID
- **WHEN** the caller invokes `chat-with-{name}` with a `previousResponseId` that the endpoint does not recognize
- **THEN** the system SHALL return an error result (`isError: true`) containing the underlying API error message, without crashing the server

#### Scenario: Conversation-mode response surfaces its own ID for chaining
- **WHEN** conversation mode is enabled and the caller invokes `chat-with-{name}` with either `conversationId` or `previousResponseId`
- **THEN** the tool result's `content` array SHALL contain the reply as its first text block, unchanged
- **AND** the tool result SHALL contain a second text block with the exact text `conversationResponseId: <id>` (where `<id>` is the new response's own ID), so the caller can pass it as `previousResponseId` on a subsequent call
- **AND** when neither `conversationId` nor `previousResponseId` is present (the default stateless path), the tool result SHALL NOT contain this second block

### Requirement: System prompt applies consistently in conversation mode
When `AI_CHAT_SYSTEM_PROMPT` is configured and conversation mode is used, the system SHALL pass it as the `instructions` parameter to the Responses API call.

#### Scenario: System prompt configured
- **WHEN** `AI_CHAT_SYSTEM_PROMPT` is set and the caller sends a message via `chat-with-{name}` with a `conversationId`
- **THEN** the Responses API call SHALL include the configured value as `instructions`

#### Scenario: System prompt not configured
- **WHEN** `AI_CHAT_SYSTEM_PROMPT` is unset and the caller sends a message via `chat-with-{name}` with a `conversationId`
- **THEN** the Responses API call SHALL omit the `instructions` parameter entirely

### Requirement: Native tool support via the Responses API
When conversation mode is enabled, the system SHALL accept an optional `tools` argument on `chat-with-{name}`: an array whose entries are one of `"web_search"` or `"code_interpreter"`. When `tools` is non-empty, the system SHALL route the call through the Responses API with the corresponding tool definitions, regardless of whether `conversationId` or `previousResponseId` is also supplied. A non-empty `tools` array SHALL be tracked independently of `conversationId`/`previousResponseId` threading (a separate condition, not merged into it), so that validation and error messages remain accurate regardless of which arguments are combined.

Validation SHALL be checked in this order: (0) shape/type validation for every argument (`tools`, `images`, `files`, `responseSchema`, `responseSchemaName`, `strict`) runs first, independent of any other argument's value — this is an established, pre-existing convention in this codebase (shape checks for `images`/`files`/`responseSchema` already ran before the mode-disabled guard prior to this change) and is intentionally NOT reordered per-argument; (1) mode-disabled guard — fires if `conversationId`, `previousResponseId`, or `tools` is present while `AI_CHAT_ENABLE_CONVERSATIONS` is disabled; (2) `conversationId`+`previousResponseId` mutual exclusion; (3) tools-vs-attachments conflict — non-empty `tools` combined with `images`, `files`, or `responseSchema`; (4) attachments-vs-threading conflict — `images`/`files` combined with `conversationId`/`previousResponseId` when `tools` is NOT involved (pre-existing behavior, unaffected by this change); (5) routing — Responses API if threaded or tools are present, otherwise Chat Completions. This ordering guarantees that a request combining `tools`, attachments, AND threading all at once deterministically reports the tools-conflict error (step 3), not the pre-existing attachments-threading error (step 4); and that a request with an invalid `tools` value (a step-0 shape violation) always reports the shape error regardless of whether conversation mode is also disabled, consistent with how `images`/`files`/`responseSchema` shape violations have always been reported ahead of the mode-disabled guard.

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

#### Scenario: Invalid tool name takes precedence over the mode-disabled guard
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **AND** the caller invokes `chat-with-{name}` with a `tools` array containing an invalid value (a non-schema-compliant call, since `tools` isn't even in the schema when disabled)
- **THEN** the system SHALL return the shape-validation error (invalid tool name), not the mode-disabled error, per the step-0-runs-first ordering in this requirement's description

#### Scenario: Empty tools array behaves as if tools were not supplied
- **WHEN** the caller invokes `chat-with-{name}` with `tools: []`
- **THEN** the system SHALL use the same call path it would use with no `tools` argument at all (Chat Completions by default, or the existing conversationId/previousResponseId Responses path if either is present)

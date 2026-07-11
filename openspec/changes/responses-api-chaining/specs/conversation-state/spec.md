## MODIFIED Requirements

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

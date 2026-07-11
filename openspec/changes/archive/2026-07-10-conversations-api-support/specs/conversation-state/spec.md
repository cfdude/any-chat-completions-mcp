## ADDED Requirements

### Requirement: Conversation mode is opt-in via configuration
The system SHALL only register the `start-conversation-with-{name}` tool and only honor a `conversationId` argument on `chat-with-{name}` when the `AI_CHAT_ENABLE_CONVERSATIONS` environment variable is set to a truthy value. When unset, the system SHALL behave identically to the pre-existing stateless chat behavior.

#### Scenario: Conversations disabled by default
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **THEN** the tool list SHALL NOT include `start-conversation-with-{name}`
- **AND** `chat-with-{name}`'s input schema SHALL NOT include a `conversationId` property

#### Scenario: Conversations enabled via configuration
- **WHEN** the server starts with `AI_CHAT_ENABLE_CONVERSATIONS=true`
- **THEN** the tool list SHALL include `start-conversation-with-{name}`
- **AND** `chat-with-{name}`'s input schema SHALL include an optional `conversationId` property

#### Scenario: Conversation ID supplied while conversation mode is disabled
- **WHEN** the server starts without `AI_CHAT_ENABLE_CONVERSATIONS` set
- **AND** the caller invokes `chat-with-{name}` with a `conversationId` argument anyway (a non-schema-compliant call)
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
When conversation mode is enabled, the system SHALL accept an optional `conversationId` argument on `chat-with-{name}` and, when present, SHALL thread the request through the identified conversation instead of starting a stateless exchange.

#### Scenario: Follow-up call with a conversation ID
- **WHEN** the caller invokes `chat-with-{name}` with both `content` and a valid `conversationId` obtained from a prior `start-conversation-with-{name}` call
- **THEN** the system SHALL call the Responses API with the conversation bound to that ID
- **AND** the model's response SHALL have access to the full prior history of that conversation
- **AND** the tool result SHALL contain the new response text

#### Scenario: Call without a conversation ID behaves as today
- **WHEN** the caller invokes `chat-with-{name}` with only `content` (no `conversationId`), regardless of whether conversation mode is enabled
- **THEN** the system SHALL use the existing stateless Chat Completions call path
- **AND** behavior SHALL be identical to the system's behavior before this change

#### Scenario: Invalid or expired conversation ID
- **WHEN** the caller invokes `chat-with-{name}` with a `conversationId` that the endpoint does not recognize
- **THEN** the system SHALL return an error result (`isError: true`) containing the underlying API error message, without crashing the server

### Requirement: System prompt applies consistently in conversation mode
When `AI_CHAT_SYSTEM_PROMPT` is configured and conversation mode is used, the system SHALL pass it as the `instructions` parameter to the Responses API call.

#### Scenario: System prompt configured
- **WHEN** `AI_CHAT_SYSTEM_PROMPT` is set and the caller sends a message via `chat-with-{name}` with a `conversationId`
- **THEN** the Responses API call SHALL include the configured value as `instructions`

#### Scenario: System prompt not configured
- **WHEN** `AI_CHAT_SYSTEM_PROMPT` is unset and the caller sends a message via `chat-with-{name}` with a `conversationId`
- **THEN** the Responses API call SHALL omit the `instructions` parameter entirely

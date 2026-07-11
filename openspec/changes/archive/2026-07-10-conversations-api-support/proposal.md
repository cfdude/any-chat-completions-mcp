## Why

Today the MCP tool `chat-with-{name}` calls OpenAI's Chat Completions API statelessly: every call is a brand-new conversation, and a client that wants multi-turn context must resend the full transcript itself (which this server has no mechanism to accept — the tool only takes a single `content` string). OpenAI's Conversations API (GA since August 2025) lets a server hold a durable `conversation` object and thread turns through it with no TTL, which is exactly the "actual back-and-forth conversation" gap the user identified. This is worth doing now because GPT-5.6 (Sol/Terra/Luna, released July 9, 2026) is the trigger that prompted the review, and the `openai-sdk-modernization` epic (bumping `openai` to v6.x) is what makes the Conversations/Responses resources available at all — this change is the direct payoff of that upgrade.

## What Changes

- Add a new opt-in mode, enabled via an environment variable (e.g. `AI_CHAT_ENABLE_CONVERSATIONS=true`), that switches the tool from `chat.completions.create` to the Responses API (`client.responses.create`) bound to a persistent `client.conversations` object.
- Add a new tool, `start-conversation-with-{name}`, that creates a new OpenAI `conversation` object and returns its ID to the caller.
- Extend the existing `chat-with-{name}` tool's input schema with an optional `conversationId` parameter; when present (and conversations mode is enabled), the call is threaded through `client.responses.create({ conversation: conversationId, ... })` instead of starting fresh.
- When conversations mode is **not** enabled (the default), behavior is unchanged — this preserves compatibility with the many "OpenAI SDK-compatible" backends (Perplexity, local models, etc.) that only implement Chat Completions and do not support the Conversations/Responses endpoints.
- Document the new mode, its env vars, and its OpenAI-only constraint in the README.

**BREAKING**: none. All new behavior is opt-in and additive; default behavior (no `AI_CHAT_ENABLE_CONVERSATIONS`, no `conversationId`) is identical to today.

## Capabilities

### New Capabilities
- `conversation-state`: manages creation of and multi-turn interaction with a durable OpenAI Conversation object, as an opt-in alternative to today's stateless single-turn chat.

### Modified Capabilities
(none — no existing spec-level capabilities are being changed; the current single-turn chat behavior is preserved as the default path)

## Impact

- `src/index.ts`: new tool registration (`start-conversation-with-{name}`), extended input schema and branching logic for `chat-with-{name}`, new env var parsing.
- `package.json` / `package-lock.json`: requires the `openai-sdk-modernization` epic to have landed first (this change cannot be implemented against `openai@4.73.1`, which has no `responses`/`conversations` resources).
- `README.md`: new section documenting conversation-mode configuration and its OpenAI-only limitation.
- No changes to existing tool names, schemas, or default behavior for callers who don't opt in.

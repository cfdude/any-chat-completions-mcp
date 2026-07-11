## Context

`conversations-api-support` (shipped) added an opt-in Responses API path to `chat-with-{name}`, gated by `AI_CHAT_ENABLE_CONVERSATIONS`, threaded through an explicit `conversation` object. The `openai@6.46.0` SDK (verified by unpacking the npm tarball's type definitions) also exposes `previous_response_id?: string | null` and `store?: boolean | null` on `ResponseCreateParams` — a second, independent threading mechanism: pass the prior call's `response.id` to chain context, with no conversation object at all. This is genuinely simpler for short-lived threads (e.g. a single multi-step task) where creating and potentially cleaning up a Conversation object is unwarranted overhead.

## Goals / Non-Goals

**Goals:**
- Let a caller in conversation mode chain calls together via `previousResponseId` without creating a Conversation object.
- Surface each response's `id` to the caller so it can be passed forward, without requiring a separate "start" step (unlike the Conversations flow).
- Keep this strictly additive to the existing conversation-mode surface; the Conversations-object path is untouched.

**Non-Goals:**
- Not deprecating or replacing `conversationId`/`start-conversation-with-{name}` — both mechanisms coexist as documented alternatives with different trade-offs (durable + explicit vs. lightweight + implicit).
- Not implementing response deletion/cleanup tooling for `store: true` responses (OpenAI's default 30-day TTL on stored responses applies; this is a documented trade-off, not a gap to close here).
- Not allowing both `conversationId` and `previousResponseId` on the same call — the underlying API does not support combining them, so this is rejected client-side rather than silently picking one.

## Decisions

**Decision: `previousResponseId` reuses the same `AI_CHAT_ENABLE_CONVERSATIONS` flag rather than a new one.**
Both threading mechanisms are facets of the same "multi-turn conversation mode" capability from a deployment perspective (OpenAI-only, opt-in). A separate flag would let a user enable one threading style but not the other for no real benefit, adding configuration surface without a corresponding need.

**Decision: every conversation-mode Responses call (both `conversationId` and `previousResponseId` paths) sets `store: true` and returns the response `id` as a second content block, not concatenated into the reply text.**
Without `store: true`, a response cannot be referenced by a later `previous_response_id` call (OpenAI discards unstored response state). The tool result's `content` array gets a second `{ type: "text", text: "conversationResponseId: <id>" }` block appended after the reply block — this keeps the reply text itself byte-identical to what a human/model would want to read, while still making the ID easy to extract with a fixed prefix. This is a small, deliberate behavior change to the existing `conversationId` path (previously only the reply was returned); it only affects conversation-mode calls, never the default stateless path.

**Decision: reject `conversationId` + `previousResponseId` supplied together as a client error, not a silent precedence rule.**
Silently preferring one would hide a caller mistake. Consistent with the existing "fail loudly on misconfiguration" pattern from `conversations-api-support`.

## Risks / Trade-offs

- **[Risk]** `store: true` means every conversation-mode response persists on OpenAI's side for up to 30 days even when the caller never chains it further (e.g. a one-off conversation-mode call with no follow-up). This is a real, if modest, cost/data-retention trade-off vs. the default stateless path (which the user can avoid entirely by not enabling conversation mode).
  → **Mitigation**: documented plainly in the README next to the existing Conversations-API caveat; no code-level mitigation needed since this matches documented OpenAI behavior for `store: true`, not a bug.
- **[Trade-off]** Two multi-turn mechanisms on one tool adds a small amount of conceptual surface (when to use which). Accepted because they serve genuinely different use cases (ad hoc short thread vs. durable named conversation), and "resist complexity until it hurts" doesn't apply here — this isn't speculative, it's the proposal's whole stated purpose.

## Migration Plan

Purely additive — no migration. A deployment with conversation mode already enabled sees no behavior change unless a caller starts passing `previousResponseId`.

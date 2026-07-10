## Context

`any-chat-completions-mcp` exposes exactly one MCP tool (`chat-with-{name}`) that wraps `client.chat.completions.create()` from the `openai` npm package. Every call is independent — there is no way for a client to say "this is a follow-up to my earlier message." The server is deliberately generic: `AI_CHAT_BASE_URL`/`AI_CHAT_KEY`/`AI_CHAT_MODEL` let it point at any OpenAI-SDK-compatible endpoint (OpenAI itself, Perplexity, local models via Ollama/LM Studio, etc.), and most of those non-OpenAI backends only implement Chat Completions.

OpenAI's Conversations API (verified by unpacking the `openai@6.46.0` npm tarball — not yet installed in this repo — and inspecting its type definitions: `resources/conversations/conversations.d.ts` exposes `create`, `retrieve`, `update`, `delete`) provides a durable, non-expiring `conversation` object that the Responses API (`resources/responses.d.ts`) can be threaded through via a `conversation` parameter. This is genuinely new server-side capability, not available on `openai@4.73.1` (the version currently pinned in this repo's `package.json` — verified by the same tarball-unpacking method that no `responses`/`conversations` resource exists in that version at all), which is why this change hard-depends on the `openai-sdk-modernization` epic landing first.

That prerequisite is tracked as a `claude-code`-lane epic in `.conductor/state.json` (id `openai-sdk-modernization`, currently `active`, P0) rather than as its own OpenSpec proposal — per this project's lane-routing rules, a dependency-version bump with a single call site is a `<2h` mechanical change, not a spec-worthy one. Task 1.1 below is the checkable gate: it fails (and blocks all later tasks) until that epic's status is `archived`/done and `package.json` actually pins `^6.x`.

## Goals / Non-Goals

**Goals:**
- Let a client have a real multi-turn conversation: start it once, get an ID back, pass that ID on every follow-up call, and have OpenAI retain full context server-side.
- Keep today's stateless single-call behavior as the unchanged default — zero impact on existing users/configs.
- Keep the server working against non-OpenAI Chat-Completions-only backends; conversation mode must never be forced on.

**Non-Goals:**
- Not migrating the *default* code path off Chat Completions to Responses — that's a larger, separate decision (tracked as its own epic, `responses-api-chaining`) with its own trade-offs (typed output items, `store` semantics, streaming shape).
- Not implementing conversation listing/deletion/administration tools — only create + use.
- Not handling multi-user/multi-session conversation routing or persistence of conversation IDs across MCP server restarts — the calling client is responsible for remembering the `conversationId` it received and passing it back.

## Decisions

**Decision: opt-in via an environment variable, not always-on.**
`AI_CHAT_ENABLE_CONVERSATIONS` (boolean-ish, default unset/false) gates whether the new tool is registered and whether `chat-with-{name}` accepts/honors `conversationId`. Alternative considered: detect capability at runtime by probing the endpoint. Rejected — adds a network round-trip and failure mode at startup for a property that's really a deployment-time fact (only real OpenAI, or a provider that explicitly documents Conversations API compatibility, supports this).

**Decision: a separate `start-conversation-with-{name}` tool, rather than auto-creating a conversation on first call.**
Explicit creation gives the calling client (and the user driving it) a durable ID to hold onto and reuse across MCP tool calls, sessions, or even different chat clients. Alternative considered: auto-create silently on the first `chat-with-{name}` call. Rejected — the ID would only exist in that one exchange's tool-result text, easy to lose, and it conflates "start fresh" with "continue" in one tool.

**Decision: `chat-with-{name}` grows an optional `conversationId` argument rather than becoming two entirely separate tools.**
Keeps the tool surface small and matches how the underlying Responses API works (`conversation` is just one more parameter to `responses.create`). When `conversationId` is absent, behavior is byte-for-byte what it is today (Chat Completions, single-turn). When present, the call routes through `client.responses.create({ conversation: conversationId, input: content, instructions: AI_CHAT_SYSTEM_PROMPT })` — `input` is the plain `content` string (the Responses API accepts a bare string for a single user turn; there is no need for a typed message-item array here since this tool only ever sends one user turn per call, with prior turns supplied by the conversation object itself), and the response is read from `response.output_text` (not `choices[0].message.content`, which does not exist on a Responses API result).

**Decision: fail loudly, not silently, if `conversationId` is passed while conversation mode is disabled.**
Returns an MCP tool error (`isError: true`) explaining the misconfiguration, rather than silently ignoring the parameter — consistent with the existing error-handling style in `src/index.ts`. (The schema itself prevents the only other structurally possible mismatch: when conversation mode is disabled, `conversationId` is not even a property on the schema, so a spec-compliant client cannot construct the reverse case.)

**Decision: system prompt handling stays consistent with the Responses API's `instructions` field.**
`AI_CHAT_SYSTEM_PROMPT` maps to `instructions` on `responses.create` (not injected as a `system` role message, which Responses API doesn't use the same way Chat Completions does).

## Risks / Trade-offs

- **[Risk]** Conversation objects only work against real OpenAI (or a provider that separately documents support for Conversations/Responses). A user who sets `AI_CHAT_BASE_URL` to a Perplexity/local endpoint and enables this flag will get API errors from the provider, not a clear upfront message.
  → **Mitigation**: document the constraint prominently in the README; the tool-level error returned by the SDK on an unsupported endpoint (typically a 404 on `/conversations`) is passed through via the existing error-handling path, not swallowed.
- **[Risk]** `openai@6.x` is two major versions ahead of the currently pinned `4.73.1` — a real behavioral change, not just a new resource.
  → **Mitigation**: this change is strictly sequenced after `openai-sdk-modernization`, which is scoped and tested independently first.
- **[Trade-off]** Conversation objects have no TTL and accumulate cost/storage on OpenAI's side indefinitely unless the caller deletes them. This change doesn't add a `delete-conversation` tool.
  → Accepted for now; flagged as a follow-up if usage shows it's needed (matches "resist complexity until it hurts" — no concrete need for deletion yet).

## Migration Plan

1. Land `openai-sdk-modernization` first (hard dependency — this change cannot compile or run without it).
2. Implement additively: new tool + widened schema, gated entirely behind `AI_CHAT_ENABLE_CONVERSATIONS`.
3. No data migration, no breaking change to existing deployments — a user who does nothing sees no behavior change.
4. Rollback: unset `AI_CHAT_ENABLE_CONVERSATIONS` (or don't set it) to fully disable; no state to clean up on the server side since conversation objects live entirely on OpenAI's side.

## Open Questions

- Should `start-conversation-with-{name}` accept an optional initial system/instructions override, or always defer to `AI_CHAT_SYSTEM_PROMPT`? (Leaning toward: always defer, keep the tool minimal — revisit if a real need shows up.)
- Exact boolean parsing for `AI_CHAT_ENABLE_CONVERSATIONS` (accept `"true"`/`"1"` case-insensitively?) — implementation detail, not blocking design.

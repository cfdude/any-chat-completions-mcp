## Context

The MCP SDK (verified against the installed `@modelcontextprotocol/sdk` type definitions in `dist/esm/types.d.ts`): `CallToolRequestSchema`'s `params._meta.progressToken` is an optional string/number the client sets to opt into progress notifications for that specific call; `ProgressNotificationSchema`'s params are `{ progressToken, progress: number, total?: number, message?: string }`. The `Server.setRequestHandler` callback signature (verified in `dist/esm/server/index.d.ts` and `dist/esm/shared/protocol.d.ts`) is `(request, extra) => result`, where `extra.sendNotification(notification)` sends an out-of-band notification on the same connection. This server's current handler only uses the first parameter.

The `openai` SDK's `chat.completions.create({ stream: true })` (already the call this server's default path uses) returns an async-iterable stream of `ChatCompletionChunk` objects, each with `choices[0].delta.content` containing an incremental text fragment. **Note**: `delta.content` is frequently `undefined` — the first chunk typically carries only `delta.role` with no content, and the terminal chunk carries `finish_reason` with no content. A correct accumulator must treat `undefined`/missing `delta.content` as "no text to append this chunk," not concatenate the literal string `"undefined"`.

## Goals / Non-Goals

**Goals:**
- Give clients that opt in (via `progressToken`) live progress updates during a long-running plain-text reply.
- Keep the final tool result identical in shape to today — this is a UX addition, not a protocol/output change.
- Zero behavior change for clients that don't set a progress token.

**Non-Goals:**
- Not streaming the conversation-mode (Responses API), native-tools, multimodal, or structured-output paths — each has either a different event shape (Responses API SSE events are structurally different from chat-completion chunks) or enough additional combinatorial surface that scoping this change to the single simplest call is the right first cut. Revisit if streaming becomes valuable for those paths specifically.
- Not exposing any new tool argument — this is triggered purely by the MCP-protocol-level `_meta.progressToken`, which every MCP client already has a standard mechanism to set; no new schema surface needed.
- Not attempting to reconstruct token-level progress percentages (`total` is left unset, since total output length isn't knowable in advance) — `progress` is simply an incrementing chunk counter, and `message` carries the actual accumulated text, which is the useful part for a client UI.

## Decisions

**Decision: trigger streaming purely on `_meta.progressToken` presence, not a new tool argument or env var.**
This is exactly what the MCP protocol's progress mechanism is for — a client already signals interest in progress via this standard field. Adding a redundant tool-level flag would duplicate an existing, better-suited signal.

**Decision: scope to the single simplest call shape (plain `content`, no other feature argument), defined by reusing the EXACT SAME `isThreaded`/`hasTools`/`hasAttachments`/`responseSchema !== undefined` booleans the handler already computes for its existing guard chain — never re-derived independently.**
Combining streaming with conversation mode, tools, attachments, or structured outputs would require either building a second streaming code path per feature (Responses API's SSE event shape is different from Chat Completions' chunk shape) or writing a general-purpose streaming abstraction over both — real, non-trivial work with no evidence it's needed yet. "Plain" SHALL mean `!isThreaded && !hasTools && !hasAttachments && responseSchema === undefined`, using those existing variables directly. This automatically inherits the codebase's established empty-array convention (e.g. `tools: []` → `hasTools` is `false` → the call IS eligible for streaming, exactly as `tools: []` is already treated as "not really supplied" everywhere else in this file) rather than requiring this feature to make its own, possibly-divergent decision about what counts as "present." If any of these booleans is true alongside a `progressToken`, the server SHALL fall back to the existing non-streaming behavior for that path (not an error — the client still gets a valid reply, just without progress notifications for this call).

**Decision: `message` carries the full accumulated text so far on each notification, not just the incremental delta.**
A client rendering a live-updating view wants the current full state, not a diff it has to apply itself. This is a one-line difference in implementation (accumulate then send) and meaningfully simpler for any consumer.

**Decision: if the stream itself errors partway through, return the existing error-result shape (`isError: true`) with whatever text was accumulated discarded — do not attempt partial-result recovery.**
Consistent with how every other path in this server handles mid-call errors; a partial reply presented as if complete would be actively misleading.

## Risks / Trade-offs

- **[Risk]** Not every MCP client sets `_meta.progressToken`, so this feature is invisible unless a host application specifically wires it up. This is inherent to being an MCP-protocol-level opt-in mechanism, not a limitation of this implementation.
  → **Mitigation**: none needed — this is the correct, standard way for an MCP server to offer progress; it's not this server's job to work around clients that don't ask for it.
- **[Trade-off]** Streaming a Chat Completions call and accumulating deltas is marginally more code than issuing one request and reading `.choices[0].message.content` — accepted, since it's the whole point of the feature.
- **[Risk]** This server is deliberately generic (works against any OpenAI-SDK-compatible endpoint — Perplexity, Groq, local models, etc.), and not every such backend necessarily supports `stream: true` reliably or at all.
  → **Mitigation**: no code-level mitigation needed beyond the existing error handling — if a backend rejects or mishandles a streaming request, the resulting error surfaces through the same `toErrorResult` path as any other API error, same as it always has for unsupported features against a given backend. Worth a one-line README callout so this isn't a surprise.

## Migration Plan

Purely additive — no migration. A deployment where no client ever sets `_meta.progressToken` sees zero behavior change.

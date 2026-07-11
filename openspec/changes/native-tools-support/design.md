## Context

The Responses API (`openai@6.46.0`, verified by unpacking the npm tarball's type definitions in `resources/responses/responses.ts`) supports a `tools` array on `responses.create`. Three built-in tool types exist: `WebSearchTool` (`{ type: "web_search" }`, no required config), `Tool.CodeInterpreter` (`{ type: "code_interpreter", container: string | CodeInterpreter.CodeInterpreterToolAuto }`, where `CodeInterpreterToolAuto` is `{ type: "auto", ... }` — needs a container reference but this auto variant auto-provisions one), and `FileSearchTool` (`{ type: "file_search", vector_store_ids: string[] }`, hard-requires pre-existing vector store IDs this server has no way to create). **Note**: the SDK also defines an unrelated `ContainerAuto` shape (`{ type: "container_auto" }`) elsewhere in the same file, for a different container-creation context — do not confuse the two; the code_interpreter tool's auto container is specifically `Tool.CodeInterpreter.CodeInterpreterToolAuto`, literal `type: "auto"`, not `"container_auto"`.

This server already has a Responses API call path (from `conversations-api-support`/`responses-api-chaining`), currently only entered when `conversationId` or `previousResponseId` is present. This change extends that path to also trigger on a non-empty `tools` argument, independent of threading.

## Goals / Non-Goals

**Goals:**
- Let a caller enable `web_search` and/or `code_interpreter` on any `chat-with-{name}` call, threaded or not.
- Keep `code_interpreter` zero-config for the caller (auto container).
- Keep this strictly additive and consistent with the existing scope-boundary pattern (Chat-Completions-only features rejected in combination with Responses-API-only features).

**Non-Goals:**
- Not implementing `file_search` (see proposal's Impact section for the concrete reason: no vector-store-management capability exists in this server).
- Not exposing fine-grained tool configuration (e.g. `search_context_size`, filters, custom container file IDs) — the two supported tools ship with sensible defaults; configurability can be added later if a concrete need shows up (resist complexity until it hurts).
- Not implementing tool-call inspection/logging of what the model actually searched for or executed — the tool result is still just the final reply text, same as every other path in this server.

## Decisions

**Decision: `tools` triggers the Responses API path independent of `conversationId`/`previousResponseId`.**
Native tools are useful on a single one-off query (e.g. "what's the current exchange rate") just as much as within a conversation. Gating tool availability behind an existing conversation would be an arbitrary restriction with no technical justification — the Responses API accepts `tools` on any call, threaded or not.

**Decision: `tools` still requires `AI_CHAT_ENABLE_CONVERSATIONS=true`.**
This flag is this project's established gate for "any behavior that only works against real OpenAI's Responses API, not generic Chat-Completions-compatible backends." Native tools fit that exactly — reusing the existing flag avoids adding a second, redundant opt-in knob for the same underlying constraint.

**Decision: `code_interpreter` always uses `container: { type: "auto" }`.**
This is the zero-configuration option per the SDK's own type definitions; passing a specific container ID or pre-uploaded file IDs is a real feature but not one this server has any use for yet (it doesn't manage file uploads for this purpose).

**Decision: `tools` is rejected in combination with `images`, `files`, or `responseSchema`.**
Those three arguments only apply to the Chat Completions path built by earlier epics; forcing them to also work with `tools`-driven Responses calls would require re-deriving multimodal/structured-output handling against Responses API's different content-part and format types — explicitly out of scope, matching the same boundary already drawn by `multimodal-input` and `structured-outputs`.

**Decision: `tools`-triggered routing is tracked as a SEPARATE boolean from `isThreaded`, never merged, and the tools-vs-attachments guard is checked strictly BEFORE the pre-existing attachments-vs-threading guard.**
This is the one genuinely tricky part of this change, caught in Gate 1 review. The pre-existing code has `isThreaded = conversationId !== undefined || previousResponseId !== undefined` and a guard `hasAttachments && isThreaded` → "images/files are not supported together with conversationId/previousResponseId". If a caller supplies `tools` + `images` + `conversationId` all at once, TWO guards could plausibly fire: the pre-existing one (since `conversationId` makes `isThreaded` true) and a new tools-specific one. To make this deterministic:
1. `isThreaded` keeps its existing, narrow meaning: `conversationId !== undefined || previousResponseId !== undefined`. It is NOT widened to include `tools`. A separate `hasTools` boolean (`tools !== undefined && tools.length > 0`) is introduced for the tools-triggered-routing condition.
2. Guards are checked in this exact order (extending the baseline's existing mode-disabled → mutual-exclusion → routing sequence): (a) mode-disabled guard — fires if `conversationId`, `previousResponseId`, OR `tools` is present while `AI_CHAT_ENABLE_CONVERSATIONS` is off; (b) `conversationId`+`previousResponseId` mutual exclusion (pre-existing, unchanged); (c) `tools` value validation (each entry is `"web_search"`/`"code_interpreter"`); (d) **tools-vs-attachments conflict** (`hasTools && (hasAttachments || responseSchema !== undefined)`) — checked HERE, before (e); (e) attachments-vs-threading conflict (`hasAttachments && isThreaded`, pre-existing, unchanged, and by construction only reachable here if `hasTools` was false, since (d) already returned for any case where both are true); (f) routing: use Responses API if `isThreaded || hasTools`, else Chat Completions.
This ordering means `tools` + `images` + `conversationId` always reports the tools-specific error, deterministically, and the pre-existing `images`+`conversationId` (no `tools`) case is provably unaffected since guard (d) can't fire without `hasTools` being true.

## Risks / Trade-offs

- **[Risk]** `web_search` and `code_interpreter` consume additional OpenAI-side compute/tokens and may increase latency and cost per call versus a plain chat completion. This is inherent to the feature (that's what the tools do) and is the caller's choice to opt into via `tools`.
  → **Mitigation**: documented plainly in the README; no code-level mitigation needed since this is expected, not a bug.
- **[Trade-off]** No fine-grained tool configuration in this version (see Non-Goals). Accepted; can be added incrementally if needed.

## Migration Plan

Purely additive — no migration. A deployment that never sets `tools` sees no behavior change.

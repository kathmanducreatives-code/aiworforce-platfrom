
# Agentory Chat → AI Employee Command Center

Two-phase upgrade: (1) fix the chat composer/workspace glitches at the root, (2) give Pilot a real workflow brain powered by Lovable AI Gateway that knows what Agentory can do, what tools are configured, and what to do next — without any production-DB or auto-send changes.

Guardrails respected end-to-end: no migrations (including 145631), no auto-send/DM/comment/post/email, all outbound stays draft-only and approval-gated, landing page untouched.

---

## Phase 1 — Composer & workspace stability (root causes)

Findings from auditing `ChatComposerPro.tsx`, `ChatView.tsx`, `ChatWorkspaceContext.tsx`, `ChatWorkspace.tsx`, `chatActions.ts`:

1. `setComposerFocused(true)` calls `setHistoryOpen(false)` on every focus — combined with the focus-flip side effects, this causes the sidebar to collapse and the chat column to re-layout while typing begins, producing the perceived "jump".
2. The textarea's `onSelect` runs `detectPopup` on every keystroke (selection moves with each char), triggering popup state churn and re-renders that fight the controlled input.
3. The autosize effect runs synchronously on every `value` change without `requestAnimationFrame`, causing height thrash on fast typing and paste.
4. `chat:send` / `chat:prefill` window listeners are registered with an empty dep array but read `submit`/`workspaceId` from closure — stale closures + double registration in StrictMode can drop or duplicate sends.
5. `ChatView` likely re-keys/remounts on `workbenchOpen`/`historyOpen` changes via parent layout; composer state survives only because it's not under that subtree, but suggestion popups and typing indicators do remount.
6. `setPending` is called before `setValue('')`, and the realtime subscription may echo the user message before pending clears → brief duplicate bubble flash.
7. No IME composition guard on Enter → kana/pinyin/etc. send half-composed text.

Fixes:
- Stop coupling focus to history. Move "collapse history on first focus" to a one-shot triggered by the first non-empty keystroke after focus, not by `onFocus` itself; gate it behind a ref so it never fires twice for the same focus session.
- Replace `onSelect`-driven popup detection with an `onChange`+caret check, and only run `detectPopup` when the last typed char is `@`, `#`, `/`, or while a popup is already open.
- Wrap autosize in `requestAnimationFrame` and bail when `scrollHeight` hasn't changed; clamp once on paste via a `useLayoutEffect`.
- Convert the `chat:send` / `chat:prefill` listeners to use a ref-backed `submitRef.current(...)` so the handler identity is stable and StrictMode double-mount is safe.
- Add IME guard: track `onCompositionStart/End` and ignore Enter while composing.
- Order optimistic state correctly: `setValue('')` → `setPending(...)` → fire request; on realtime echo, dedupe pending by `(conversation_id, client_msg_id)`.
- Add `React.memo` + stable keys to `MessageList`, agent typing indicators, and Workbench panel so opening/closing Workbench or history never remounts the composer subtree.
- Workspace context: split `workbenchOpen`/`historyOpen`/`composerFocused` into separate contexts (or selectors) so composer doesn't re-render when those toggle.

Acceptance for Phase 1:
- Fast typing, long paste, multiline, backspace, IME input: no flicker, no lost chars, no focus loss.
- Toggling history or Workbench mid-typing does not reset input or move the caret.
- Agent typing indicator appears/disappears without shifting composer.
- Send clears input only after request resolves; failure restores text into composer.

---

## Phase 2 — Workflow brain (Pilot)

### 2a. Workflow Capability Registry
New `src/lib/workflows/capabilities.ts` exporting a typed `WORKFLOW_CAPABILITIES: WorkflowCapability[]` covering the full list in the brief (GTM/lead, market/competitor, content, ops/intelligence, product). Each entry: id, owning agent, tool(s), required/optional context, example prompts, output kind (workbench panel), `safety_level`, `enabled`, `fallback`.

### 2b. Tool Availability Registry
New `src/lib/workflows/tools.ts` + a thin edge function `tool-availability` that returns the runtime-configured state of: Lovable AI/Gemini, Claude (if key present), Apify jobs/people/posts/comments actors (via env flags already in secrets — e.g. `APIFY_ENABLE_PEOPLE_SEARCH`), Firecrawl, Resend (drafts only), Supabase storage, CSV export. Each tool reports `enabled`, `configured`, `reason_if_unavailable`, `fallback_workflow`. Cached client-side per session.

### 2c. Smart router (`pilot-chat` upgrade)
Replace the current ad-hoc routing in `supabase/functions/pilot-chat` with a two-pass design:

1. Deterministic pre-checks: safety refusals (auto-send patterns), structured card actions (already carry `action_source`), continuation of an active workbench artifact, slash commands.
2. LLM intent classification via Lovable AI Gateway (`google/gemini-3-flash-preview`) using the capability + tool registries as the schema. Returns the `WorkflowRoutingDecision` shape from the brief. Use AI SDK `Output.object` with a small Zod schema; keep enum of workflow IDs short to avoid Gemini's structured-output limit.
3. Post-checks: enforce `safety_decision`, downgrade to `draft_only` when applicable, force `should_run=false` when required tool is disabled and surface fallback.

Priority order matches the brief (safety → card actions → artifact ops → new intent → memory → general Q&A).

### 2d. Context loader
Before routing, `pilot-chat` loads: Company Brain profile, last N messages, latest workbench artifact for the conversation, available tools. This object is passed into the classifier prompt so Pilot can default to ICP, reuse known competitors, etc., and ask at most one focused clarification (or open a structured form card when many fields are missing).

### 2e. Execution planner
New `src/lib/workflows/planner.ts` (server-mirrored in `_shared/planner.ts`) maps a `workflow_id` → ordered steps with prechecks, agents, tools, success criteria, fallback. `run-agent` consumes this plan instead of per-workflow branches.

### 2f. Self-check / verification
After each step, planner records: tool actually invoked, output count vs requested, status (`complete | partial | failed`), and whether any unsafe action was attempted. Status surfaces honestly in the workbench panel and chat. No LLM-fabricated "done" when the underlying tool errored or is disabled.

### 2g. Typing/working indicators
Wire the existing `AgentTypingIndicator` to the planner's `step_id`/`agent_id` stream so the right agent (Pilot → Scout → Aria → Hawk → Penn → Scribe) appears at the right moment, keyed by `(conversation_id, plan_id, step_id)` so they never duplicate or shift layout.

### 2h. General Q&A mode
When `intent = qa`, Pilot answers from the capability registry + current context, never invoking Apify/Firecrawl. "What can you do?", "Why did this fail?", "What does Scout do?" become first-class.

### 2i. Safety
Hard-refuse list enforced in router AND in `run-agent` (defense in depth): no auto-DM/email/comment/post/send, no fabricated contacts/emails, disabled tools never silently "succeed".

---

## Files to add / change

Add:
- `src/lib/workflows/capabilities.ts`, `tools.ts`, `planner.ts`, `router.ts` (client types + helpers)
- `src/lib/workflows/useToolAvailability.ts` (cached hook)
- `supabase/functions/_shared/workflows/{capabilities,tools,planner,router,safety}.ts`
- `supabase/functions/tool-availability/index.ts` (read-only env probe)
- Tests under `src/lib/workflows/__tests__/` and `src/components/chat/workspace/__tests__/`

Change:
- `src/components/chat/workspace/ChatComposerPro.tsx` — focus/popup/autosize/IME/listener fixes
- `src/contexts/ChatWorkspaceContext.tsx` — decouple focus from history; split context
- `src/components/chat/workspace/ChatView.tsx` + `ChatWorkspace.tsx` — memoization, stable keys
- `src/lib/chatActions.ts` — pending/echo dedupe, client_msg_id
- `supabase/functions/pilot-chat/index.ts` — two-pass router + context loader (Lovable AI Gateway)
- `supabase/functions/run-agent/index.ts` — execute via planner + self-check
- `supabase/functions/orchestrate/index.ts` — emit step events for typing indicators

Do NOT touch: landing page, any DB migration, production tables, auth schema.

---

## Tests (Vitest + manual QA)

Composer: typing-doesn't-reset across history/Workbench toggles, IME safe, paste long, multiline, send-clears-only-on-success, prefill/send events fire once.

Router: hiring search, founder/profile (or honest fallback when people actor off), competitor engagement, content draft, outreach draft (blocks if no contacts), refuses auto-send, uses Company Brain defaults, single focused clarification, save-only doesn't catch new sourcing, memory-refine doesn't catch new workflow, failed tool stays failed, partial stays partial, Workbench opens correct artifact, disabled tool shows honest fallback, general Q&A doesn't run tools.

Browser QA script per the brief's section 15.

---

## Out of scope (per your rules)
- No DB migrations, including 145631.
- No production data changes.
- No auto-send/DM/comment/post/email anywhere; all outbound stays draft + approval.
- No landing page edits.

## Final report (delivered after build)
Root cause of typing glitches, files changed, registry contents, router behavior matrix, planner self-check examples, fallback matrix, safety matrix, test results, `tsc`/Deno/build results, browser QA results, remaining gaps.

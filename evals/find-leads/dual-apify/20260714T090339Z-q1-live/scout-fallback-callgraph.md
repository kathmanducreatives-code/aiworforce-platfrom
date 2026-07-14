# Scout-fallback failure — exact live call graph (plan c0f0d7eb)

## Path taken (unsafe)
```
Find Leads request (execution_mode=source_and_qualify_only, tool_input={execution_mode,max_results:5})
 → orchestrate/index.ts
     • AI planner builds steps: [scout(source_with_apify), aria(extract_structured)] (Penn stripped by filterPlanForMode ✓)
     • persists task_plan (status "executing")
     • fire-and-forget POST run-agent with body:
         tool_needed = firstStep.tool_needed = "source_with_apify"        (index.ts:1211)
         tool_input  = firstStep.metadata?.tool_input ?? tool_input        (index.ts:1214)
                     = {execution_mode:"source_and_qualify_only", max_results:5}   ← NO tool_name / selected_actor_key
 → run-agent/index.ts (step 0, agent scout)
     • tool_input_body = body.tool_input                                    (index.ts:90)   ← body.tool_needed is NEVER read
     • planned_tool_name   = tool_input_body?.tool_name       = undefined   (index.ts:305)
     • planned_actor_key   = tool_input_body?.selected_actor_key = undefined(index.ts:304)
     • isApifySelected = (undefined==="source_with_apify") || undefined.startsWith("apify_") = FALSE   (index.ts:309-311)
     • shouldUseApify  = !firecrawl && ( isApifySelected || (!tool_input_body && sourcingRe) )
                       = !false && ( false || (false && …) ) = FALSE       (index.ts:312-315)
         └─ tool_input_body EXISTS ⇒ legacy instruction-regex path also skipped
     • ⇒ ENTIRE Apify block (index.ts:317-1463) SKIPPED:
            – no provider actor call (source_with_apify never invoked)
            – providerIndexForHandoff stays null (built only at index.ts:960)
            – sourcingFailure / zeroAcceptedSourcing stay false
     • terminals at 1469 (sourcingFailure) and 1507 (zeroAcceptedSourcing) DO NOT fire (both guards false)
     • research_web attempted (perplexity) → tool_failed (not configured)   (index.ts:1449-1461)
     • generic generateText(...) runs → GEMINI FABRICATES 10 founders       (index.ts:1639)  ← fabrication point
     • Scout→Aria handoff guard SKIPPED: condition requires providerIndexForHandoff (null) (index.ts:1758)
         └─ handoffInput = apiText (raw fabricated prose)                    (index.ts:1757)
     • chains to Aria with fabricated candidates                            (index.ts:1850-1891)
 → run-agent (step 1, agent aria) generic generateText ranks the 10 fabricated founders → top_3
     • plan finalized "complete" (generic completion, not no_results)        (index.ts:1896)
```

## Why each thing happened
- **source_with_apify never invoked / provider considered unavailable:** `shouldUseApify=false` because the gate keys off `tool_input.tool_name`/`selected_actor_key`, which the AI-planned `tool_input` lacks; `body.tool_needed="source_with_apify"` is passed by orchestrate but **never read** by run-agent.
- **generic LLM fallback selected:** control fell through the skipped Apify block to the generic `generateText` at index.ts:1639.
- **fabricated Scout response created:** that generic Gemini call.
- **which Scout output became Aria input:** `handoffInput = apiText` (raw fabricated prose) at index.ts:1757.
- **guardScoutToAria did not run:** its call site (index.ts:1758) is gated on `providerIndexForHandoff`, which is only built inside the skipped Apify block.
- **zeroAcceptedSourcing did not run:** the variable is only set inside the skipped Apify block; the 1507 terminal never triggered.
- **plan finalized complete / no_results not persisted:** the honest no_results terminals live inside/after the Apify path; the generic path marks the step complete.

## Fix strategy
1. **Route (Fix 1):** read `body.tool_needed` and include `tool_needed==="source_with_apify"` in `isApifySelected` so provider-sourcing steps enter the Apify path (real sourcing when configured).
2. **Fail-closed gate (Fix 2):** immediately after the Apify block, if the step `isFindLeadsProviderSourcingStep` and produced no provider context (`!apifyContext && !sourcingFailure`), set `zeroAcceptedSourcing=true` + a structured `providerSourceReason`, so the **existing** no_results terminal (index.ts:1507) fires — the generic LLM at 1639 is never reached.
3. **Global handoff gate (Fix 3):** run `guardScoutToAria` for every Find Leads sourcing Scout→Aria handoff (null index ⇒ shouldStop) — never pass raw Scout prose to Aria.

All three reuse existing guards (`guardScoutToAria`, `buildNoResults`, the 1507 terminal); none weaken them.

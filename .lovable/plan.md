# Fix: Activate Company Brain — Edge Function 400 unknown_action

## Root cause

`supabase/functions/setup-company-brain/index.ts` is missing the closing `}` for the `save_structured` handler (opened line 76, returns at line 93, but never closes before `if (action === "save_sources")` at line 95).

Because of the missing brace, every subsequent `if` branch (`save_sources`, `analyze`, `generate_followups`, `save_followups`, `finalize`) and the final `return json({ error: "unknown_action" })` are syntactically nested inside the `save_structured` block. The previous deploy of the function did not include `save_structured` at all, so calls now fall through to `unknown_action`.

## Fix

Single one-line edit to `supabase/functions/setup-company-brain/index.ts`:

Insert a closing `}` after line 93 (the `return json({ ok: true, profile: merged });` inside the `save_structured` branch) and before the blank line/`if (action === "save_sources")`.

```text
      if (error) throw error;
      return json({ ok: true, profile: merged });
    }                                  // ← add this closing brace

    if (action === "save_sources") {
```

No other code, schema, frontend, or config changes. After redeploy, the Activate flow will hit the real `save_structured` branch, persist the structured patch, then call `finalize`.

## Validation

- Typecheck (`bunx tsc --noEmit` — frontend) still passes (unaffected).
- Manually re-run "Activate Company Brain" from `/onboarding/company-brain` Review step; expect 200 and redirect, no toast error.
- Check `setup-company-brain` edge logs for a clean `save_structured` → `finalize` sequence.

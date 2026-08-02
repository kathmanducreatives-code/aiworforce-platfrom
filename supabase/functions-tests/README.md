# Edge function tests

These Deno tests live **outside** `supabase/functions/` on purpose.

Supabase uploads every file under `supabase/functions/` with each function, and the
bundle is capped at ~5 MB. The `_shared` test suite is ~2.5 MB, which pushed
`run-agent` (and every other function) over that cap and broke publishing.

Run them with:

```bash
deno test supabase/functions-tests/_shared/
```

Imports point back at the real source via `../../functions/...` — keep new tests
here rather than next to the modules they cover.

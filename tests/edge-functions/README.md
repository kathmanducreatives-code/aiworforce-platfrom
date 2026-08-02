# Edge function tests

These Deno tests live **outside the entire `supabase/` upload root** on purpose.

The publisher uploads the backend source tree when deploying a function, and the
bundle is capped at ~5 MB. The `_shared` test suite is ~2.5 MB, which pushed
`run-agent` over that cap even when the tests were only moved to
`supabase/functions-tests/`.

Run them with:

```bash
deno test tests/edge-functions/_shared/
```

Imports point back at the real source via `../../supabase/functions/...` — keep
new tests here rather than anywhere under `supabase/`.

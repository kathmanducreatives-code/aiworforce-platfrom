

## Fix: Screening Link Generation Fails Due to n8n Webhook Error

### Root Cause
The `generate-screening-invite` edge function calls an external n8n webhook (line 426) **before** creating the screening session in the database (line 478). When the webhook returns a 500 error (as seen in the logs: "Validation failed [line 35]"), the function immediately returns a 502 error to the frontend (lines 438-445) and **never reaches the session creation code**. No session is created, no URL is generated.

The n8n webhook is a secondary integration (for syncing/notifications) and should not block the core functionality of generating a screening link.

### Solution
Make the n8n webhook call **non-blocking**. Instead of returning an error response when the webhook fails, log the failure as a warning and continue to create the session and return the screening URL.

### Change

**File: `supabase/functions/generate-screening-invite/index.ts`**

Lines 435-470 -- Replace the fatal error handling for the webhook with a warning-only approach:

- When the webhook returns a non-OK status: log the error but **do not return** a 502 response. Continue execution.
- When the webhook times out: log the timeout but **do not return** a 504 response. Continue execution.
- When a network error occurs: log the error but **do not return** a 503 response. Continue execution.

The three `return new Response(...)` statements inside the webhook error handlers (lines 438-445, 455-459, 463-469) will be removed and replaced with `console.warn(...)` calls, allowing the function to fall through to session creation.

### Before (simplified)

```text
webhook call
  if (!ok) -> return 502   <-- BLOCKS everything
  if (timeout) -> return 504
  if (network) -> return 503

create session   <-- NEVER REACHED
return screening_url
```

### After (simplified)

```text
webhook call
  if (!ok) -> console.warn("webhook failed, continuing")
  if (timeout) -> console.warn("webhook timed out, continuing")
  if (network) -> console.warn("webhook error, continuing")

create session   <-- ALWAYS REACHED
return screening_url
```

### Technical Details

| File | Lines | Change |
|------|-------|--------|
| `supabase/functions/generate-screening-invite/index.ts` | 435-469 | Remove three `return new Response(...)` error returns inside webhook error handlers; replace with `console.warn()` so execution continues to session creation |

No frontend changes needed. No database changes needed.


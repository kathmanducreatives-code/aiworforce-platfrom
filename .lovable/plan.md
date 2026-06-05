# Make agentory.space load reliably

Most of this is configuration (publishing, DNS at your registrar, Supabase Auth URLs) — not code. The app already has SPA fallback (Lovable hosting handles it automatically), an `AppErrorBoundary`, and edge functions deployed to backend `wqnigjhcwjxtmordrwno`. We'll only touch code where something is genuinely missing.

## 1. Publish the latest build (you do this once)

Frontend changes only go live on `agentory.space` and the `.lovable.app` URL when you click **Publish → Update** in the top-right of the editor. Edge functions deploy automatically, but the frontend does not. Most "the domain doesn't load the latest" reports are this.

After publishing I'll verify:
- hosted `https://resume-ace-ai-29.lovable.app/` loads
- `/dashboard` loads and survives refresh (Lovable hosting has built-in SPA fallback — no `_redirects` file needed or used)

## 2. Connect agentory.space (DNS at your registrar)

In **Project Settings → Domains**, `agentory.space` must be added with both apex and `www` entries. At your registrar add exactly:

```text
Type:  A
Name:  @
Value: 185.158.133.1
TTL:   3600

Type:  A
Name:  www
Value: 185.158.133.1
TTL:   3600

Type:  TXT
Name:  _lovable
Value: <the lovable_verify=... string shown in the Lovable Domains panel>
TTL:   3600
```

The TXT value is unique per project — copy it from the Domains panel; I cannot guess it. If you use Cloudflare proxy, toggle "Domain uses Cloudflare or a similar proxy" in the Connect Domain dialog (switches to CNAME verification).

Remove any old A/CNAME records for `@` or `www` pointing elsewhere. SSL is auto-issued by Lovable once DNS verifies (can take up to 72h, usually minutes).

## 3. Supabase Auth URLs (Lovable Cloud → Users → Auth Settings)

Add to **Site URL** / **Additional Redirect URLs**:

- `https://agentory.space`
- `https://agentory.space/*`
- `https://www.agentory.space`
- `https://www.agentory.space/*`
- keep the existing `https://resume-ace-ai-29.lovable.app/*` and preview URL

Without these, signup/login email links and OAuth callbacks redirect to the wrong origin and the app appears "broken" only on the custom domain.

## 4. Edge function CORS

All edge functions in this project use `Access-Control-Allow-Origin: *` via the shared CORS helper, so `agentory.space` is already allowed. I'll spot-check `pilot-chat`, `orchestrate`, `run-agent`, `daily-brief`, `setup-company-brain`, `approve-and-continue` after publish and only patch if a function is missing the shared headers.

## 5. Small code hardening (only change in this plan)

Add a top-level `RouteErrorBoundary` wrapper around `<Routes>` in `src/App.tsx` so a single route crash (e.g. a null `metadata` in `ExecutionPlanCard`) shows the existing fallback instead of a blank screen on production. `RouteErrorBoundary` already exists; it's just not mounted. No behavior, layout, or feature changes.

## 6. Smoke tests after publish + DNS green

I'll run from `https://agentory.space`:
- `/` loads, `/dashboard` direct-load + refresh, `/auth`, `/onboarding/company-brain`
- sign in flow + redirect
- Pilot: "hello", "Brief me on today", "Find companies hiring marketing roles in London", "Hawk, scrape https://stripe.com/jobs ..."
- capture any console / network errors and fix in-app issues only (no infra changes beyond what's above)

## What I need from you before I can finish

1. Click **Publish → Update** so the latest frontend goes live.
2. Confirm `agentory.space` is added in Project Settings → Domains, and paste the exact TXT value Lovable shows so you can add it at your registrar (or confirm it's already there).
3. Confirm whether the domain registrar is Cloudflare (proxy mode changes the records).

Once published and DNS is added, I'll run the smoke tests and report status per Step 8 of your checklist.

## Out of scope (explicitly preserved)

No redesign; no backend project change; no DB reset; RLS untouched; Pilot, ChatWorkspace, onboarding, Company Brain, Daily Brief, Execution Plan Cards, Apify, Firecrawl, toolRegistry, orchestrate, run-agent, approvals all remain.

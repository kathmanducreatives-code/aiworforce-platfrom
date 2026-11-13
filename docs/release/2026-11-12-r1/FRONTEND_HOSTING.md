# Frontend hosting without Lovable: Cloudflare Pages (preferred) or Vercel

**Status:** prepared and verified locally (Cloudflare's Pages emulator plus a headless browser). **Not deployed anywhere yet.** The Lovable site at `agentory.space` is untouched.

## 1. Build

| | Value |
|---|---|
| Install | `npm ci` |
| Build command | `npm run build` (Vite) |
| Output directory | `dist` |
| Node | 20 or newer (CI uses `actions/setup-node`) |
| SPA fallback | `public/_redirects` (`/* /index.html 200`), for Cloudflare Pages and Netlify; `vercel.json` `rewrites` for Vercel. Real files, `/assets/*` included, are never rewritten. |
| Security headers | `public/_headers` (Cloudflare and Netlify) or `vercel.json` `headers` (Vercel), the same CSP in both |
| Version stamp | `/version.json` carries the commit SHA, read from `CF_PAGES_COMMIT_SHA`, `VERCEL_GIT_COMMIT_SHA`, `COMMIT_REF` or git |
| Pre-deploy gate | `npm run verify:frontend-build`. It refuses a build that names any Supabase project but `ohsdatpvfdjdemstoiuj`, references the retired Lovable-era projects (`wqnig…`, `zbws…`, `luvost…`), contains a non-anon or other-project JWT or any `sb_secret_` key, lacks the fallback, headers, version file or boot script, or keeps inline scripts. |

## 2. Environment variables (production and preview)

**Set these, and nothing else is required:**

| Name | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://ohsdatpvfdjdemstoiuj.supabase.co` | Production project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `ohsdat…`'s anon (legacy) key, or its `sb_publishable_…` key | Public by design: it ships in the bundle. The build also defaults to these exact values if unset (`src/integrations/supabase/productionTarget.ts`). |

**Never set any of the following** (the build refuses some of them outright):
- **Any service-role or `sb_secret_` key.** `vite.config.ts` refuses to start if one appears in a `VITE_` variable.
- **`VITE_TEST_DASHBOARD_WITHOUT_BRAIN` and the Company Brain read-only mode.** Both are ref-locked to the TEST project `tlvnfrxzjhsjgdofwehb`, so they are inert in a production build even if set.
- **`VITE_CLIENT_BRAINS` and `VITE_WORKFORCE_DASHBOARD_ENABLED`.** Leave them unset (off).

## 3. Supabase Auth URL configuration (owner, in the Supabase dashboard)

Go to Supabase → project `ohsdatpvfdjdemstoiuj` → **Authentication → URL Configuration**.

- **Site URL:** keep it as is until cutover, then `https://agentory.space`.
- **Redirect URLs:** add the following. They are used by sign-up confirmation and password-reset emails (`window.location.origin`). Email and password sign-in itself needs none of them.
  - `https://agentory-web.pages.dev/**`
  - `https://*.agentory-web.pages.dev/**` (preview branches)
  - `https://agentory.space/**`
  - (Vercel instead: `https://<project>.vercel.app/**`)

**CORS:** every edge function answers `Access-Control-Allow-Origin: *`, and Supabase's REST and Auth APIs accept any origin with the publishable key. Verified from a preview origin: the sign-in call reached `ohsdat…/auth/v1/token` (400 for a wrong password, with no CORS or CSP error).

## 4. Preview deployment (does not touch agentory.space)

### Cloudflare Pages (preferred for previews)

**One-time setup**, either way:
- **Dashboard:** Workers & Pages → Create → Pages → **Connect to Git** → this repository. Production branch `launch/hardening`; build `npm run build`; output `dist`; set the §2 variables.
- **From a shell:**
  ```bash
  npx wrangler pages project create agentory-web --production-branch launch/hardening
  ```

**Deploy a preview:**
```bash
npm ci && npm run build && npm run verify:frontend-build
```
```bash
npx wrangler pages deploy dist --project-name agentory-web --branch preview
```
The preview URL is `https://preview.agentory-web.pages.dev`; production is `https://agentory-web.pages.dev`. Neither is your domain.

### Vercel (alternative)

Import the repository; `vercel.json` sets build, output, rewrites and headers. Add the §2 variables.
```bash
npx vercel deploy
```
That gives a preview URL; `--prod` deploys to the `*.vercel.app` production alias.

**Acceptance on the preview, before any DNS change:**
1. `curl -s https://<preview>/version.json` shows the expected commit.
2. Sign in with your `ohsdat…` account.
3. Company Brain loads, edits and persists (PRODUCTION_TEST_PLAN P2–P6).
4. ORION answers (P7–P11).
5. No CSP errors appear in the browser console.

## 5. Connecting agentory.space (only after the preview passes, and with your approval)

**Current DNS** (read 2026-11-13; this is your rollback record):

| Record | Value |
|---|---|
| Nameservers | `solar.dns-parking.com`, `lunar.dns-parking.com` (**Hostinger**) |
| `agentory.space` A | `185.158.133.1` (Lovable), TTL 14400 |
| `www.agentory.space` | CNAME → `agentory.space`; HTTPS on `www` currently fails (not configured at Lovable) |
| MX | `10 mx2.hostinger.com`, `5 mx1.hostinger.com` (**email; must be kept**) |
| TXT | `v=spf1 include:_spf.mail.hostinger.com ~all` (**keep**) |

**Which host suits the bare domain:**
- **Vercel:** works with DNS staying at Hostinger. Change one A record.
- **Cloudflare Pages:** an apex custom domain needs the **zone on Cloudflare** (change nameservers at Hostinger to Cloudflare's). Re-create the MX and TXT records there exactly, or email stops. `www` alone could be a CNAME at Hostinger to `agentory-web.pages.dev`.

### Option A: Vercel, DNS stays at Hostinger (least disruption)

1. In Vercel → Project → Domains, add `agentory.space` and `www.agentory.space`. Vercel shows the exact target.
2. At Hostinger DNS:
   - apex `A` → **`76.76.21.21`** (Vercel's apex IP; use what Vercel displays if it differs);
   - `www` stays a CNAME → `agentory.space`, or set it to `cname.vercel-dns.com`.
3. **Leave MX and TXT untouched.** Lower the A record's TTL to 300 a day before, to speed up rollback.

### Option B: Cloudflare Pages with the zone moved to Cloudflare

1. Add the site `agentory.space` to Cloudflare, which imports the records.
2. **Verify** the MX, the SPF TXT and any other records exist there.
3. Change the nameservers at Hostinger to the two Cloudflare gives you.
4. In Pages → `agentory-web` → Custom domains, add `agentory.space` (and `www`).

## 6. Rollback (restores the Lovable site)

| Option | Steps |
|---|---|
| A (Vercel) | At Hostinger set apex `A` back to **`185.158.133.1`**, and `www` back to CNAME → `agentory.space`. Remove the domain in Vercel. Propagation follows the TTL (that's why it should be lowered to 300 in advance). |
| B (Cloudflare) | At Hostinger set the nameservers back to `solar.dns-parking.com` and `lunar.dns-parking.com`. The original records, including A `185.158.133.1`, remain in Hostinger's zone. |

**The Lovable deployment itself is never modified,** so it serves again as soon as DNS points back at it.

## 7. Verified locally (2026-11-13)

- **Production build:** `npm run build` succeeds, and `verify:frontend-build` passes with exactly one Supabase project, `ohsdatpvfdjdemstoiuj`.
- **The verifier refuses bad builds:** a TEST-pointed build, and the current live Lovable bundle (`wqnig…` and `zbws…`).
- **Cloudflare's Pages emulator** (`wrangler pages dev`) applies `_redirects` and `_headers`:
  - `/dashboard`, `/company-brain` and `/leads` return the app with a 200;
  - the CSP, X-Frame-Options, HSTS and Referrer-Policy headers are present.
- **Headless Chromium on that preview:**
  - `/` renders; `/auth` shows the sign-in form; `/dashboard` while signed out redirects to `/auth`;
  - **0 CSP violations, 0 console errors**, no environment badge (production);
  - before sign-in, only Google Fonts is contacted;
  - a deliberate wrong-password sign-in reached `ohsdatpvfdjdemstoiuj` Auth (400).

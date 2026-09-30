# agentory.space publishing plan

Status: PLAN. Nothing is published and no DNS or hosting setting has been changed. Every step marked **[approve]** needs an explicit go.

Prepared 2026-09-30 from read-only checks.

## What is true today

| Fact | Evidence |
|---|---|
| agentory.space and www are served by **Lovable**. Cloudflare in the headers is Lovable's CDN. | A `185.158.133.1` (Lovable edge), `x-deployment-id` header; www CNAME → apex |
| DNS is at **Hostinger**. The domain has **no MX/TXT records**, so no email is at risk. | NS `lunar/solar.dns-parking.com`; SOA `dns.hostinger.com` |
| The live bundle talks to Supabase **`wqnigjhcwjxtmordrwno`**, the old Lovable-Cloud backend. That is neither production `ohsdatpvfdjdemstoiuj` nor any project in our Supabase account. | the App chunk hard-codes the wqnig URL |
| Lovable's build **injects** its Cloud project's URL at build time, so *any* Lovable publish keeps pointing at wqnig. | compiled `resolveSupabaseUrl` returns the injected wqnig URL |
| The Lovable-synced repo (`remix-of-remix-of-screeningpilot`, `main`) has 11 bot commits from 2026-09-26 that rewrote run-agent, pilot-chat and orchestrate ("Fixed overly large edge funcs"). They are not in the release, and must never be merged into it. | `git log origin/launch/hardening..remix/main` |
| **Netlify** site `teal-chimera-be7c79` already builds this frontend. It builds `feat/lead-mission-v2-worker`, which carries the dashboard/Jev WIP, and it sits behind team protection. | memory, and curl 401 → Netlify edge-access |
| The release frontend (`launch/hardening`) ships `/version.json` (Netlify `COMMIT_REF`) and the SPA fallback `public/_redirects`. Canonical/OG/sitemap already say agentory.space. | vite.config.ts, public/ |
| Edge functions answer CORS with `*`, so a new origin needs no function change. | OPTIONS with Origin agentory.space |
| Sign-up confirmation and password-reset links use `window.location.origin`, so production Supabase Auth must allow `https://agentory.space`. | src/pages/Auth.tsx |
| **Bug:** `src/integrations/supabase/client.ts` defaults to the production URL but carries **wqnig's anon key**. A build without `VITE_SUPABASE_PUBLISHABLE_KEY` cannot sign anyone in. | the key's JWT `ref` is wqnig |

## Recommendation

Serve agentory.space from **Netlify, built from `launch/hardening`**, and retire Lovable as the host.

Why not Lovable:
- It injects the old backend at build time.
- Its repo carries unreviewed bot rewrites of the core functions.
- It cannot be pinned to a reviewed SHA.

Netlify already builds this exact app, stamps `/version.json`, and handles the SPA routes.

## Steps

**0. Decide [approve]**
- a. Hosting: Netlify, as recommended.
- b. **Accounts on the old site.** Anyone who signed up at agentory.space exists only in wqnig, which we cannot reach. After the cutover they would need to sign up again.
  - Check the user count in Lovable → Cloud → Users before deciding.
  - If there are real users, plan a notice or a manual invite.
- c. The cutover window.

**1. Fix the client default (code, a small PR into launch/hardening) [approve merge]**
- Replace the default publishable key with production's publishable key. It is public by design.
- Add a unit test that the default URL's project ref equals the default key's `ref`, so the mismatch cannot return.
- Add a build-time guard: a production build fails if the URL and key refs differ.
- Merging moves launch/hardening, so Railway redeploys the worker. Its code is unchanged by this PR.

**2. Netlify settings (your clicks: I have no Netlify access)**
- Production branch → `launch/hardening`.
- Turn on **"Stop auto publishing"**, so a merge builds a deploy but does not publish it until you publish that exact deploy.
- Environment variables (Production context):
  - `VITE_SUPABASE_URL=https://ohsdatpvfdjdemstoiuj.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY=<production publishable key>`
  - `VITE_SUPABASE_PROJECT_ID=ohsdatpvfdjdemstoiuj`
- Build: `npm run build`, publish dir `dist`, Node as in CI.
- Trigger a deploy of the release commit, then check `/version.json` on the netlify.app URL shows that SHA (while it is still protected).

**3. Production Supabase Auth URLs [approve]**
- Site URL: `https://agentory.space`.
- Redirect URLs: add `https://agentory.space/**` and `https://www.agentory.space/**`. Keep localhost for dev and the netlify.app URL during the transition.

**4. Pre-cutover smoke on the netlify.app URL ($0, no Start clicked)**
- Sign in, then load the dashboard.
- Pilot compiles a mission card. Do not click Start.
- The Workbench opens.
- The bundle references only `ohsdatpvfdjdemstoiuj` (grep the assets).

**5. Cutover [approve]**
- a. The day before: lower the TTL on the Hostinger A and www records to 300 s.
- b. In Netlify, add the custom domains `agentory.space` (primary) and `www` (redirects to the apex). Netlify shows the exact DNS targets.
- c. At Hostinger:
  - Change the apex A record `185.158.133.1` → Netlify's load-balancer address (the value Netlify shows).
  - Change `www` to a CNAME → `teal-chimera-be7c79.netlify.app`.
- d. Wait for Netlify's TLS certificate.
- e. Turn off Netlify team protection for the production site. It is site-wide today, and the public site cannot sit behind it.
- f. Leave agentory.space attached in Lovable until step 6 passes. That is the rollback.

**6. Verify**
- `https://agentory.space/version.json` equals the release SHA.
- www redirects to the apex.
- A sign-up confirmation link returns to agentory.space.
- Sign-in works.
- The bundle has no `wqnig` or `zbws` references.
- Ops health is OK.
- Update `production-shas.sh` with `AGENTORY_SITE_URL=https://agentory.space`, so the frontend joins the SHA report.

**7. Retire Lovable hosting (about 24 h later) [approve]**
- Remove the custom domain from the Lovable project and unpublish it.
- Stop syncing that repo into any release branch.

## Rollback

- Before step 7: set the Hostinger A record back to `185.158.133.1` and `www` back to a CNAME for the apex. With TTL at 300 s, recovery takes minutes.
- After step 7: re-attach the domain in Lovable first.

## Not changed by this plan

- Backend functions, the worker, migrations, RLS, credits.
- The Lovable repo's bot edits stay out of the release.

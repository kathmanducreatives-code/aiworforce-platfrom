

## Fix Sign-In Flow and Email Verification

The sign-in UI already exists at `/auth` and is functional. The core issue is that **email verification links break** because the Supabase project's redirect URLs are not configured to allow the app's actual domains. Additionally, the protected route sends unauthenticated users to the landing page instead of the sign-in page.

---

### Root Cause: Email Verification Links

The `site_url` in `supabase/config.toml` is set to an old sandbox URL:
```
site_url = "https://b168107d-fd13-46ce-b8e4-93d377d1a1b0.sandbox.lovable.dev"
```

This means Supabase generates email verification links pointing to a domain that no longer works. The actual app URLs are:
- Preview: `https://id-preview--b168107d-fd13-46ce-b8e4-93d377d1a1b0.lovable.app`
- Published: `https://screeningpilot.lovable.app`

---

### Changes Required

**1. Update `supabase/config.toml`**
- Set `site_url` to the published URL: `https://screeningpilot.lovable.app`
- Add both preview and published URLs to `additional_redirect_urls`

**2. Update Supabase Dashboard (manual step)**
- Go to Authentication > URL Configuration in the Supabase dashboard
- Set Site URL to `https://screeningpilot.lovable.app`
- Add these to Redirect URLs:
  - `https://screeningpilot.lovable.app/**`
  - `https://id-preview--b168107d-fd13-46ce-b8e4-93d377d1a1b0.lovable.app/**`

**3. Update `src/components/ProtectedRoute.tsx`**
- Redirect unauthenticated users to `/auth` instead of `/` so they see the sign-in form, not the landing page

**4. Update `src/pages/Auth.tsx`**
- Add a check: if user is already logged in, redirect to `/dashboard` automatically
- Update `emailRedirectTo` to use `window.location.origin` (not hardcoded `/dashboard` path) so it works across all environments

**5. Update `src/pages/Landing.tsx`**
- No changes needed -- it already redirects authenticated users to `/dashboard`

---

### Technical Details

**ProtectedRoute.tsx** -- one-line change:
- Line 15: `navigate('/')` becomes `navigate('/auth')`

**Auth.tsx** -- add useEffect to redirect logged-in users:
- Check `useAuth()` for existing user on mount
- If user exists, navigate to `/dashboard`
- Fix `emailRedirectTo` to use `window.location.origin` instead of `window.location.origin + '/dashboard'`

**supabase/config.toml** -- update URLs:
- `site_url` = `"https://screeningpilot.lovable.app"`
- `additional_redirect_urls` = `["https://id-preview--b168107d-fd13-46ce-b8e4-93d377d1a1b0.lovable.app/**", "https://screeningpilot.lovable.app/**"]`


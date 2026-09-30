// THE ONE PRODUCTION SUPABASE PROJECT, AND HOW TO TELL A URL AND A KEY APART.
//
// Pure: no supabase-js, no browser globals — imported by the client AND by
// vite.config.ts, whose production build refuses a URL/key pair that names two
// different projects.
//
// ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
//
// On 2026-08-16 the app was repointed to `ohsdatpvfdjdemstoiuj`, but only the
// default URL moved: the default publishable key stayed the old Lovable-Cloud
// project's (`wqnigjhcwjxtmordrwno`). A build without VITE_SUPABASE_PUBLISHABLE_KEY
// therefore sent one project's key to another project's API and could sign
// nobody in (agentory.space publishing plan, 2026-09-30). The pair lives here,
// together, and a test holds them to the same project.

export const PRODUCTION_SUPABASE_PROJECT_REF = "ohsdatpvfdjdemstoiuj";
export const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
/** The production project's anon key. Public by design: it ships in every bundle. */
export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oc2RhdHB2ZmRqZGVtc3RvaXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ0NjQsImV4cCI6MjEwMjQ1MDQ2NH0.RH7hU76gQ5H1iMAn6xRBn2ISQDXCgY3soezTBZy--2E";

/** `https://<ref>.supabase.co` → `<ref>`; anything else (custom domain, local) → null. */
export function projectRefOfUrl(url: string | null | undefined): string | null {
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(String(url ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * The project a legacy (JWT) anon key belongs to, from its `ref` claim. A modern
 * `sb_publishable_…` key names no project, so the answer is null — unknown, never
 * a mismatch.
 */
export function projectRefOfKey(key: string | null | undefined): string | null {
  const parts = String(key ?? "").trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof json?.ref === "string" ? json.ref.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** A reason the pair cannot work, or null. Refuses only what it can prove. */
export function supabaseTargetMismatch(url: string, key: string): string | null {
  const urlRef = projectRefOfUrl(url);
  const keyRef = projectRefOfKey(key);
  if (!urlRef || !keyRef || urlRef === keyRef) return null;
  return `Supabase URL is project ${urlRef} but the publishable key belongs to project ${keyRef}`;
}

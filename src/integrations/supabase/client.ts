// The app's one Supabase client. Production target: ./productionTarget.ts.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

import {
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY, PRODUCTION_SUPABASE_URL, supabaseTargetMismatch,
} from './productionTarget';

export { PRODUCTION_SUPABASE_URL };

// Env-overridable so local QA can target another project without editing this
// file. Production builds use the defaults in `productionTarget.ts` when the env
// vars are unset. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in a
// gitignored .env.local to point elsewhere.
// PRODUCTION-BY-DEFAULT SAFETY. The 2026-07-26 manual "TEST" run actually hit
// PRODUCTION because these defaults apply silently when .env.local is absent.
// Production builds keep the defaults; local development must be explicit.
export function resolveSupabaseUrl(envUrl: string | undefined, isDev: boolean): string {
  if (envUrl) return envUrl;
  if (isDev) {
    throw new Error(
      "Supabase is unconfigured in local development. Refusing to silently fall back " +
      `to PRODUCTION (${PRODUCTION_SUPABASE_URL}). Set VITE_SUPABASE_URL and ` +
      "VITE_SUPABASE_PUBLISHABLE_KEY in a gitignored .env.local.",
    );
  }
  return PRODUCTION_SUPABASE_URL;
}

/** Visible banner text for non-production targets; null in production. */
export function environmentLabel(url: string): string | null {
  if (url.replace(/\/+$/, "") === PRODUCTION_SUPABASE_URL) return null;
  return `Non-production Supabase target: ${url.replace(/^https?:\/\//, "")}`;
}

const SUPABASE_URL = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL, !!import.meta.env.DEV);
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? PRODUCTION_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Supabase client misconfigured: missing URL or publishable key in the production bundle.");
}
// ONE PROJECT, NOT TWO. A URL and a key from different projects can sign nobody
// in; failing loudly here beats a login page that silently never works.
const mismatch = supabaseTargetMismatch(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
if (mismatch) throw new Error(`Supabase client misconfigured: ${mismatch}.`);

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});

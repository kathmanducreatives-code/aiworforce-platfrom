// STARTUP ENVIRONMENT GATE.
//
// `resolveSupabaseUrl` already refuses to fall back to PRODUCTION in local dev —
// but it does so by throwing during module import, which renders a blank page.
// This turns that throw into a readable, actionable screen, and gives every
// non-production target a visible badge.
//
// The 2026-07-26 "TEST" run silently reached PRODUCTION because a missing
// .env.local was indistinguishable from a configured one. Nothing here is
// allowed to be silent.
//
// SECRETS: this module reads only the Supabase URL and never a key. Nothing it
// returns may be substituted with a key, and callers render its strings verbatim.
//
// Pure — no React, no network.

import { CANONICAL_PROJECT_REFS, projectRefFromUrl, classifyEnvironment, type ProjectEnvironmentName } from './projectEnvironment.ts';

export type EnvironmentGateStatus = 'ok' | 'blocked';

export interface EnvironmentGate {
  status: EnvironmentGateStatus;
  environment: ProjectEnvironmentName;
  projectRef: string | null;
  /** Non-null for any non-production target. Null in production. */
  badge: string | null;
  /** Populated only when `status === 'blocked'`. */
  title: string | null;
  message: string | null;
  /** Copy-pasteable remediation lines. Never contain a key value. */
  instructions: string[];
}

export interface EnvInput {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  DEV?: boolean;
}

const SETUP_INSTRUCTIONS = [
  'Create a gitignored .env.local in the project root.',
  'Set VITE_SUPABASE_URL to the TEST project URL (https://ohsdatpvfdjdemstoiuj.supabase.co).',
  'Set VITE_SUPABASE_PUBLISHABLE_KEY to that project\'s publishable (anon) key.',
  'Restart the dev server so Vite reloads the environment.',
];

/**
 * Decide whether the app may boot.
 *
 * Local development with no explicit Supabase target is BLOCKED — the previous
 * behaviour (silently using production) is the defect being fixed. Production
 * builds are unaffected and never show a badge.
 */
export function resolveEnvironmentGate(env: EnvInput): EnvironmentGate {
  const isDev = !!env.DEV;
  const url = env.VITE_SUPABASE_URL?.trim() || '';

  if (isDev && !url) {
    return {
      status: 'blocked',
      environment: 'unknown',
      projectRef: null,
      badge: null,
      title: 'Supabase is not configured for local development',
      message:
        'Refusing to start against PRODUCTION. Local development must name its Supabase project explicitly.',
      instructions: [...SETUP_INSTRUCTIONS],
    };
  }

  if (isDev && url && !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
    return {
      status: 'blocked',
      environment: classifyEnvironment(projectRefFromUrl(url)),
      projectRef: projectRefFromUrl(url),
      badge: null,
      title: 'Supabase publishable key is missing',
      message: 'A Supabase URL is set but no publishable key, so no request can be authorized.',
      instructions: [...SETUP_INSTRUCTIONS],
    };
  }

  const projectRef = projectRefFromUrl(url) ?? (isDev ? null : CANONICAL_PROJECT_REFS.production);
  const environment = classifyEnvironment(projectRef);

  // Pointing local development at PRODUCTION is explicit, not accidental — so it
  // is allowed, but it is never quiet about it.
  if (isDev && environment === 'production') {
    return {
      status: 'ok',
      environment,
      projectRef,
      badge: 'PRODUCTION — local dev is connected to the live project',
      title: null,
      message: null,
      instructions: [],
    };
  }

  return {
    status: 'ok',
    environment,
    projectRef,
    badge: environmentBadge(environment, projectRef),
    title: null,
    message: null,
    instructions: [],
  };
}

/** Badge text, or null in production. Contains a project ref — never a key. */
export function environmentBadge(
  environment: ProjectEnvironmentName,
  projectRef: string | null,
): string | null {
  if (environment === 'production') return null;
  if (environment === 'test') return `TEST — ${CANONICAL_PROJECT_REFS.test}`;
  return projectRef ? `NON-PRODUCTION — ${projectRef}` : 'NON-PRODUCTION — unknown project';
}

/**
 * Defence in depth for the rendered screen: assert no value that looks like a
 * JWT/secret can reach the DOM through this module.
 */
export function containsSecret(text: string): boolean {
  return /eyJ[A-Za-z0-9_-]{10,}\./.test(text) || /\b(sb|sbp)_[A-Za-z0-9]{10,}\b/.test(text);
}

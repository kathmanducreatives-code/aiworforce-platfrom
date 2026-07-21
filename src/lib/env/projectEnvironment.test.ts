// Environment identity + TEST-as-production guard.

import { describe, it, expect } from 'vitest';
import {
  resolveProjectEnvironment,
  classifyEnvironment,
  projectRefFromUrl,
  assertEnvironmentIs,
  TestTreatedAsProductionError,
  CANONICAL_PROJECT_REFS,
} from './projectEnvironment';

describe('projectEnvironment', () => {
  it('35. the TEST project is identified as test', () => {
    const env = resolveProjectEnvironment({ VITE_SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.test });
    expect(env.environment).toBe('test');
  });

  it('36. production is identified only through explicit config, not a var name', () => {
    const env = resolveProjectEnvironment({ VITE_SUPABASE_URL: `https://${CANONICAL_PROJECT_REFS.production}.supabase.co` });
    expect(env.projectRef).toBe(CANONICAL_PROJECT_REFS.production);
    expect(env.environment).toBe('production');
  });

  it('classifies an unknown ref as unknown', () => {
    expect(classifyEnvironment('luvostyizefajbltukkc')).toBe('unknown');
  });

  it('projectRefFromUrl extracts the ref', () => {
    expect(projectRefFromUrl('https://wqnigjhcwjxtmordrwno.supabase.co')).toBe('wqnigjhcwjxtmordrwno');
    expect(projectRefFromUrl(null)).toBeNull();
  });

  it('37. refuses to treat the TEST project as production', () => {
    expect(() => assertEnvironmentIs('production', { VITE_SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.test }))
      .toThrow(TestTreatedAsProductionError);
  });

  it('accepts the production project when production is expected', () => {
    const env = assertEnvironmentIs('production', { VITE_SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.production });
    expect(env.environment).toBe('production');
  });

  it('38. diagnostics carry only refs/hosts, never secrets', () => {
    const env = resolveProjectEnvironment({
      VITE_SUPABASE_URL: `https://${CANONICAL_PROJECT_REFS.production}.supabase.co`,
      VITE_BUILD_SHA: 'abc1234',
    });
    const blob = JSON.stringify(env).toLowerCase();
    expect(blob).not.toContain('service_role');
    expect(blob).not.toContain('eyj'); // no JWT
    expect(env.buildSha).toBe('abc1234');
  });
});

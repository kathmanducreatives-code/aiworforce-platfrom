export type OutputShape = 'candidates' | 'emails' | 'signals' | 'intel' | 'content' | 'raw';

export function detectShape(output: any): OutputShape {
  if (output == null) return 'raw';
  if (typeof output === 'string') return 'content';

  if (Array.isArray(output)) {
    const first = output[0];
    if (first && typeof first === 'object') {
      if ('subject' in first && ('body' in first || 'html' in first)) return 'emails';
      if ('severity' in first && ('title' in first || 'message' in first)) return 'signals';
      if ('name' in first && ('title' in first || 'role' in first)) return 'candidates';
    }
    return 'raw';
  }

  if (typeof output === 'object') {
    if ('candidates' in output && Array.isArray((output as any).candidates)) return 'candidates';
    if ('emails' in output && Array.isArray((output as any).emails)) return 'emails';
    if ('signals' in output && Array.isArray((output as any).signals)) return 'signals';
    if ('summary' in output || 'sections' in output) return 'intel';
    if ('text' in output || 'markdown' in output || 'content' in output) return 'content';
  }
  return 'raw';
}

export function unwrapList<T = any>(output: any, key: string): T[] {
  if (Array.isArray(output)) return output as T[];
  if (output && Array.isArray(output[key])) return output[key] as T[];
  return [];
}

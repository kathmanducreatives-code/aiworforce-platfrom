import { type ClientScope, scopeIdentity } from '../workspaceSelection.ts';
export const IMPORT_FIELDS = ['company_name', 'company_domain', 'company_linkedin_url', 'first_name', 'last_name', 'contact_name', 'contact_title', 'contact_email', 'contact_linkedin_url', 'apollo_contact_id', 'apollo_account_id', 'source_list_id', 'source_updated_at'] as const;
export async function csvText(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<string> {
  if (file.size > 250_000) throw Error('CSV exceeds 250KB');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 250_000) throw Error('CSV exceeds 250KB');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
export function validatePreview(raw: unknown, scope: ClientScope, action: 'inspect' | 'preview'): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid preview');
  const r = raw as Record<string, unknown>, s = r.scope as ClientScope;
  if (!s || scopeIdentity(s) !== scopeIdentity(scope) || s.mode !== 'draft_only' || r.action !== action || !Array.isArray(r.headers) || r.headers.some((h) => typeof h !== 'string') || typeof r.preview_hash !== 'string') throw Error('Preview scope mismatch');
  if (action === 'preview' && (!Array.isArray(r.rows) || r.rows.some((v) => !v || typeof v !== 'object' || scopeIdentity(v as ClientScope) !== scopeIdentity(scope) || (v as ClientScope).mode !== 'draft_only'))) throw Error('Preview row scope mismatch');
  return r;
}
// A disposable view controller. Never persists CSV, mapping, or results in browser caches.
export class ImportPreview {
  private serial = 0;
  private stopped = false;
  constructor(private scope: ClientScope, private request: (body: Record<string, unknown>) => Promise<unknown>, private current: () => boolean) {}
  start() { this.stopped = false; }
  stop() { this.stopped = true; this.serial++; }
  async run(action: 'inspect' | 'preview', csv: string, mapping?: Record<string, string | null>) {
    const serial = ++this.serial;
    if (this.stopped || !this.current()) throw Error('Client selection expired');
    const result = await this.request({ action, workspace_id: this.scope.workspace_id, client_binding_id: this.scope.client_binding_id, approved_existing_leads: true, csv, ...(action === 'preview' ? { mapping: structuredClone(mapping) } : {}) });
    if (this.stopped || serial !== this.serial || !this.current()) throw Error('Client selection expired');
    return validatePreview(result, this.scope, action);
  }
}

// P2 browser lifecycle fence, not an authorization mechanism. Server rechecks P1
// for every request. No Brain, memory, task body or credential is persisted here.
export interface ClientScope {
  workspace_id: string; client_binding_id: string; version: number; mode: 'draft_only';
}
export interface ClientChoice extends ClientScope { label: string }
export interface PilotResource { kind: string; id: string }
export interface ClientContextPacket {
  scope: ClientScope; brain: Record<string, unknown>; records: Record<string, unknown>[];
  task_id: string | null; context_key: string;
}
export interface SelectionState {
  revision: number; choices: ClientChoice[]; selected: ClientChoice | null; context: ClientContextPacket | null;
  loading: boolean; error: string | null;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Request = (body: Record<string, unknown>) => Promise<unknown>;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid client response');
  return v as Record<string, unknown>;
};
export const scopeIdentity = (s: ClientScope) => `${s.workspace_id}:${s.client_binding_id}:${s.version}`;
export const clientCacheKey = (user: string, scope: ClientScope, epoch: number) => ['outpost', user, scopeIdentity(scope), epoch] as const;
export class StaleClientSelection extends Error {}

export class WorkspaceSelection {
  private epoch = 0;
  private serial = 0;
  private stopped = false;
  private listeners = new Set<() => void>();
  private value: SelectionState = { revision: 0, choices: [], selected: null, context: null, loading: false, error: null };
  constructor(readonly user: string, private request: Request, private invalidate: () => void, private storage?: Storage | null) {}
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<SelectionState>) { this.value = { ...this.value, ...patch }; this.listeners.forEach((fn) => fn()); }
  private hintKey() { return `outpost.client.v1:${this.user}`; }
  private save(scope: ClientScope | null) {
    try {
      if (scope) this.storage?.setItem(this.hintKey(), JSON.stringify({ workspace_id: scope.workspace_id, client_binding_id: scope.client_binding_id, version: scope.version, mode: scope.mode }));
      else this.storage?.removeItem(this.hintKey());
    } catch { /* blocked storage never grants scope */ }
  }
  private reset() {
    this.epoch++; this.serial++;
    // Clear sensitive state BEFORE calling cache cleanup supplied by the UI.
    this.publish({ revision: this.epoch, selected: null, context: null, error: null, loading: false });
    try { this.invalidate(); return true; }
    catch { this.publish({ choices: [], error: 'Client cache invalidation failed' }); return false; }
  }
  stop() { this.stopped = true; this.reset(); this.save(null); }
  async loadChoices() {
    if (!this.reset()) return; this.stopped = false;
    this.publish({ choices: [], loading: true });
    const epoch = this.epoch;
    try {
      const data = row(await this.request({ action: 'list_workspaces' }));
      if (this.stopped || epoch !== this.epoch) return;
      if (!Array.isArray(data.choices)) throw Error('Client authorization unavailable');
      const seen = new Set<string>();
      const choices = data.choices.map((raw): ClientChoice => {
        const c = row(raw);
        if (!uuid(c.workspace_id) || !uuid(c.client_binding_id) || !Number.isSafeInteger(c.version) || Number(c.version) < 1 || c.mode !== 'draft_only' || typeof c.label !== 'string' || seen.has(c.workspace_id)) throw Error('Invalid client choices');
        seen.add(c.workspace_id);
        return c as unknown as ClientChoice;
      });
      this.publish({ choices, loading: false });
      // Restoring a tab hint requires a fresh authorized list AND fresh context.
      let hint: unknown;
      try { hint = JSON.parse(this.storage?.getItem(this.hintKey()) ?? 'null'); } catch { hint = null; }
      const selected = choices.find((c) => hint && scopeIdentity(c) === scopeIdentity(hint as ClientScope));
      if (selected) await this.select(scopeIdentity(selected));
      else this.save(null); // never choose the first membership implicitly
    } catch {
      if (!this.stopped && epoch === this.epoch) { this.reset(); this.save(null); this.publish({ choices: [], error: 'Client authorization unavailable' }); }
    }
  }
  async select(identity: string | null) {
    const choice = this.value.choices.find((c) => scopeIdentity(c) === identity);
    const cleared = this.reset(); this.save(null);
    if (!cleared) return;
    if (!identity) return;
    if (!choice) { this.publish({ error: 'Choose an authorized client' }); return; }
    this.publish({ selected: choice });
    // Server read must succeed before the choice is remembered as usable.
    try { await this.read([]); if (this.value.selected === choice) this.save(choice); }
    catch (e) { if (!(e instanceof StaleClientSelection)) throw e; }
  }
  async read(resources: PilotResource[]) { return this.contextRequest('read_context', resources); }
  async prepare(taskId: string, resources: PilotResource[]) { return this.contextRequest('prepare_task', resources, taskId); }
  async resume(taskId: string, resources: PilotResource[]) { return this.contextRequest('resume_task', resources, taskId); }
  private async contextRequest(action: string, resources: PilotResource[], taskId?: string) {
    const selected = this.value.selected;
    if (this.stopped || !selected) throw Error('Explicit client selection required');
    const epoch = this.epoch, serial = ++this.serial;
    this.publish({ context: null, loading: true, error: null });
    const current = () => !this.stopped && epoch === this.epoch && serial === this.serial;
    try {
      const raw = await this.request({ action, workspace_id: selected.workspace_id, client_binding_id: selected.client_binding_id,
        resources: structuredClone(resources), ...(taskId ? { task_id: taskId } : {}) });
      if (!current()) throw new StaleClientSelection();
      const data = row(raw), scope = row(data.scope);
      if (scopeIdentity(scope as unknown as ClientScope) !== scopeIdentity(selected) || scope.mode !== 'draft_only' ||
        !data.brain || row(data.brain).workspace_id !== selected.workspace_id || !Array.isArray(data.records) || data.records.some((r) => row(r).workspace_id !== selected.workspace_id) || typeof data.context_key !== 'string' || data.task_id !== (taskId ?? null)) throw Error('Client context mismatch');
      const packet = data as unknown as ClientContextPacket;
      this.publish({ context: packet, loading: false });
      return packet;
    } catch (e) {
      if (!current()) throw new StaleClientSelection();
      this.reset(); this.save(null);
      this.publish({ error: 'Client context unavailable. Re-select an authorized client.' });
      throw e;
    }
  }
}

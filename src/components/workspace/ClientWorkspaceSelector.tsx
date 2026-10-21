import { scopeIdentity, type SelectionState } from '@/lib/workspaceSelection';
export default function ClientWorkspaceSelector({ state, select }: { state: SelectionState; select: (id: string | null) => void }) {
  return <label className="grid gap-2 text-sm">
    Client workspace
    <select aria-label="Client workspace" className="rounded border border-border bg-background p-3" value={state.selected ? scopeIdentity(state.selected) : ''}
      onChange={(e) => select(e.target.value || null)}>
      <option value="">Select an authorized client</option>
      {state.choices.map((choice) => <option key={scopeIdentity(choice)} value={scopeIdentity(choice)}>{choice.label}</option>)}
    </select>
  </label>;
}

import { TASK_MODEL_OPTIONS } from '@/lib/pilot/taskModelOptions';
// Informational until authorized policy/task persistence exists. No settings write or execution action.
export default function TaskModelSelector() {
  return <section className="grid gap-2 rounded border p-4">
    <h2 className="font-semibold">Task model selection · not enabled</h2>
    <select aria-label="Task AI model" disabled value="" onChange={() => {}}>
      <option value="">Model selection requires server policy and security acceptance</option>
      {TASK_MODEL_OPTIONS.map((o) => <option key={o.provider} value={o.provider} disabled>{o.label} · unavailable</option>)}
    </select>
    <ul className="text-sm text-muted-foreground">{TASK_MODEL_OPTIONS.map((o) => <li key={o.provider}>{o.label}: {o.reason}</li>)}</ul>
    <p className="text-sm">No selection is saved and no model is invoked. Agent display settings do not authorize pilot execution.</p>
  </section>;
}

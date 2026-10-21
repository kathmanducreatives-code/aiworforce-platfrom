import { useEffect, useMemo, useState } from 'react';
import { invokeFunction } from '@/lib/agentoryApi';
import { type ClientScope } from '@/lib/workspaceSelection';
import { csvText, ImportPreview, IMPORT_FIELDS } from '@/lib/pilot/importPreview';

export default function ExistingLeadImport({ scope, current }: { scope: ClientScope; current: () => boolean }) {
  const [approved, setApproved] = useState(false);
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useMemo(() => new ImportPreview(scope, async (body) => {
    const r = await invokeFunction('pilot-import', body); if (r.error) throw Error('CSV validation refused'); return r.data;
  }, current), [scope, current]);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  const inspect = async (file?: File) => {
    setCsv(''); setHeaders([]); setMapping({}); setResult(null); setError('');
    if (!file || !approved) return;
    setBusy(true);
    try {
      const text = await csvText(file);
      const r = await controller.run('inspect', text);
      setCsv(text); setHeaders(r.headers as string[]);
      setMapping(Object.fromEntries((r.headers as string[]).map((h) => [h, null])));
    } catch { setError('CSV refused or client selection changed. Check UTF-8, size, ownership columns and CSV syntax.'); }
    finally { setBusy(false); }
  };
  const preview = async () => {
    setResult(null); setError(''); setBusy(true);
    try { setResult(await controller.run('preview', csv, mapping)); }
    catch { setError('Preview refused. Check field mapping, identities, duplicates and client authorization.'); }
    finally { setBusy(false); }
  };
  return <section className="grid gap-3 rounded border p-4">
    <h2 className="font-semibold">Approved existing leads · CSV preview only</h2>
    <p className="text-sm">Use synthetic fixtures only during this disabled pilot stage. Maximum 25 rows / 250KB, UTF-8. Nothing is saved, researched or sent. Source claims and employer associations remain unverified.</p>
    <label><input type="checkbox" checked={approved} disabled={busy} onChange={(e) => { setApproved(e.target.checked); setCsv(''); setHeaders([]); setMapping({}); setResult(null); }} /> These are approved existing leads for the selected client; I am using synthetic fixtures in this stage.</label>
    <label>CSV file<input type="file" accept=".csv,text/csv" disabled={busy || !approved} onChange={(e) => { void inspect(e.target.files?.[0]); }} /></label>
    {headers.map((h) => <label key={h} className="flex flex-wrap justify-between gap-2">{h}<select disabled={busy} value={mapping[h] ?? ''} onChange={(e) => { setResult(null); setMapping({ ...mapping, [h]: e.target.value || null }); }} className="rounded border bg-background p-1">
      <option value="">Omit this column</option>{IMPORT_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}
    </select></label>)}
    <button disabled={busy || !csv} onClick={() => void preview()}>Validate preview</button>
    {busy && <p role="status">Validating CSV within selected client…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(result, null, 2)}</pre>}
  </section>;
}

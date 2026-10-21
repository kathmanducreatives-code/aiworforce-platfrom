import {
  type PacketViewScope,
  sourcePacketView,
} from "../../../lib/pilot/sourcePacketView";
// Unmounted P5 review surface. Callers must authorize on the server before supplying a packet.
// All supplied content is React text; never HTML, Markdown, links, images or instructions.
export function SourceEvidencePanel(
  { packet, scope }: { packet: unknown; scope: PacketViewScope },
) {
  let view: ReturnType<typeof sourcePacketView>;
  try {
    view = sourcePacketView(packet, scope);
  } catch {
    return <p role="alert">Packet unavailable for this client and task.</p>;
  }
  return (
    <section aria-label="Frozen source evidence" className="space-y-3">
      <p>
        Offline preview. No research, AI execution or qualification is
        performed.
      </p>
      <p>
        Client instructions frozen at {view.brain_updated_at}. Snapshot{" "}
        {view.packet_hash}.
      </p>
      <details>
        <summary>Source provenance</summary>
        <pre className="whitespace-pre-wrap break-words">{JSON.stringify({brain_hash:view.brain_hash,csv_file_hash:view.csv_file_hash,csv_rows:view.csv_rows,apollo_account_id:view.apollo_account_id,apollo_contact_id:view.apollo_contact_id,sources:view.sources},null,2)}</pre>
      </details>
      <h3>Supplied claims and exact excerpts</h3>
      <p>
        Text matching confirms attribution within the supplied snapshot.
        Semantic support and business truth have not been verified.
      </p>
      {view.facts.map((f) => (
        <div key={f.id}>
          <p>{f.field}: {f.classification} · {f.source_id}</p>
          <pre className="whitespace-pre-wrap break-words">{f.value}</pre>
          <p>
            Collected: {f.collected_at ?? "unknown"}. Event:{" "}
            {f.event_at ?? "unknown"}.
          </p>
        </div>
      ))}
      <h3>Model interpretations (unverified)</h3>
      {view.interpretations.map((v, i) => <p key={i}>{v}</p>)}
      <h3>Unknown information</h3>
      <ul>{view.unknowns.map((v) => <li key={v}>{v}</li>)}</ul>
    </section>
  );
}

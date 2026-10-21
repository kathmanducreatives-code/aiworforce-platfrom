import {
  type CallBriefScope,
  callBriefView,
} from "../../../lib/pilot/callBriefView";
// P6 is unmounted. No review, export, generation, call or dispatch action exists here.
export function CallBriefPanel(
  { draft, scope }: { draft: unknown; scope: CallBriefScope },
) {
  let v: ReturnType<typeof callBriefView>;
  try {
    v = callBriefView(draft, scope);
  } catch {
    return <p role="alert">Brief unavailable for this client and task.</p>;
  }
  const fact = (f: typeof v.company[number]) => (
    <div key={f.id}>
      <p>
        {f.field} — {f.classification === "conflicting"
          ? "Unresolved conflict"
          : "Supplied claim; not independently verified"}
      </p>
      <blockquote className="whitespace-pre-wrap break-words">
        {f.value}
      </blockquote>
      <details>
        <summary>Source</summary>
        <p>{f.source_id} · {f.url ?? "supplied export"}</p>
        <p>{f.location}</p>
        <p>
          Collected: {f.collected_at ?? "unknown"}; event:{" "}
          {f.event_at ?? "unknown"}.
        </p>
      </details>
    </div>
  );
  const brain = (b: typeof v.context[number]) => (
    <p key={b.id}>
      <strong>{b.path}:</strong>
      {b.value}
    </p>
  );
  return (
    <section aria-label="Caller briefing draft" className="space-y-3">
      <p>
        Unreviewed draft for a human caller. No calls, messages or exports are
        authorized.
      </p>
      <h3>Company overview</h3>
      {v.company.map(fact)}
      <h3>Relevant client context</h3>
      {v.context.map(brain)}
      <h3>Buying signals</h3>
      <p>No verified buying signal is available.</p>
      {v.signals.length > 0 && (
        <>
          <p>
            Supplied excerpts for human verification; they do not establish
            buying intent.
          </p>
          {v.signals.map(fact)}
        </>
      )}
      <h3>Potential talking points — hypotheses</h3>
      {v.talking_points.map((t, i) => (
        <div key={i}>
          {fact(t.buyer)}
          {brain(t.offer)}
          <p>{t.question.text}</p>
        </div>
      ))}
      <h3>Discovery questions</h3>
      {v.questions.map((q, i) => (
        <div key={i}>
          <p>{q.text}</p>
          {q.buyer && fact(q.buyer)}
          {q.client && brain(q.client)}
        </div>
      ))}
      <h3>Missing information</h3>
      <ul>{v.unknowns.map((u) => <li key={u}>{u.replace(/_/g, " ")}</li>)}</ul>
      <h3>Do not claim</h3>
      <ul>{v.do_not_claim.map((x) => <li key={x}>{x}</li>)}</ul>
      <details>
        <summary>Supplied source context — unverified</summary>
        {v.source_snapshots.map((s) => (
          <div key={s.id}>
            <p>{s.id} · {s.locator}</p>
            <pre className="whitespace-pre-wrap break-words">{s.body}</pre>
          </div>
        ))}
      </details>
      <details>
        <summary>All reviewed client instructions</summary>
        {v.instructions.map(brain)}
      </details>
      <details>
        <summary>Draft provenance</summary>
        <p>{v.provider} · {v.model}</p>
        <p>Draft {v.hash}; packet {v.packet_hash}.</p>
        <pre className="whitespace-pre-wrap break-words">{v.source_lineage}</pre>
      </details>
    </section>
  );
}

import { useEffect, useState } from "react";
import { CallBriefPanel } from "./CallBriefPanel";
import {
  type BriefReviewController,
  type ReviewView,
} from "../../../lib/pilot/briefReviewController";
// Unmounted and disabled by default. A fresh keyed instance clears local data on task/client change.
export function BriefReviewPanel(
  props: {
    controller: BriefReviewController;
    mode?: "disabled" | "offline_fixture";
  },
) {
  return <ReviewPanelInstance key={props.controller.instance_id} {...props} />;
}
function ReviewPanelInstance(
  { controller, mode = "disabled" }: {
    controller: BriefReviewController;
    mode?: "disabled" | "offline_fixture";
  },
) {
  const [view, setView] = useState<ReviewView | null>(null),
    [note, setNote] = useState(""),
    [editing, setEditing] = useState<number | null>(null),
    [signals, setSignals] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => () => controller.dispose(), [controller]);
  const enabled = mode === "offline_fixture" && !busy;
  const run = async (action: () => Promise<ReviewView>) => {
    setBusy(true);
    setError(null);
    try {
      const v = await action();
      setView(v);
      setSignals(v.revision.choice.signal_evidence);
      setNote("");
      setEditing(null);
      setAck(false);
    } catch {
      setView(null);
      setAck(false);
      setError(
        "Review action failed. Reload the server version before continuing.",
      );
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await controller.exportCsv();
      const blob = new Blob([out.bytes], { type: out.mime_type }),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = out.file_name;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setError("Export refused. Reload and review the current server version.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!view) throw Error("Load review first");
    const notes = structuredClone(view.revision.notes);
    if (editing !== null) notes[editing] = { ...notes[editing], text: note };
    else if (note.trim()) {
      notes.push({
        text: note,
        fact_ids: [],
        classification: "human_supplied_unverified",
      });
    }
    return await controller.edit({
      ...view.revision.choice,
      signal_evidence: signals,
    }, notes);
  };
  return (
    <section aria-label="Human briefing review" className="space-y-3">
      <p>
        Offline review prototype. Customer use is disabled. Approval permits
        manual CSV preparation only.
      </p>
      <button
        disabled={!enabled}
        onClick={() => run(() => controller.inspect())}
      >
        Load server review
      </button>
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <p>
            Server review state: {view.status}. Revision {view.revision.number}
            {" "}
            · {view.revision.hash}.
          </p>
          <CallBriefPanel
            scope={controller.scope}
            draft={{ ...view.root_draft, content: view.revision.content }}
          />
          <h3>Human reviewer notes — unverified</h3>
          {view.revision.notes.map((n, i) => (
            <div key={i}>
              <p className="whitespace-pre-wrap">{n.text}</p>
              <p>
                Source references:{" "}
                {n.fact_ids.join(", ") || "human-supplied input only"}
              </p>
              <button
                disabled={!enabled}
                onClick={() => {
                  setEditing(i);
                  setNote(n.text);
                }}
              >
                Edit note
              </button>
            </div>
          ))}
          <label>
            {editing === null
              ? "New reviewer note — unverified"
              : "Edit unverified note"}
            <textarea
              value={note}
              maxLength={1000}
              disabled={!enabled}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>Include supplied signal excerpts</legend>
            {(view.root_draft.choice as ReviewView["revision"]["choice"])
              .signal_evidence.map((id, i) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={signals.includes(id)}
                    disabled={!enabled}
                    onChange={(e) =>
                      setSignals((old) =>
                        e.target.checked
                          ? [...old, id]
                          : old.filter((x) => x !== id)
                      )}
                  />Source excerpt {i + 1} (unverified)
                </label>
              ))}
          </fieldset>
          <p>
            Source facts and uncertainty labels stay read-only. Saving creates
            an unreviewed version and invalidates the previous approval.
          </p>
          <button
            disabled={!enabled || (editing !== null && !note.trim())}
            onClick={() => run(save)}
          >
            Save edited draft
          </button>
          <label>
            <input
              type="checkbox"
              checked={ack}
              disabled={!enabled}
              onChange={(e) => setAck(e.target.checked)}
            />I reviewed this version and its sources. Supplied claims remain
            unverified; this does not authorize outreach.
          </label>
          <button
            disabled={!enabled || !ack || view.status === "rejected"}
            onClick={() => run(() => controller.approve(ack))}
          >
            Approve exact version for manual CSV
          </button>
          <label>
            Reason for rejection<textarea
              value={reason}
              maxLength={1000}
              disabled={!enabled}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={!enabled || !reason.trim()}
            onClick={() => run(() => controller.reject(reason))}
          >
            Reject draft
          </button>
          <button
            disabled={!enabled || view.status !== "approved_for_manual_csv"}
            onClick={download}
          >
            Prepare and download approved CSV
          </button>
        </>
      )}
    </section>
  );
}

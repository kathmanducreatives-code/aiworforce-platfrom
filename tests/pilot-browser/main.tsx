import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BriefReviewPanel } from "../../src/components/leads/pilot/BriefReviewPanel";
import { BriefReviewController } from "../../src/lib/pilot/briefReviewController";
import { csvText } from "../../src/lib/pilot/importPreview";
import type { CallBriefScope } from "../../src/lib/pilot/callBriefView";
const syntheticCsv =
  "Company,Domain,Apollo Account,Title,Updated,Notes\nBuyer Demo,buyer-demo.com,same-account,CEO,2020-01-01T00:00:00Z,DO_NOT_COPY_OTHER_CLIENT\nBuyer Demo,buyer-demo.com,same-account,CEO,2020-01-01T00:00:00Z,DO_NOT_COPY_OTHER_CLIENT";
async function post(path: string, body: unknown, token = "") {
  const r = await fetch(`/fixture/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-p8-fixture": "synthetic-only",
      "x-p8-token": token,
    },
    body: JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) throw Error(out.error);
  return out;
}
function App() {
  const epoch = useRef(0);
  const [client, setClient] = useState("A"),
    [csv, setCsv] = useState(syntheticCsv),
    [controller, setController] = useState<BriefReviewController | null>(null),
    [token, setToken] = useState(""),
    [receipt, setReceipt] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  const clear = () => {
    epoch.current++;
    controller?.dispose();
    setController(null);
    setToken("");
    setPreview("");
    setReceipt("");
    setError("");
  };
  const start = async () => {
    clear();
    const current = epoch.current;
    try {
      const x = await post("start", { client, csv });
      if (current !== epoch.current) return;
      const s = x.scope as CallBriefScope, t = String(x.token);
      setToken(t);
      setPreview(JSON.stringify(x.preview));
      setController(
        new BriefReviewController(s, {
          inspect: (scope) => post("inspect", { scope }, t),
          review: (scope, request) => post("review", { scope, request }, t),
          prepare: (scope, request) => post("export", { scope, request }, t),
        }),
      );
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    }
  };
  return (
    <main>
      <h1>P8 offline synthetic acceptance</h1>
      <p>
        Real pilot modules; mocked Auth, storage and model. No native security
        or live execution proof.
      </p>
      <label>
        Client<select
          value={client}
          onChange={(e) => {
            clear();
            setClient(e.target.value);
            setCsv(syntheticCsv);
          }}
        >
          <option>A</option>
          <option>B</option>
        </select>
      </label>
      <label>
        Synthetic CSV<textarea
          value={csv}
          onChange={(e) => {
            clear();
            setCsv(e.target.value);
          }}
        />
      </label>
      <label>
        Load synthetic CSV file<input
          type="file"
          accept=".csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            clear();
            if (f) {
              try {
                setCsv(await csvText(f));
              } catch (err) {
                setError(String(err));
              }
            }
          }}
        />
      </label>
      <button onClick={start}>
        Preview approved synthetic lead and prepare mocked draft
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <details>
          <summary>Import preview receipt</summary>
          <pre>{preview}</pre>
        </details>
      )}
      {controller && (
        <BriefReviewPanel controller={controller} mode="offline_fixture" />
      )}
      {token && (
        <>
          <button
            onClick={async () =>
              setReceipt(JSON.stringify(await post("receipt", {}, token)))}
          >
            Inspect execution receipt
          </button>
          <button
            onClick={async () => {
              await post("revoke", {}, token);
              setReceipt("Synthetic membership revoked");
            }}
          >
            Revoke synthetic membership
          </button>
        </>
      )}
      <pre aria-label="Execution receipt">{receipt}</pre>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

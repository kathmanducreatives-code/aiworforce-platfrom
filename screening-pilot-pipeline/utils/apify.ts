import { fetchJson } from "./http.js";

interface ApifyRunResponse {
  data: {
    id: string;
    defaultDatasetId?: string;
    status?: string;
  };
}

interface ApifyRunStatusResponse {
  data: {
    id: string;
    status: "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED" | "TIMED-OUT";
    defaultDatasetId?: string;
    statusMessage?: string;
  };
}

export async function runApifyActor<T>(params: {
  token: string;
  actorId: string;
  input: Record<string, unknown>;
}): Promise<T[]> {
  const base = "https://api.apify.com/v2";
  const actorIdEncoded = encodeURIComponent(params.actorId);

  const run = await fetchJson<ApifyRunResponse>(
    `${base}/acts/${actorIdEncoded}/runs?token=${encodeURIComponent(params.token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.input)
    }
  );

  let runStatus = run.data.status || "RUNNING";
  let datasetId = run.data.defaultDatasetId;

  while (runStatus === "RUNNING") {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const statusRes = await fetchJson<ApifyRunStatusResponse>(
      `${base}/actor-runs/${run.data.id}?token=${encodeURIComponent(params.token)}`
    );
    runStatus = statusRes.data.status;
    datasetId = statusRes.data.defaultDatasetId || datasetId;

    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) {
      throw new Error(`Apify actor ${params.actorId} ended with status ${runStatus}`);
    }
  }

  if (!datasetId) {
    return [];
  }

  return fetchJson<T[]>(`${base}/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(params.token)}`);
}

// COMPANY BRAIN SETUP: "READING YOUR WEBSITE".
//
// ── THE BUG THIS REPLACES ──────────────────────────────────────────────────
//
// `setup-company-brain` called `runTool("scrape_url", …)` as agent "system"
// since it was written (b162f700, 2026-05-31). `scrape_url` allows only
// "hawk" and "scout", so every call was refused `tool_forbidden` before it
// reached Firecrawl: wherever Firecrawl was configured, onboarding reported
// "Reading your website: failed" and built the brain from manual inputs alone.
//
// ── WHAT A WORKING READ NOW MEANS ──────────────────────────────────────────
//
// * It runs as Hawk — the agent the setup screen already names for this step.
// * It is a PAID call like every other `scrape_url`: one credit per page
//   (`toolRegistry`'s PAID_TOOLS), refunded when Firecrawl never started.
// * Its credit key is scoped to THIS setup run (`lineage_root`). With no task,
//   the key would otherwise be workspace-wide forever, and re-running setup
//   would re-read the same pages without ever being charged again.
// * A refusal for credits says so, instead of a bare "failed".
// * LinkedIn URLs are not read: Firecrawl is not the LinkedIn path, and the
//   setup screen reports "LinkedIn company lookup" as not wired.

import { CREDIT_REFUSED_ERROR } from "./creditAuthorization.ts";

export const SETUP_READ_AGENT = "hawk" as const;
export const SETUP_READ_MAX_PAGES = 3;

export interface SetupSource { source_type?: string | null; url?: string | null }

// deno-lint-ignore no-explicit-any
export type SetupRunTool = (name: string, input: unknown, ctx: any) =>
  Promise<{ ok: boolean; data?: unknown; error?: string; unavailable?: boolean }>;

export interface SetupReadResult {
  enrichments: { url: string; summary: string }[];
  status: "ok" | "skipped" | "failed";
  warnings: string[];
  /** The URLs actually sent to Firecrawl. */
  read: string[];
}

const isLinkedIn = (u: string) => /(^|\.)linkedin\.com$/i.test((() => {
  try { return new URL(u).hostname; } catch { return ""; }
})());

/** The website pages a setup run reads: http(s), not LinkedIn, deduplicated, at most three. */
export function setupReadTargets(sources: readonly SetupSource[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const u = typeof s.url === "string" ? s.url.trim() : "";
    if (!/^https?:\/\//i.test(u) || isLinkedIn(u) || s.source_type === "linkedin" || out.includes(u)) continue;
    out.push(u);
    if (out.length >= SETUP_READ_MAX_PAGES) break;
  }
  return out;
}

export async function readSetupWebsites(i: {
  runTool: SetupRunTool;
  admin: unknown;
  workspace_id: string;
  user_id: string | null;
  /** One id per setup run: the scope of this run's credit keys. */
  run_id: string;
  sources: readonly SetupSource[];
}): Promise<SetupReadResult> {
  const targets = setupReadTargets(i.sources);
  const enrichments: SetupReadResult["enrichments"] = [];
  const warnings: string[] = [];
  if (targets.length === 0) return { enrichments, status: "skipped", warnings, read: [] };

  const ctx = {
    admin: i.admin, workspace_id: i.workspace_id, agent_slug: SETUP_READ_AGENT, agent_id: null,
    agent_name: "Hawk", user_id: i.user_id, lineage_root: `brain-setup:${i.run_id}`,
  };
  let anyOk = false, anyFail = false, creditRefused = false;
  for (const url of targets) {
    try {
      const r = await i.runTool("scrape_url", { url }, ctx);
      if (r.ok && r.data) {
        const txt = typeof r.data === "string" ? r.data : JSON.stringify(r.data).slice(0, 2000);
        enrichments.push({ url, summary: txt.slice(0, 2000) });
        anyOk = true;
      } else {
        anyFail = true;
        if (r.error === CREDIT_REFUSED_ERROR) creditRefused = true;
      }
    } catch {
      anyFail = true;
    }
  }
  if (creditRefused) {
    warnings.push("Reading your website needs credits, and this workspace has none left. Continuing with the details you entered.");
  }
  return { enrichments, status: anyOk ? "ok" : anyFail ? "failed" : "skipped", warnings, read: targets };
}

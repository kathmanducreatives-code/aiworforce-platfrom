import http from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const STUDIO_OUTPUT_DIR = path.join(__dirname, "output");
const PROJECTS_DIR = path.join(__dirname, "projects");
const PORT = Number(process.env.PORT || 3099);
const MAX_LOG_LINES = 140;

const SOURCES = [
  {
    id: "hot_leads_pipeline",
    label: "Hot Leads Pipeline",
    description: "Combined hot-lead run using Apify LinkedIn signals and Firecrawl enrichment.",
    jsonPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "hot_leads_budgeted.json"),
    csvPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "hot_leads_budgeted.csv"),
    actionId: "run_hot_leads",
    recommended: true,
  },
  {
    id: "linkedin_post_hot_leads",
    label: "LinkedIn Post Hot Leads",
    description: "Apify LinkedIn post and comment scraper tuned for hiring pain and agency-fee signals.",
    jsonPath: path.join(STUDIO_OUTPUT_DIR, "linkedin_post_hot_leads.json"),
    csvPath: path.join(STUDIO_OUTPUT_DIR, "linkedin_post_hot_leads.csv"),
    actionId: "run_linkedin_posts",
  },
  {
    id: "linkedin_jobs",
    label: "LinkedIn Jobs",
    description: "Apify LinkedIn job search results for technical startup roles.",
    jsonPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "live_linkedin_jobs.json"),
    csvPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "live_linkedin_jobs.csv"),
    actionId: "run_linkedin_jobs",
  },
  {
    id: "firecrawl_board_shortlist",
    label: "Firecrawl Board Shortlist",
    description: "Fresh YC and startup job-board scrape via Firecrawl.",
    jsonPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "live_board_shortlist.json"),
    csvPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "live_board_shortlist.csv"),
    actionId: "run_firecrawl_boards",
  },
  {
    id: "apify_last_3_runs",
    label: "Apify Last 3 Runs",
    description: "Normalized export of the last three Apify datasets for audit and cleanup.",
    jsonPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "apify_last_3_runs_combined.json"),
    csvPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "output", "apify_last_3_runs_combined.csv"),
  },
  {
    id: "contact_enriched_leads",
    label: "Enriched Contacts",
    description: "Latest low-cost contact enrichment run with phone numbers, emails, and LinkedIn URLs.",
    jsonPath: path.join(STUDIO_OUTPUT_DIR, "contact_enriched_leads.json"),
    csvPath: path.join(STUDIO_OUTPUT_DIR, "contact_enriched_leads.csv"),
  },
];

const ACTIONS = [
  {
    id: "run_hot_leads",
    label: "Run hot leads",
    description: "Apify LinkedIn posts and jobs plus Firecrawl job-board and enrichment sweep.",
    budget: "Apify <= $5, Firecrawl <= 500 credits",
    scriptPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "scripts", "run_hot_leads_budgeted.mjs"),
    sourceId: "hot_leads_pipeline",
    requires: ["APIFY_API_TOKEN", "FIRECRAWL_API_KEY"],
  },
  {
    id: "run_linkedin_posts",
    label: "Scrape LinkedIn pain comments",
    description: "Focused Apify LinkedIn post and comment scrape for decision-maker pain signals.",
    budget: "Apify only, low-volume comment run",
    scriptPath: path.join(__dirname, "scripts", "run_linkedin_post_hot_leads.mjs"),
    sourceId: "linkedin_post_hot_leads",
    requires: ["APIFY_API_TOKEN"],
  },
  {
    id: "run_linkedin_jobs",
    label: "Scrape LinkedIn jobs",
    description: "Apify LinkedIn jobs pass for fresh technical hiring signals.",
    budget: "Apify only",
    scriptPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "scripts", "run_live_linkedin_jobs.mjs"),
    sourceId: "linkedin_jobs",
    requires: ["APIFY_API_TOKEN"],
  },
  {
    id: "run_firecrawl_boards",
    label: "Scrape startup job boards",
    description: "Firecrawl sweep of YC Jobs and Work at a Startup.",
    budget: "Firecrawl only",
    scriptPath: path.join(ROOT_DIR, "screening-pilot-pipeline", "scripts", "run_live_board_shortlist.mjs"),
    sourceId: "firecrawl_board_shortlist",
    requires: ["FIRECRAWL_API_KEY"],
  },
];

const runState = {
  state: "idle",
  actionId: null,
  actionLabel: null,
  sourceId: null,
  startedAt: null,
  finishedAt: null,
  logs: [],
  error: null,
  pid: null,
};

await fs.mkdir(STUDIO_OUTPUT_DIR, { recursive: true });
await fs.mkdir(PROJECTS_DIR, { recursive: true });

const env = await loadEnv();

function parseDotEnv(raw) {
  const entries = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

async function loadEnv() {
  const candidates = [
    path.join(ROOT_DIR, ".env.local"),
    path.join(ROOT_DIR, ".env"),
    path.join(ROOT_DIR, "screening-pilot-pipeline", ".env"),
  ];

  const loaded = {};

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      Object.assign(loaded, parseDotEnv(raw));
    } catch {}
  }

  return { ...loaded, ...process.env };
}

function slugify(value, fallback = "project") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || fallback;
}

function buildTimestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function pickArrayPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [raw];

  for (const key of ["rows", "items", "leads", "data"]) {
    if (Array.isArray(raw[key])) return raw[key];
  }

  return [raw];
}

function stringifyCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => stringifyCell(entry)).join(" | ");
  return JSON.stringify(value);
}

function normalizeRows(raw) {
  return pickArrayPayload(raw).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { value: stringifyCell(row) };
    }

    const flat = {};
    for (const [key, value] of Object.entries(row)) {
      flat[key] = stringifyCell(value);
    }
    return flat;
  });
}

const PREFERRED_COLUMNS = [
  "company_name",
  "company",
  "title",
  "contact_name",
  "contact_title",
  "contact_readiness",
  "preferred_contact_name",
  "preferred_contact_title",
  "preferred_contact_phone",
  "phone_verification_status",
  "preferred_contact_email",
  "preferred_contact_linkedin_url",
  "contact_strategy",
  "contact_phone_source",
  "contact_email_source",
  "enrichment_status",
  "source_channel",
  "source_subtype",
  "score",
  "tier",
  "signal_summary",
  "commenter_name",
  "linkedin_url",
  "contact_linkedin_url",
  "evidence_url",
  "posted_date",
  "query",
  "applicants",
  "recency_days",
];

function buildColumns(rows) {
  const seen = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => seen.add(key)));
  const rest = [...seen].filter((key) => !PREFERRED_COLUMNS.includes(key)).sort();
  return PREFERRED_COLUMNS.filter((key) => seen.has(key)).concat(rest);
}

function credentialsSummary() {
  return {
    apify: Boolean(env.APIFY_API_TOKEN),
    firecrawl: Boolean(env.FIRECRAWL_API_KEY),
  };
}

function missingEnvForAction(action) {
  return (action.requires || []).filter((key) => !env[key]);
}

function appendLog(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (!lines.length) return;
  runState.logs.push(...lines);
  runState.logs = runState.logs.slice(-MAX_LOG_LINES);
}

function getMimeType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

function formatSourceSummary(source, rowCount, updatedAt, jsonAvailable, csvAvailable) {
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    rowCount,
    updatedAt,
    jsonAvailable,
    csvAvailable,
    actionId: source.actionId || null,
    recommended: Boolean(source.recommended),
  };
}

async function summarizeJsonFile(jsonPath) {
  const jsonStat = await statOrNull(jsonPath);
  if (!jsonStat) return { rowCount: 0, updatedAt: null };

  try {
    const raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    return { rowCount: pickArrayPayload(raw).length, updatedAt: jsonStat.mtime.toISOString() };
  } catch {
    return { rowCount: 0, updatedAt: jsonStat.mtime.toISOString() };
  }
}

async function getSourceSummary(source) {
  const [jsonStat, csvStat] = await Promise.all([statOrNull(source.jsonPath), statOrNull(source.csvPath)]);
  const { rowCount, updatedAt } = jsonStat ? await summarizeJsonFile(source.jsonPath) : { rowCount: 0, updatedAt: null };
  return formatSourceSummary(
    source,
    rowCount,
    updatedAt || (csvStat ? csvStat.mtime.toISOString() : null),
    Boolean(jsonStat),
    Boolean(csvStat),
  );
}

async function buildSheetPayloadFromPaths({
  kind,
  title,
  description,
  sourceRefId,
  jsonPath,
  csvPath,
  updatedAt,
  csvUrl,
  jsonUrl,
  projectId = null,
  entryId = null,
}) {
  const jsonStat = await statOrNull(jsonPath);
  const csvStat = await statOrNull(csvPath);
  const finalUpdatedAt = updatedAt || jsonStat?.mtime.toISOString() || csvStat?.mtime.toISOString() || null;

  if (!jsonStat) {
    return {
      kind,
      title,
      description,
      sourceRefId,
      projectId,
      entryId,
      columns: [],
      rows: [],
      rowCount: 0,
      updatedAt: finalUpdatedAt,
      csvUrl: csvStat ? csvUrl : null,
      jsonUrl: jsonStat ? jsonUrl : null,
    };
  }

  const raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const rows = normalizeRows(raw);

  return {
    kind,
    title,
    description,
    sourceRefId,
    projectId,
    entryId,
    columns: buildColumns(rows),
    rows,
    rowCount: rows.length,
    updatedAt: finalUpdatedAt,
    csvUrl: csvStat ? csvUrl : null,
    jsonUrl: jsonStat ? jsonUrl : null,
  };
}

async function getSourceSheetData(sourceId) {
  const source = SOURCES.find((entry) => entry.id === sourceId) || SOURCES[0];
  return buildSheetPayloadFromPaths({
    kind: "source",
    title: source.label,
    description: source.description,
    sourceRefId: source.id,
    jsonPath: source.jsonPath,
    csvPath: source.csvPath,
    csvUrl: `/download?source=${source.id}&format=csv`,
    jsonUrl: `/download?source=${source.id}&format=json`,
  });
}

async function readProjectMeta(projectId) {
  const filePath = path.join(PROJECTS_DIR, projectId, "project.json");
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  return raw;
}

async function listProjects() {
  const dirs = await fs.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  const projects = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const projectId = dir.name;
    const projectDir = path.join(PROJECTS_DIR, projectId);
    const metaPath = path.join(projectDir, "project.json");
    const metaStat = await statOrNull(metaPath);
    if (!metaStat) continue;

    const projectMeta = await readProjectMeta(projectId).catch(() => null);
    if (!projectMeta) continue;

    const entryDirs = await fs.readdir(projectDir, { withFileTypes: true }).catch(() => []);
    const entries = [];
    let latestUpdatedAt = projectMeta.createdAt || metaStat.mtime.toISOString();

    for (const entryDir of entryDirs) {
      if (!entryDir.isDirectory()) continue;

      const entryId = entryDir.name;
      const entryPath = path.join(projectDir, entryId);
      const entryMetaPath = path.join(entryPath, "meta.json");
      const entryMetaStat = await statOrNull(entryMetaPath);
      if (!entryMetaStat) continue;

      const entryMeta = JSON.parse(await fs.readFile(entryMetaPath, "utf8"));
      const jsonPath = path.join(entryPath, "data.json");
      const csvPath = path.join(entryPath, "data.csv");
      const [jsonStat, csvStat] = await Promise.all([statOrNull(jsonPath), statOrNull(csvPath)]);
      const { rowCount, updatedAt } = jsonStat
        ? await summarizeJsonFile(jsonPath)
        : { rowCount: 0, updatedAt: csvStat?.mtime.toISOString() || entryMeta.savedAt || null };

      if (updatedAt && (!latestUpdatedAt || updatedAt > latestUpdatedAt)) {
        latestUpdatedAt = updatedAt;
      }

      entries.push({
        id: entryId,
        label: entryMeta.label || entryId,
        description: entryMeta.description || "",
        sourceId: entryMeta.sourceId || null,
        savedAt: entryMeta.savedAt || updatedAt,
        rowCount,
        jsonAvailable: Boolean(jsonStat),
        csvAvailable: Boolean(csvStat),
      });
    }

    entries.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

    projects.push({
      id: projectId,
      name: projectMeta.name || projectId,
      createdAt: projectMeta.createdAt || metaStat.mtime.toISOString(),
      updatedAt: latestUpdatedAt,
      entryCount: entries.length,
      entries,
    });
  }

  projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return projects;
}

async function createProject(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw new Error("Project name is required.");
  }

  const baseId = slugify(cleanName);
  let projectId = baseId;
  let suffix = 1;

  while (await statOrNull(path.join(PROJECTS_DIR, projectId))) {
    projectId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const projectDir = path.join(PROJECTS_DIR, projectId);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "project.json"),
    JSON.stringify({ id: projectId, name: cleanName, createdAt: new Date().toISOString() }, null, 2),
  );

  return projectId;
}

async function resolveProjectEntry(projectId, entryId) {
  const safeProjectId = slugify(projectId);
  const safeEntryId = slugify(entryId, entryId);
  const entryDir = path.join(PROJECTS_DIR, safeProjectId, safeEntryId);
  const metaPath = path.join(entryDir, "meta.json");
  const metaStat = await statOrNull(metaPath);

  if (!metaStat) {
    throw new Error("Saved scrape not found.");
  }

  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  return {
    projectId: safeProjectId,
    entryId: safeEntryId,
    projectName: (await readProjectMeta(safeProjectId)).name,
    meta,
    jsonPath: path.join(entryDir, "data.json"),
    csvPath: path.join(entryDir, "data.csv"),
  };
}

async function getProjectEntrySheetData(projectId, entryId) {
  const entry = await resolveProjectEntry(projectId, entryId);
  return buildSheetPayloadFromPaths({
    kind: "projectEntry",
    title: `${entry.meta.label} · ${entry.projectName}`,
    description: entry.meta.description || "Saved project scrape",
    sourceRefId: entry.meta.sourceId || null,
    projectId: entry.projectId,
    entryId: entry.entryId,
    jsonPath: entry.jsonPath,
    csvPath: entry.csvPath,
    updatedAt: entry.meta.savedAt || null,
    csvUrl: `/download?projectId=${entry.projectId}&entryId=${entry.entryId}&format=csv`,
    jsonUrl: `/download?projectId=${entry.projectId}&entryId=${entry.entryId}&format=json`,
  });
}

async function resolveExportTarget({ sourceId, fromProjectId, entryId }) {
  if (sourceId) {
    const source = SOURCES.find((entry) => entry.id === sourceId);
    if (!source) throw new Error("Unknown source.");
    return {
      label: source.label,
      description: source.description,
      sourceId: source.id,
      jsonPath: source.jsonPath,
      csvPath: source.csvPath,
    };
  }

  if (fromProjectId && entryId) {
    const entry = await resolveProjectEntry(fromProjectId, entryId);
    return {
      label: entry.meta.label,
      description: entry.meta.description,
      sourceId: entry.meta.sourceId || null,
      jsonPath: entry.jsonPath,
      csvPath: entry.csvPath,
    };
  }

  throw new Error("Nothing selected to save.");
}

async function resolveActiveTarget(body) {
  if (body?.sourceId) {
    return resolveExportTarget({ sourceId: body.sourceId });
  }

  if (body?.projectId && body?.entryId) {
    return resolveExportTarget({
      fromProjectId: body.projectId,
      entryId: body.entryId,
    });
  }

  throw new Error("Choose a dataset or saved project file first.");
}

async function saveTargetToProject({ projectId, sourceId, fromProjectId, entryId }) {
  const safeProjectId = slugify(projectId);
  const projectDir = path.join(PROJECTS_DIR, safeProjectId);
  const projectStat = await statOrNull(projectDir);
  if (!projectStat) throw new Error("Project folder does not exist.");

  const target = await resolveExportTarget({ sourceId, fromProjectId, entryId });
  const [jsonStat, csvStat] = await Promise.all([statOrNull(target.jsonPath), statOrNull(target.csvPath)]);

  if (!jsonStat && !csvStat) {
    throw new Error("The selected scrape does not have export files yet.");
  }

  const entryIdSafe = slugify(`${buildTimestampLabel()}-${target.label}`, buildTimestampLabel());
  const entryDir = path.join(projectDir, entryIdSafe);
  await fs.mkdir(entryDir, { recursive: true });

  const jsonCopyPath = path.join(entryDir, "data.json");
  const csvCopyPath = path.join(entryDir, "data.csv");

  if (jsonStat) {
    await fs.copyFile(target.jsonPath, jsonCopyPath);
  }

  if (csvStat) {
    await fs.copyFile(target.csvPath, csvCopyPath);
  }

  const rowCount = jsonStat ? pickArrayPayload(JSON.parse(await fs.readFile(target.jsonPath, "utf8"))).length : 0;
  const meta = {
    id: entryIdSafe,
    label: target.label,
    description: target.description,
    sourceId: target.sourceId,
    savedAt: new Date().toISOString(),
    rowCount,
  };

  await fs.writeFile(path.join(entryDir, "meta.json"), JSON.stringify(meta, null, 2));
  return resolveProjectEntry(safeProjectId, entryIdSafe);
}

async function serveStatic(res, requestPath) {
  const safePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const html = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
      sendText(res, 200, html, "text/html; charset=utf-8");
      return;
    }

    const file = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": getMimeType(filePath) });
    res.end(file);
  } catch {
    const html = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
    sendText(res, 200, html, "text/html; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://localhost:${PORT}`);

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/overview") {
      const [sources, projects] = await Promise.all([
        Promise.all(SOURCES.map((source) => getSourceSummary(source))),
        listProjects(),
      ]);

      sendJson(res, 200, {
        sources,
        projects,
        actions: ACTIONS.map((action) => ({
          id: action.id,
          label: action.label,
          description: action.description,
          budget: action.budget,
          sourceId: action.sourceId,
          requires: action.requires,
        })),
        status: runState,
        credentials: credentialsSummary(),
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(res, 200, { status: runState, credentials: credentialsSummary() });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/data") {
      const sourceId = requestUrl.searchParams.get("source") || "hot_leads_pipeline";
      sendJson(res, 200, await getSourceSheetData(sourceId));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/project-entry") {
      const projectId = requestUrl.searchParams.get("projectId");
      const entryId = requestUrl.searchParams.get("entryId");
      if (!projectId || !entryId) {
        sendJson(res, 400, { error: "projectId and entryId are required." });
        return;
      }

      sendJson(res, 200, await getProjectEntrySheetData(projectId, entryId));
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/projects") {
      const body = await readBody(req);
      const projectId = await createProject(body.name);
      const projects = await listProjects();
      sendJson(res, 201, { ok: true, projectId, projects });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/projects/save") {
      const body = await readBody(req);
      if (!body.projectId) {
        sendJson(res, 400, { error: "projectId is required." });
        return;
      }

      const entry = await saveTargetToProject({
        projectId: body.projectId,
        sourceId: body.sourceId || null,
        fromProjectId: body.fromProjectId || null,
        entryId: body.entryId || null,
      });

      const projects = await listProjects();
      sendJson(res, 201, { ok: true, projectId: entry.projectId, entryId: entry.entryId, projects });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/enrich") {
      if (runState.state === "running") {
        sendJson(res, 409, { error: "Another scrape is already running.", status: runState });
        return;
      }

      if (!env.APIFY_API_TOKEN) {
        sendJson(res, 400, { error: "Missing APIFY_API_TOKEN" });
        return;
      }

      const body = await readBody(req);
      const target = await resolveActiveTarget(body);
      const jsonStat = await statOrNull(target.jsonPath);

      if (!jsonStat) {
        sendJson(res, 404, { error: "The selected dataset does not have a JSON export yet." });
        return;
      }

      const enrichScriptPath = path.join(__dirname, "scripts", "enrich_contacts_latest.mjs");
      const child = spawn(process.execPath, [enrichScriptPath], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          ...env,
          HOT_LEADS_INPUT_JSON: target.jsonPath,
          HOT_LEADS_OUTPUT_JSON: path.join(STUDIO_OUTPUT_DIR, "contact_enriched_leads.json"),
          HOT_LEADS_OUTPUT_CSV: path.join(STUDIO_OUTPUT_DIR, "contact_enriched_leads.csv"),
          HOT_LEADS_TARGET_LABEL: target.label,
          HOT_LEADS_TARGET_SOURCE_ID: target.sourceId || "project_entry",
        },
      });

      runState.state = "running";
      runState.actionId = "enrich_contacts";
      runState.actionLabel = "Enrich contacts";
      runState.sourceId = "contact_enriched_leads";
      runState.startedAt = new Date().toISOString();
      runState.finishedAt = null;
      runState.logs = [`Launching contact enrichment for ${target.label}...`];
      runState.error = null;
      runState.pid = child.pid ?? null;

      child.stdout.on("data", (chunk) => appendLog(chunk));
      child.stderr.on("data", (chunk) => appendLog(chunk));
      child.on("close", (code) => {
        runState.finishedAt = new Date().toISOString();
        runState.pid = null;

        if (code === 0) {
          runState.state = "succeeded";
          appendLog("Contact enrichment finished successfully.");
        } else {
          runState.state = "failed";
          runState.error = `Contact enrichment exited with code ${code ?? 1}.`;
          appendLog(runState.error);
        }
      });

      sendJson(res, 202, { ok: true, status: runState });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/download") {
      const format = requestUrl.searchParams.get("format") || "csv";

      let filePath = null;

      if (requestUrl.searchParams.get("source")) {
        const sourceId = requestUrl.searchParams.get("source");
        const source = SOURCES.find((entry) => entry.id === sourceId) || SOURCES[0];
        filePath = format === "json" ? source.jsonPath : source.csvPath;
      } else if (requestUrl.searchParams.get("projectId") && requestUrl.searchParams.get("entryId")) {
        const entry = await resolveProjectEntry(
          requestUrl.searchParams.get("projectId"),
          requestUrl.searchParams.get("entryId"),
        );
        filePath = format === "json" ? entry.jsonPath : entry.csvPath;
      }

      if (!filePath || !(await statOrNull(filePath))) {
        sendJson(res, 404, { error: "Requested export does not exist yet." });
        return;
      }

      const file = await fs.readFile(filePath);
      res.writeHead(200, {
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${path.basename(filePath)}"`,
      });
      res.end(file);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/run") {
      if (runState.state === "running") {
        sendJson(res, 409, { error: "Another scrape is already running.", status: runState });
        return;
      }

      const body = await readBody(req);
      const action = ACTIONS.find((entry) => entry.id === body.actionId);

      if (!action) {
        sendJson(res, 400, { error: "Unknown action." });
        return;
      }

      const missing = missingEnvForAction(action);
      if (missing.length) {
        sendJson(res, 400, { error: `Missing env vars: ${missing.join(", ")}` });
        return;
      }

      const child = spawn(process.execPath, [action.scriptPath], {
        cwd: ROOT_DIR,
        env: { ...process.env, ...env },
      });

      runState.state = "running";
      runState.actionId = action.id;
      runState.actionLabel = action.label;
      runState.sourceId = action.sourceId;
      runState.startedAt = new Date().toISOString();
      runState.finishedAt = null;
      runState.logs = [`Launching ${action.label}...`];
      runState.error = null;
      runState.pid = child.pid ?? null;

      child.stdout.on("data", (chunk) => appendLog(chunk));
      child.stderr.on("data", (chunk) => appendLog(chunk));
      child.on("close", (code) => {
        runState.finishedAt = new Date().toISOString();
        runState.pid = null;

        if (code === 0) {
          runState.state = "succeeded";
          appendLog(`${action.label} finished successfully.`);
        } else {
          runState.state = "failed";
          runState.error = `${action.label} exited with code ${code ?? 1}.`;
          appendLog(runState.error);
        }
      });

      sendJson(res, 202, { ok: true, status: runState });
      return;
    }

    await serveStatic(res, requestUrl.pathname);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    sendJson(res, 500, { error: message, status: runState });
  }
});

server.listen(PORT, () => {
  console.log(`Hot Leads Studio running on http://localhost:${PORT}`);
});

const state = {
  overview: null,
  sheet: null,
  activeTarget: null,
  selectedCell: null,
  selectedRowIndex: null,
  search: "",
  rowLimit: "250",
  contactFilter: "all",
  previousRunState: "idle",
};

const elements = {
  actionList: document.getElementById("action-list"),
  sourceList: document.getElementById("source-list"),
  projectList: document.getElementById("project-list"),
  projectNameInput: document.getElementById("project-name"),
  createProjectButton: document.getElementById("create-project"),
  apifyReady: document.getElementById("apify-ready"),
  firecrawlReady: document.getElementById("firecrawl-ready"),
  runStatePill: document.getElementById("run-state-pill"),
  logConsole: document.getElementById("log-console"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetDescription: document.getElementById("sheet-description"),
  contactStackNote: document.getElementById("contact-stack-note"),
  visibleCount: document.getElementById("visible-count"),
  columnCount: document.getElementById("column-count"),
  updatedAt: document.getElementById("updated-at"),
  activeCellName: document.getElementById("active-cell-name"),
  activeCellValue: document.getElementById("active-cell-value"),
  rowInspector: document.getElementById("row-inspector"),
  sheetEmpty: document.getElementById("sheet-empty"),
  sheetWrap: document.getElementById("sheet-wrap"),
  sheetTable: document.getElementById("sheet-table"),
  sheetWorkspace: document.getElementById("sheet-workspace"),
  searchInput: document.getElementById("cell-search"),
  rowLimitSelect: document.getElementById("row-limit"),
  contactFilterSelect: document.getElementById("contact-filter"),
  refreshOverview: document.getElementById("refresh-overview"),
  downloadCsv: document.getElementById("download-csv"),
  downloadJson: document.getElementById("download-json"),
  fullscreenButton: document.getElementById("fullscreen-sheet"),
  enrichContacts: document.getElementById("enrich-contacts"),
};

const PHONE_FIELDS = [
  "preferred_contact_phone",
  "decision_maker_phone",
  "founder_phone",
  "contact_phone",
  "phone",
];

const EMAIL_FIELDS = [
  "preferred_contact_email",
  "decision_maker_email",
  "founder_email",
  "contact_email",
  "email",
];

const LINKEDIN_FIELDS = [
  "preferred_contact_linkedin_url",
  "contact_linkedin_url",
  "decision_maker_linkedin_url",
  "linkedin_url",
];

function showMessage(message) {
  window.alert(message);
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function relativeTime(value) {
  if (!value) return "No export yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 1) return "just now";
  if (Math.abs(diffMinutes) < 60) return `${Math.abs(diffMinutes)}m ${diffMinutes >= 0 ? "from now" : "ago"}`;
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return `${Math.abs(diffHours)}h ${diffHours >= 0 ? "from now" : "ago"}`;
  const diffDays = Math.round(diffHours / 24);
  return `${Math.abs(diffDays)}d ${diffDays >= 0 ? "from now" : "ago"}`;
}

function sheetColumnLabel(index) {
  let label = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }

  return label;
}

function activeTargetMatchesSource(sourceId) {
  return state.activeTarget?.kind === "source" && state.activeTarget.sourceId === sourceId;
}

function activeTargetMatchesEntry(projectId, entryId) {
  return (
    state.activeTarget?.kind === "projectEntry" &&
    state.activeTarget.projectId === projectId &&
    state.activeTarget.entryId === entryId
  );
}

function hasCurrentSelection() {
  return Boolean(state.activeTarget?.kind === "source" || state.activeTarget?.kind === "projectEntry");
}

function rowHasPhone(row) {
  return Boolean(firstNonEmpty(PHONE_FIELDS.map((field) => row?.[field])));
}

function rowHasContactInfo(row) {
  return Boolean(
    rowHasPhone(row) ||
      firstNonEmpty(EMAIL_FIELDS.map((field) => row?.[field])) ||
      firstNonEmpty(LINKEDIN_FIELDS.map((field) => row?.[field])),
  );
}

async function readJson(response) {
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      if (payload.error) message = payload.error;
    } catch {}
    throw new Error(message);
  }

  return response.json();
}

function preferredTargetFromOverview(overview, preferredTarget) {
  if (preferredTarget?.kind === "projectEntry") {
    const project = overview.projects.find((item) => item.id === preferredTarget.projectId);
    const entry = project?.entries.find((item) => item.id === preferredTarget.entryId);
    if (project && entry) return preferredTarget;
  }

  if (preferredTarget?.kind === "source") {
    const source = overview.sources.find((item) => item.id === preferredTarget.sourceId);
    if (source) return preferredTarget;
  }

  if (state.activeTarget?.kind === "projectEntry") {
    const project = overview.projects.find((item) => item.id === state.activeTarget.projectId);
    const entry = project?.entries.find((item) => item.id === state.activeTarget.entryId);
    if (project && entry) return state.activeTarget;
  }

  if (state.activeTarget?.kind === "source") {
    const source = overview.sources.find((item) => item.id === state.activeTarget.sourceId);
    if (source) return state.activeTarget;
  }

  const fallbackSource =
    overview.sources.find((source) => source.recommended && source.jsonAvailable) ??
    overview.sources.find((source) => source.jsonAvailable) ??
    overview.sources[0];

  return fallbackSource ? { kind: "source", sourceId: fallbackSource.id } : null;
}

async function fetchOverview(preferredTarget) {
  const overview = await readJson(await fetch("/api/overview"));
  state.overview = overview;

  renderSidebar();
  renderStatus();

  const nextTarget = preferredTargetFromOverview(overview, preferredTarget);
  if (!nextTarget) return;

  if (nextTarget.kind === "source") {
    await loadSourceSheet(nextTarget.sourceId);
    return;
  }

  await loadProjectEntry(nextTarget.projectId, nextTarget.entryId);
}

async function fetchStatusOnly() {
  if (!state.overview) return;

  const payload = await readJson(await fetch("/api/status"));
  state.overview.status = payload.status;
  state.overview.credentials = payload.credentials;
  renderSidebar();
  renderStatus();

  if (state.previousRunState === "running" && payload.status.state === "succeeded" && payload.status.sourceId) {
    await fetchOverview({ kind: "source", sourceId: payload.status.sourceId });
  }

  if (state.previousRunState === "running" && payload.status.state === "failed") {
    showMessage(payload.status.error || "The last run failed.");
  }

  state.previousRunState = payload.status.state;
}

async function loadSourceSheet(sourceId) {
  state.activeTarget = { kind: "source", sourceId };
  state.selectedCell = null;
  state.selectedRowIndex = null;
  state.sheet = await readJson(await fetch(`/api/data?source=${encodeURIComponent(sourceId)}`));
  renderSidebar();
  renderSheet();
}

async function loadProjectEntry(projectId, entryId) {
  state.activeTarget = { kind: "projectEntry", projectId, entryId };
  state.selectedCell = null;
  state.selectedRowIndex = null;
  state.sheet = await readJson(
    await fetch(`/api/project-entry?projectId=${encodeURIComponent(projectId)}&entryId=${encodeURIComponent(entryId)}`),
  );
  renderSidebar();
  renderSheet();
}

function renderSidebar() {
  if (!state.overview) return;

  const { actions, sources, projects, credentials, status } = state.overview;

  elements.apifyReady.textContent = credentials.apify ? "Ready" : "Missing";
  elements.firecrawlReady.textContent = credentials.firecrawl ? "Ready" : "Missing";
  elements.apifyReady.className = credentials.apify ? "ready" : "missing";
  elements.firecrawlReady.className = credentials.firecrawl ? "ready" : "missing";

  elements.actionList.innerHTML = "";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.className = "action-card";
    button.disabled = status.state === "running";
    button.innerHTML = `
      <div class="card-title-row">
        <strong>${escapeHtml(action.label)}</strong>
        <span class="card-tag">${escapeHtml(action.budget)}</span>
      </div>
      <p>${escapeHtml(action.description)}</p>
    `;
    button.addEventListener("click", () => runAction(action.id));
    elements.actionList.appendChild(button);
  });

  elements.sourceList.innerHTML = "";
  sources.forEach((source) => {
    const button = document.createElement("button");
    button.className = `source-card${activeTargetMatchesSource(source.id) ? " active" : ""}`;
    button.innerHTML = `
      <div class="card-title-row">
        <strong>${escapeHtml(source.label)}</strong>
        <span class="card-tag">${source.rowCount} rows</span>
      </div>
      <p>${escapeHtml(source.description)}</p>
      <div class="card-meta-row">
        <span class="card-tag">${escapeHtml(relativeTime(source.updatedAt))}</span>
        ${source.actionId ? '<span class="card-tag">Runnable</span>' : ""}
      </div>
    `;
    button.addEventListener("click", () => loadSourceSheet(source.id));
    elements.sourceList.appendChild(button);
  });

  elements.projectList.innerHTML = "";

  if (!projects.length) {
    elements.projectList.innerHTML = `<p class="subtitle">Create a project folder to organize saved scrapes.</p>`;
  }

  projects.forEach((project) => {
    const card = document.createElement("div");
    const isActiveProject =
      state.activeTarget?.kind === "projectEntry" && state.activeTarget.projectId === project.id;
    card.className = `project-card${isActiveProject ? " active" : ""}`;

    const entryMarkup = project.entries.length
      ? project.entries
          .map(
            (entry) => `
              <button class="project-entry${activeTargetMatchesEntry(project.id, entry.id) ? " active" : ""}" type="button" data-project-entry="${project.id}::${entry.id}">
                <strong>${escapeHtml(entry.label)}</strong>
                <small>${entry.rowCount} rows · ${escapeHtml(relativeTime(entry.savedAt))}</small>
              </button>
            `,
          )
          .join("")
      : `<p class="subtitle">No saved scrapes in this folder yet.</p>`;

    card.innerHTML = `
      <div class="project-header">
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <div class="project-meta">
            <span class="card-tag">${project.entryCount} files</span>
            <span class="card-tag">${escapeHtml(relativeTime(project.updatedAt))}</span>
          </div>
        </div>
        <div class="project-actions">
          <button class="mini-button" type="button" data-save-project="${project.id}" ${hasCurrentSelection() && status.state !== "running" ? "" : "disabled"}>
            Save current
          </button>
        </div>
      </div>
      <div class="project-entry-list">${entryMarkup}</div>
    `;

    elements.projectList.appendChild(card);
  });

  elements.projectList.querySelectorAll("[data-save-project]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const projectId = event.currentTarget.dataset.saveProject;
      saveCurrentToProject(projectId);
    });
  });

  elements.projectList.querySelectorAll("[data-project-entry]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const [projectId, entryId] = event.currentTarget.dataset.projectEntry.split("::");
      loadProjectEntry(projectId, entryId).catch((error) => showMessage(error.message || "Unable to open that saved scrape."));
    });
  });
}

function renderStatus() {
  if (!state.overview) return;

  const status = state.overview.status;
  elements.runStatePill.textContent = status.state;
  elements.runStatePill.className = `status-pill ${status.state}`;
  elements.logConsole.textContent = status.logs?.length ? status.logs.join("\n") : "No run logs yet.";
  elements.enrichContacts.disabled =
    status.state === "running" || !hasCurrentSelection() || !state.overview.credentials.apify;
}

function currentRows() {
  if (!state.sheet) return [];

  const search = state.search.trim().toLowerCase();
  let rows = state.sheet.rows;

  if (state.contactFilter === "with_contact") {
    rows = rows.filter((row) => rowHasContactInfo(row));
  }

  if (state.contactFilter === "with_phone") {
    rows = rows.filter((row) => rowHasPhone(row));
  }

  if (search) {
    rows = rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(search)));
  }

  if (state.rowLimit !== "all") {
    rows = rows.slice(0, Number(state.rowLimit));
  }

  return rows;
}

function renderSheet() {
  if (!state.sheet) return;

  const rows = currentRows();
  const columns = state.sheet.columns;

  elements.sheetTitle.textContent = state.sheet.title;
  elements.sheetDescription.textContent = state.sheet.description;
  elements.contactStackNote.textContent =
    state.sheet.sourceRefId === "contact_enriched_leads"
      ? "Phone numbers marked actor-returned came from direct LinkedIn profile enrichment. Public-site numbers are not independently verified."
      : "Load a dataset, click Enrich contacts, then use the Contacts filter to isolate cold-call-ready leads.";
  elements.visibleCount.textContent = String(rows.length);
  elements.columnCount.textContent = String(columns.length);
  elements.updatedAt.textContent = relativeTime(state.sheet.updatedAt);

  elements.downloadCsv.disabled = !state.sheet.csvUrl;
  elements.downloadJson.disabled = !state.sheet.jsonUrl;

  if (!columns.length || !rows.length) {
    elements.sheetEmpty.classList.remove("hidden");
    elements.sheetWrap.classList.add("hidden");
    elements.activeCellName.textContent = "Select a cell";
    elements.activeCellValue.textContent = "The selected cell value will appear here.";
    elements.rowInspector.innerHTML = "<p>No rows available for this dataset yet.</p>";
    return;
  }

  elements.sheetEmpty.classList.add("hidden");
  elements.sheetWrap.classList.remove("hidden");

  const headerCells = columns
    .map(
      (column, index) => `
        <th>
          <span class="header-letter">${sheetColumnLabel(index)}</span>
          <span class="header-name">${escapeHtml(column.replaceAll("_", " "))}</span>
        </th>
      `,
    )
    .join("");

  const bodyRows = rows
    .map((row, rowIndex) => {
      const cells = columns
        .map((column) => {
          const value = row[column] || "";
          const isSelected =
            state.selectedCell &&
            state.selectedCell.rowIndex === rowIndex &&
            state.selectedCell.column === column;

          return `
            <td class="${isSelected ? "selected" : ""}" data-row="${rowIndex}" data-column="${escapeHtml(column)}">
              <button type="button" data-row="${rowIndex}" data-column="${escapeHtml(column)}">
                <div class="cell-value">${escapeHtml(value)}</div>
              </button>
            </td>
          `;
        })
        .join("");

      return `
        <tr data-row-index="${rowIndex}">
          <td class="row-number">${rowIndex + 2}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  elements.sheetTable.innerHTML = `
    <thead>
      <tr>
        <th class="corner-cell">#</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  `;

  elements.sheetTable.querySelectorAll("td button").forEach((button) => {
    button.addEventListener("click", () => {
      const rowIndex = Number(button.dataset.row);
      const column = button.dataset.column;
      state.selectedCell = { rowIndex, column };
      state.selectedRowIndex = rowIndex;
      updateSelection(rows, columns);
    });
  });

  if (state.selectedRowIndex !== null && rows[state.selectedRowIndex]) {
    updateSelection(rows, columns);
  } else {
    state.selectedCell = null;
    state.selectedRowIndex = null;
    elements.activeCellName.textContent = "Select a cell";
    elements.activeCellValue.textContent = "The selected cell value will appear here.";
    elements.rowInspector.innerHTML = "<p>Select a row to inspect full values and open the evidence URL.</p>";
  }
}

function updateSelection(rows, columns) {
  if (!state.selectedCell || !rows[state.selectedCell.rowIndex]) {
    renderSheet();
    return;
  }

  const row = rows[state.selectedCell.rowIndex];
  const cellValue = row[state.selectedCell.column] || "";
  const columnIndex = columns.indexOf(state.selectedCell.column);
  elements.activeCellName.textContent = `${sheetColumnLabel(columnIndex)}${state.selectedCell.rowIndex + 2}`;
  elements.activeCellValue.textContent = cellValue || "Empty cell";

  const items = Object.entries(row)
    .slice(0, 14)
    .map(([key, value]) => {
      const safeValue = escapeHtml(String(value || ""));
      const evidenceLink = /https?:\/\//.test(String(value || ""))
        ? `<a href="${safeValue}" target="_blank" rel="noreferrer">${safeValue}</a>`
        : `<strong>${safeValue || "—"}</strong>`;

      return `
        <div class="inspector-item">
          <span>${escapeHtml(key.replaceAll("_", " "))}</span>
          ${evidenceLink}
        </div>
      `;
    })
    .join("");

  elements.rowInspector.innerHTML = items;

  elements.sheetTable.querySelectorAll("td").forEach((cell) => cell.classList.remove("selected"));
  elements.sheetTable
    .querySelectorAll(`td[data-row="${state.selectedCell.rowIndex}"][data-column="${CSS.escape(state.selectedCell.column)}"]`)
    .forEach((cell) => cell.classList.add("selected"));
}

async function runAction(actionId) {
  try {
    const payload = await readJson(
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId }),
      }),
    );

    state.overview.status = payload.status;
    state.previousRunState = payload.status.state;
    renderSidebar();
    renderStatus();
  } catch (error) {
    showMessage(error.message || "Unable to start the requested scrape.");
  }
}

async function createProject() {
  const name = elements.projectNameInput.value.trim();
  if (!name) {
    showMessage("Enter a project folder name first.");
    return;
  }

  try {
    const payload = await readJson(
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );

    state.overview.projects = payload.projects;
    elements.projectNameInput.value = "";
    renderSidebar();
  } catch (error) {
    showMessage(error.message || "Unable to create the project folder.");
  }
}

async function saveCurrentToProject(projectId) {
  if (!state.activeTarget) {
    showMessage("Load a dataset first, then save it into a project folder.");
    return;
  }

  const body =
    state.activeTarget.kind === "source"
      ? { projectId, sourceId: state.activeTarget.sourceId }
      : {
          projectId,
          fromProjectId: state.activeTarget.projectId,
          entryId: state.activeTarget.entryId,
        };

  try {
    const payload = await readJson(
      await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    state.overview.projects = payload.projects;
    renderSidebar();
    await loadProjectEntry(payload.projectId, payload.entryId);
  } catch (error) {
    showMessage(error.message || "Unable to save this scrape to the selected project.");
  }
}

async function enrichCurrentSelection() {
  if (!state.activeTarget) {
    showMessage("Load a dataset first, then run contact enrichment.");
    return;
  }

  const body =
    state.activeTarget.kind === "source"
      ? { sourceId: state.activeTarget.sourceId }
      : {
          projectId: state.activeTarget.projectId,
          entryId: state.activeTarget.entryId,
        };

  try {
    const payload = await readJson(
      await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    state.overview.status = payload.status;
    state.previousRunState = payload.status.state;
    renderSidebar();
    renderStatus();
  } catch (error) {
    showMessage(error.message || "Unable to start contact enrichment.");
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === elements.sheetWorkspace) {
      await document.exitFullscreen();
      return;
    }

    await elements.sheetWorkspace.requestFullscreen();
  } catch (error) {
    showMessage(error.message || "Fullscreen mode is not available here.");
  }
}

function updateFullscreenButton() {
  elements.fullscreenButton.textContent =
    document.fullscreenElement === elements.sheetWorkspace ? "Exit fullscreen" : "Fullscreen leads";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderSheet();
});

elements.rowLimitSelect.addEventListener("change", (event) => {
  state.rowLimit = event.target.value;
  renderSheet();
});

elements.contactFilterSelect.addEventListener("change", (event) => {
  state.contactFilter = event.target.value;
  renderSheet();
});

elements.refreshOverview.addEventListener("click", () => {
  fetchOverview(state.activeTarget).catch((error) => showMessage(error.message || "Unable to refresh the workspace."));
});

elements.downloadCsv.addEventListener("click", () => {
  if (!state.sheet?.csvUrl) return;
  window.open(state.sheet.csvUrl, "_blank");
});

elements.downloadJson.addEventListener("click", () => {
  if (!state.sheet?.jsonUrl) return;
  window.open(state.sheet.jsonUrl, "_blank");
});

elements.enrichContacts.addEventListener("click", () => {
  enrichCurrentSelection().catch((error) => showMessage(error.message || "Unable to enrich contacts."));
});

elements.createProjectButton.addEventListener("click", () => {
  createProject().catch((error) => showMessage(error.message || "Unable to create the project."));
});

elements.projectNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    createProject().catch((error) => showMessage(error.message || "Unable to create the project."));
  }
});

elements.fullscreenButton.addEventListener("click", () => {
  toggleFullscreen().catch((error) => showMessage(error.message || "Unable to toggle fullscreen."));
});

document.addEventListener("fullscreenchange", updateFullscreenButton);

setInterval(() => {
  fetchStatusOnly().catch(() => {});
}, 3000);

updateFullscreenButton();

fetchOverview().catch((error) => {
  showMessage(error.message || "Unable to boot Hot Leads Studio.");
});

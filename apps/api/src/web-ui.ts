export function getWebUiHtml(): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RepoWatcher Local UI</title>
    <style>
      :root {
        --bg-0: #08101a;
        --bg-1: #0f1b2a;
        --panel: #ffffff;
        --panel-soft: #f8fafc;
        --border: rgba(148, 163, 184, 0.22);
        --text: #0f172a;
        --muted: #475569;
        --ok: #22c55e;
        --err: #ef4444;
        --accent: #38bdf8;
        --accent-2: #2563eb;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        height: 100%;
      }

      body {
        font-family: "Satoshi", "Avenir Next", "Manrope", "Segoe UI", sans-serif;
        color: #e6edf3;
        background:
          radial-gradient(1200px 700px at -10% -20%, #173354 0%, transparent 70%),
          radial-gradient(900px 600px at 120% 0%, #12355f 0%, transparent 65%),
          linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%);
      }

      .workspace {
        height: 100vh;
        padding: 14px;
        display: grid;
        gap: 14px;
        grid-template-columns: minmax(520px, 1.4fr) minmax(360px, 1fr);
      }

      .column {
        min-height: 0;
      }

      .left-column {
        display: grid;
        grid-template-rows: auto 1fr;
        gap: 12px;
        min-height: 0;
      }

      .left-scroll {
        min-height: 0;
        overflow: auto;
        display: grid;
        gap: 12px;
        padding-right: 4px;
      }

      .card {
        background: var(--panel);
        border: 2px solid #94a3b8;
        border-radius: 14px;
        padding: 12px;
        color: var(--text);
        box-shadow: 0 14px 35px rgba(2, 6, 23, 0.22);
      }

      .title {
        margin: 0;
        font-size: 1rem;
        letter-spacing: 0.01em;
      }

      .subtle {
        margin: 4px 0 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .row {
        display: grid;
        gap: 10px;
      }

      .row.two {
        grid-template-columns: 1fr auto;
      }

      .row.graph-config {
        grid-template-columns: 1fr auto auto auto;
      }

      .split {
        display: grid;
        gap: 10px;
        grid-template-columns: 1fr 1fr;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 0.86rem;
      }

      input,
      textarea,
      button {
        font: inherit;
      }

      input,
      textarea {
        width: 100%;
        border: 2px solid #94a3b8;
        border-radius: 10px;
        padding: 10px;
        background: var(--panel-soft);
        color: var(--text);
      }

      textarea {
        resize: vertical;
      }

      button {
        border: 1px solid var(--accent-2);
        background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
        color: #fff;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
      }

      button.secondary {
        background: #e2e8f0;
        border-color: #94a3b8;
        color: #0f172a;
      }

      button:disabled {
        opacity: 0.58;
        cursor: not-allowed;
      }

      .status {
        margin-top: 4px;
        font-size: 0.9rem;
      }

      .status.ok {
        color: var(--ok);
      }

      .status.err {
        color: var(--err);
      }

      .meta-grid {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 0.84rem;
      }

      .code-box {
        border: 2px solid #94a3b8;
        border-radius: 10px;
        background: #f8fafc;
        padding: 10px;
      }

      .scroll-box {
        max-height: 260px;
        overflow: auto;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        font-size: 0.84rem;
      }

      .graph-viewport {
        border: 3px solid #475569;
        border-radius: 12px;
        background: #ffffff;
        background-image:
          linear-gradient(#e2e8f0 1px, transparent 1px),
          linear-gradient(90deg, #e2e8f0 1px, transparent 1px);
        background-size: 24px 24px;
        height: 450px;
        overflow: hidden;
        position: relative;
        cursor: grab;
      }

      .graph-viewport.dragging {
        cursor: grabbing;
      }

      #graphSvg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .graph-toolbar {
        margin-top: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .graph-controls {
        display: inline-flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .graph-controls button {
        padding: 8px 11px;
      }

      .graph-hint {
        color: #334155;
        font-size: 0.8rem;
      }

      .graph-main {
        margin-top: 10px;
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
        min-height: 0;
      }

      .graph-inspector {
        border: 2px solid #64748b;
        border-radius: 12px;
        background: #f8fafc;
        padding: 10px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 8px;
        min-height: 450px;
      }

      .graph-inspector .inspector-title {
        margin: 0;
        font-size: 0.92rem;
        color: #0f172a;
      }

      .graph-inspector .inspector-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .graph-inspector .inspector-chip {
        border-radius: 999px;
        border: 1px solid #94a3b8;
        background: #ffffff;
        color: #0f172a;
        font-size: 0.74rem;
        padding: 3px 8px;
      }

      .graph-inspector .inspector-chip.risk-high {
        border-color: #dc2626;
        background: #fef2f2;
        color: #991b1b;
      }

      .graph-inspector .inspector-chip.risk-medium {
        border-color: #d97706;
        background: #fffbeb;
        color: #92400e;
      }

      .graph-inspector .inspector-body {
        min-height: 0;
        overflow: auto;
      }

      .graph-search {
        margin-top: 8px;
        display: grid;
        grid-template-columns: minmax(160px, 1fr) auto auto auto;
        gap: 8px;
      }

      .graph-search input {
        height: 38px;
      }

      .graph-switches {
        display: inline-flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .graph-switches label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #94a3b8;
        background: #f8fafc;
        border-radius: 999px;
        padding: 6px 10px;
        color: #0f172a;
        font-size: 0.8rem;
      }

      .graph-switches input {
        width: auto;
        margin: 0;
      }

      .chip-section {
        margin-top: 8px;
        display: grid;
        gap: 8px;
      }

      .chip-title {
        font-size: 0.82rem;
        color: #334155;
      }

      .chip-list {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .chip-btn {
        border: 1px solid #64748b;
        border-radius: 999px;
        background: #f8fafc;
        color: #0f172a;
        padding: 5px 9px;
        font-size: 0.78rem;
        cursor: pointer;
      }

      .chip-btn.risk-high {
        border-color: #dc2626;
        background: #fef2f2;
        color: #991b1b;
      }

      .chip-btn.risk-medium {
        border-color: #d97706;
        background: #fffbeb;
        color: #92400e;
      }

      .right-column {
        min-height: 0;
      }

      .chat-shell {
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 10px;
      }

      .chat-log {
        min-height: 0;
        overflow: auto;
        display: grid;
        gap: 10px;
        align-content: start;
      }

      .message {
        border: 2px solid #94a3b8;
        border-radius: 10px;
        padding: 10px;
        background: #ffffff;
        color: #0f172a;
      }

      .message.assistant {
        background: #f8fbff;
        border-color: #38bdf8;
      }

      .message .meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: var(--muted);
        font-size: 0.8rem;
        margin-bottom: 6px;
      }

      .chat-input {
        display: grid;
        gap: 10px;
      }

      .chat-input textarea {
        min-height: 84px;
      }

      .chat-actions {
        display: flex;
        justify-content: flex-end;
      }

      .md-body {
        font-size: 0.93rem;
        line-height: 1.5;
        color: #0f172a;
        display: grid;
        gap: 8px;
      }

      .md-body h1,
      .md-body h2,
      .md-body h3 {
        margin: 0;
        line-height: 1.25;
      }

      .md-body h1 {
        font-size: 1.05rem;
        color: #0f172a;
      }

      .md-body h2 {
        font-size: 0.98rem;
        color: #1d4ed8;
      }

      .md-body h3 {
        font-size: 0.93rem;
        color: #0f766e;
      }

      .md-body p {
        margin: 0;
        color: #1e293b;
      }

      .md-body ul {
        margin: 0;
        padding-left: 1.1rem;
        color: #1e293b;
      }

      .md-body li {
        margin: 2px 0;
      }

      .md-body .md-quote {
        border-left: 4px solid #60a5fa;
        padding: 6px 10px;
        background: #eff6ff;
        border-radius: 6px;
        color: #1e3a8a;
      }

      .md-body .md-inline {
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        font-size: 0.86rem;
        background: #e2e8f0;
        border: 1px solid #94a3b8;
        border-radius: 4px;
        padding: 0 4px;
      }

      .md-body .md-code {
        margin: 0;
        border: 2px solid #94a3b8;
        border-radius: 8px;
        background: #0f172a;
        color: #e2e8f0;
        padding: 10px;
        overflow: auto;
      }

      .md-body .md-code code {
        white-space: pre;
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        font-size: 0.84rem;
      }

      .md-body a {
        color: #1d4ed8;
        text-decoration: underline;
      }

      .wait-loader {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        color: #334155;
        font-size: 0.85rem;
      }

      .jump-head {
        display: inline-block;
        font-size: 1.1rem;
        animation: head-bounce 0.7s ease-in-out infinite;
      }

      @keyframes head-bounce {
        0%, 100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
      }

      @media (max-width: 1180px) {
        .workspace {
          grid-template-columns: 1fr;
          grid-template-rows: auto auto;
          height: auto;
          min-height: 100vh;
        }

        .left-column {
          grid-template-rows: auto;
        }

        .right-column {
          min-height: 70vh;
        }
      }

      @media (max-width: 900px) {
        .row.two,
        .row.graph-config,
        .split,
        .graph-main,
        .graph-search {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="workspace">
      <section class="column left-column">
        <section class="card">
          <h1 class="title">RepoWatcher Local UI</h1>
          <p class="subtle">Session locale, scan automatique du repo, schema interactif et onboarding technique guide.</p>
        </section>

        <div class="left-scroll">
          <section class="card row two">
            <label>
              Repo local path
              <input id="repoPath" type="text" placeholder="/Users/.../my-repo" />
            </label>
            <div style="display:flex; align-items:end; gap:8px;">
              <button id="createSessionBtn">Creer session</button>
            </div>
          </section>

          <section class="card row two">
            <div>
              <div><strong>Session ID:</strong> <span id="sessionId">-</span></div>
              <div id="status" class="status">Pret.</div>
            </div>
            <div style="display:flex; align-items:end; gap:8px;">
              <button id="clearBtn" class="secondary">Clear chat</button>
            </div>
          </section>

          <section class="card">
            <h2 class="title">Schema interactif du repo</h2>
            <p class="subtle">Pan/zoom + clic fichier pour explication IA.</p>
            <div class="row graph-config" style="margin-top: 8px;">
              <label style="grid-column: 1 / 2;">
                Root path
                <input id="graphRootPath" type="text" value="." />
              </label>
              <label>
                Max nodes
                <input id="graphMaxNodes" type="number" min="20" max="400" value="180" />
              </label>
              <div style="display:flex; align-items:end;">
                <button id="generateGraphBtn" class="secondary" disabled>Generer schema</button>
              </div>
              <div></div>
            </div>
            <div id="graphSummary" class="meta-grid" style="margin-top: 8px;"></div>
            <div class="chip-section">
              <div>
                <div class="chip-title">Fichiers clés</div>
                <div id="graphKeyFiles" class="chip-list"></div>
              </div>
              <div>
                <div class="chip-title">Zones de risque</div>
                <div id="graphRiskFiles" class="chip-list"></div>
              </div>
              <div>
                <div class="chip-title">Parcours d'exploration</div>
                <div id="graphTrail" class="chip-list"></div>
              </div>
            </div>
            <div class="graph-toolbar">
              <div class="graph-controls">
                <button id="fitGraphBtn" class="secondary" type="button">Fit view</button>
                <button id="clearTrailBtn" class="secondary" type="button">Clear trail</button>
              </div>
              <div class="graph-switches">
                <label><input id="toggleImportEdges" type="checkbox" checked />Imports</label>
                <label><input id="toggleFlowEdges" type="checkbox" checked />User flow</label>
              </div>
              <div class="graph-hint">Bleu = user flow • Gris = imports techniques</div>
            </div>
            <div class="graph-search">
              <input id="graphSearchInput" type="text" placeholder="Rechercher un fichier (path, nom, role)" />
              <button id="searchGraphBtn" class="secondary" type="button">Rechercher</button>
              <button id="tourPrevBtn" class="secondary" type="button" disabled>Tour prev</button>
              <button id="tourNextBtn" class="secondary" type="button" disabled>Tour next</button>
            </div>
            <div class="graph-main">
              <div>
                <div id="graphViewport" class="graph-viewport">
                  <svg id="graphSvg" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid meet">
                    <defs>
                      <linearGradient id="edge-flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#1d4ed8" />
                        <stop offset="100%" stop-color="#0ea5e9" />
                      </linearGradient>
                      <marker
                        id="edge-flow-arrow"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0ea5e9" />
                      </marker>
                    </defs>
                    <g id="graphLayer"></g>
                  </svg>
                </div>
              </div>
              <aside class="graph-inspector">
                <h3 id="inspectorTitle" class="inspector-title">Inspector: sélectionne un fichier</h3>
                <div id="inspectorMeta" class="inspector-meta"></div>
                <div id="inspectorBody" class="inspector-body md-body">
                  <p>Le panneau affiche ici l'explication pédagogique, les fonctions clés, variables, imports/exports et risques.</p>
                </div>
              </aside>
            </div>
            <div class="graph-toolbar">
              <div class="graph-controls">
                <button id="tourStartBtn" class="secondary" type="button">Start guided tour</button>
              </div>
              <div id="tourStatus" class="graph-hint">Tour inactif</div>
            </div>
          </section>
        </div>
      </section>

      <aside class="column right-column">
        <section class="card chat-shell">
          <div>
            <h2 class="title">Chat IA</h2>
            <p class="subtle">Conversations en direct avec rendu progressif des reponses.</p>
          </div>
          <div id="chatLog" class="chat-log"></div>
          <div class="chat-input">
            <label>
              Message
              <textarea id="messageInput" placeholder="Ex: analyse ce repo et propose les checks a lancer"></textarea>
            </label>
            <div class="chat-actions">
              <button id="sendBtn" disabled>Envoyer</button>
            </div>
          </div>
        </section>
      </aside>
    </main>

    <script>
      const state = {
        apiBase: window.location.origin,
        repoPath: window.localStorage.getItem("repoWatcherRepoPath") || "",
        sessionId: null
      };

      const graphView = { x: 30, y: 30, scale: 0.9 };
      const graphFilters = { showImports: true, showFlow: true };
      let currentGraphData = null;
      let selectedNodeId = null;
      const clickedTrail = [];
      const tourState = { paths: [], index: -1 };
      let dragState = null;
      let inspectorRequestId = 0;

      const repoPathEl = document.getElementById("repoPath");
      const createSessionBtn = document.getElementById("createSessionBtn");
      const sendBtn = document.getElementById("sendBtn");
      const clearBtn = document.getElementById("clearBtn");
      const sessionIdEl = document.getElementById("sessionId");
      const statusEl = document.getElementById("status");
      const messageInputEl = document.getElementById("messageInput");
      const chatLogEl = document.getElementById("chatLog");

      const graphRootPathEl = document.getElementById("graphRootPath");
      const graphMaxNodesEl = document.getElementById("graphMaxNodes");
      const generateGraphBtn = document.getElementById("generateGraphBtn");
      const graphSummaryEl = document.getElementById("graphSummary");
      const graphKeyFilesEl = document.getElementById("graphKeyFiles");
      const graphRiskFilesEl = document.getElementById("graphRiskFiles");
      const graphTrailEl = document.getElementById("graphTrail");
      const graphSearchInputEl = document.getElementById("graphSearchInput");
      const searchGraphBtn = document.getElementById("searchGraphBtn");
      const graphViewportEl = document.getElementById("graphViewport");
      const graphLayerEl = document.getElementById("graphLayer");
      const fitGraphBtn = document.getElementById("fitGraphBtn");
      const clearTrailBtn = document.getElementById("clearTrailBtn");
      const toggleImportEdgesEl = document.getElementById("toggleImportEdges");
      const toggleFlowEdgesEl = document.getElementById("toggleFlowEdges");
      const inspectorTitleEl = document.getElementById("inspectorTitle");
      const inspectorMetaEl = document.getElementById("inspectorMeta");
      const inspectorBodyEl = document.getElementById("inspectorBody");
      const tourStartBtn = document.getElementById("tourStartBtn");
      const tourPrevBtn = document.getElementById("tourPrevBtn");
      const tourNextBtn = document.getElementById("tourNextBtn");
      const tourStatusEl = document.getElementById("tourStatus");

      function setStatus(message, type) {
        statusEl.textContent = message;
        statusEl.className = "status";
        if (type) statusEl.classList.add(type);
      }

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function resetGraphPanels() {
        currentGraphData = null;
        selectedNodeId = null;
        clickedTrail.length = 0;
        tourState.paths = [];
        tourState.index = -1;
        graphFilters.showImports = true;
        graphFilters.showFlow = true;
        if (toggleImportEdgesEl) toggleImportEdgesEl.checked = true;
        if (toggleFlowEdgesEl) toggleFlowEdgesEl.checked = true;
        graphSummaryEl.textContent = "";
        if (graphKeyFilesEl) graphKeyFilesEl.innerHTML = "";
        if (graphRiskFilesEl) graphRiskFilesEl.innerHTML = "";
        if (graphTrailEl) graphTrailEl.innerHTML = "";
        if (graphLayerEl) graphLayerEl.innerHTML = "";
        syncTourStatus();
        setInspectorPlaceholder(
          "Inspector: sélectionne un fichier",
          "<p>Le panneau affiche ici l'explication pédagogique, les fonctions clés, variables, imports/exports et risques.</p>"
        );
      }

      function renderTrailChips() {
        if (!graphTrailEl) return;
        graphTrailEl.innerHTML = "";
        if (clickedTrail.length === 0) {
          const chip = document.createElement("span");
          chip.className = "chip-btn";
          chip.textContent = "Aucun fichier sélectionné";
          graphTrailEl.appendChild(chip);
          return;
        }

        for (const filePath of clickedTrail) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip-btn";
          chip.dataset.filePath = filePath;
          chip.textContent = filePath;
          graphTrailEl.appendChild(chip);
        }
      }

      function pushTrailPath(filePath) {
        if (!filePath) return;
        if (clickedTrail[clickedTrail.length - 1] === filePath) {
          renderTrailChips();
          return;
        }

        clickedTrail.push(filePath);
        if (clickedTrail.length > 8) {
          clickedTrail.shift();
        }
        renderTrailChips();
      }

      function updateSessionState() {
        const hasSession = Boolean(state.sessionId);
        sessionIdEl.textContent = state.sessionId || "-";
        sendBtn.disabled = !hasSession;
        generateGraphBtn.disabled = !hasSession;
        if (tourStartBtn) tourStartBtn.disabled = !hasSession;
        if (searchGraphBtn) searchGraphBtn.disabled = !hasSession;
      }

      function syncTourStatus() {
        const hasTour = tourState.paths.length > 0 && tourState.index >= 0;
        if (tourPrevBtn) {
          tourPrevBtn.disabled = !hasTour || tourState.index <= 0;
        }
        if (tourNextBtn) {
          tourNextBtn.disabled = !hasTour || tourState.index >= tourState.paths.length - 1;
        }
        if (!tourStatusEl) return;

        if (!hasTour) {
          tourStatusEl.textContent = "Tour inactif";
          return;
        }

        const currentPath = tourState.paths[tourState.index] || "-";
        tourStatusEl.textContent =
          "Tour " +
          (tourState.index + 1) +
          "/" +
          tourState.paths.length +
          " • " +
          truncateMiddle(currentPath, 58);
      }

      function setInspectorPlaceholder(title, contentHtml) {
        if (inspectorTitleEl) {
          inspectorTitleEl.textContent = title;
        }
        if (inspectorMetaEl) {
          inspectorMetaEl.innerHTML = "";
        }
        if (inspectorBodyEl) {
          inspectorBodyEl.innerHTML = contentHtml;
        }
      }

      function centerNodeInView(node) {
        if (!node || !graphViewportEl) return;
        const nodeWidth = 236;
        const nodeHeight = 56;
        const viewportWidth = graphViewportEl.clientWidth || 1;
        const viewportHeight = graphViewportEl.clientHeight || 1;
        graphView.x = viewportWidth / 2 - (node.position.x + nodeWidth / 2) * graphView.scale;
        graphView.y = viewportHeight / 2 - (node.position.y + nodeHeight / 2) * graphView.scale;
        applyGraphTransform();
      }

      function renderInspectorContent(node, exp, mode) {
        if (inspectorTitleEl) {
          inspectorTitleEl.textContent = node.data.path;
        }
        if (inspectorMetaEl) {
          inspectorMetaEl.innerHTML = "";
          const addChip = (label, className) => {
            const chip = document.createElement("span");
            chip.className = "inspector-chip" + (className ? " " + className : "");
            chip.textContent = label;
            inspectorMetaEl.appendChild(chip);
          };
          addChip("role: " + (node.data.role || "module"), "");
          addChip("risk: " + (node.data.riskLevel || "low"), "risk-" + (node.data.riskLevel || "low"));
          addChip("importance: " + String(node.data.importance ?? 0), "");
          if (exp?.confidence) addChip("confidence: " + exp.confidence, "");
          if (mode) addChip("mode: " + mode, "");
        }
        const interactions = Array.isArray(exp?.interactions) ? exp.interactions.join("\\n- ") : "";
        const keyFunctions = Array.isArray(exp?.keyFunctions) ? exp.keyFunctions.join("\\n- ") : "";
        const keyVariables = Array.isArray(exp?.keyVariables) ? exp.keyVariables.join("\\n- ") : "";
        const imports = Array.isArray(exp?.imports) ? exp.imports.join("\\n- ") : "";
        const exportsList = Array.isArray(exp?.exports) ? exp.exports.join("\\n- ") : "";
        const risks = Array.isArray(exp?.risks) ? exp.risks.join("\\n- ") : "";
        const explainText = [
          "Pourquoi dans le flow:",
          exp?.whyInFlow || "",
          "",
          "Overview:",
          exp?.overview || "",
          "",
          "Utility in app:",
          exp?.utilityInApp || "",
          "",
          "Interactions:",
          interactions ? "- " + interactions : "- (none)",
          "",
          "Key functions:",
          keyFunctions ? "- " + keyFunctions : "- (none)",
          "",
          "Key variables:",
          keyVariables ? "- " + keyVariables : "- (none)",
          "",
          "Imports:",
          imports ? "- " + imports : "- (none)",
          "",
          "Exports:",
          exportsList ? "- " + exportsList : "- (none)",
          "",
          "Risks:",
          risks ? "- " + risks : "- (none)"
        ].join("\\n");
        if (inspectorBodyEl) {
          inspectorBodyEl.innerHTML = renderMarkdown(explainText);
        }
      }

      function buildGuidedTourPaths() {
        if (!currentGraphData || !Array.isArray(currentGraphData.nodes)) {
          return [];
        }

        const existingPaths = new Set(currentGraphData.nodes.map((node) => node.data.path));
        const summary = currentGraphData.summary || {};
        const byImportance = [...currentGraphData.nodes]
          .sort((a, b) => (b.data.importance || 0) - (a.data.importance || 0))
          .map((node) => node.data.path);
        const candidates = [
          ...(Array.isArray(summary.keyFiles) ? summary.keyFiles : []),
          ...(Array.isArray(summary.riskFiles) ? summary.riskFiles : []),
          ...clickedTrail,
          ...byImportance
        ];

        const uniquePaths = [];
        const seen = new Set();
        for (const filePath of candidates) {
          if (!filePath || seen.has(filePath) || !existingPaths.has(filePath)) {
            continue;
          }
          seen.add(filePath);
          uniquePaths.push(filePath);
          if (uniquePaths.length >= 12) {
            break;
          }
        }
        return uniquePaths;
      }

      function findSearchMatches(query) {
        if (!currentGraphData || !Array.isArray(currentGraphData.nodes)) {
          return [];
        }
        const needle = String(query || "").trim().toLowerCase();
        if (!needle) {
          return [];
        }

        const scored = [];
        for (const node of currentGraphData.nodes) {
          const pathValue = String(node.data.path || "").toLowerCase();
          const label = String(node.data.label || "").toLowerCase();
          const role = String(node.data.role || "").toLowerCase();
          const directory = String(node.data.directory || "").toLowerCase();
          let score = 0;
          if (pathValue === needle) score += 12;
          if (pathValue.startsWith(needle)) score += 8;
          if (pathValue.includes("/" + needle)) score += 6;
          if (label === needle) score += 7;
          if (label.includes(needle)) score += 5;
          if (role.includes(needle)) score += 4;
          if (directory.includes(needle)) score += 3;
          if (pathValue.includes(needle)) score += 2;
          if (score > 0) {
            scored.push({ score, node });
          }
        }
        scored.sort(
          (a, b) =>
            b.score - a.score ||
            (b.node.data.importance || 0) - (a.node.data.importance || 0) ||
            a.node.data.path.localeCompare(b.node.data.path)
        );
        return scored.map((item) => item.node);
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatInline(markdownLine) {
        let line = escapeHtml(markdownLine);

        const applyDelimited = (input, delimiter, openTag, closeTag) => {
          const parts = input.split(delimiter);
          if (parts.length < 3) {
            return input;
          }
          return parts
            .map((part, index) => (index % 2 === 1 ? openTag + part + closeTag : part))
            .join("");
        };

        const renderLinks = (input) => {
          let output = "";
          let cursor = 0;
          while (cursor < input.length) {
            const openLabel = input.indexOf("[", cursor);
            if (openLabel < 0) {
              output += input.slice(cursor);
              break;
            }
            const closeLabel = input.indexOf("](", openLabel);
            if (closeLabel < 0) {
              output += input.slice(cursor);
              break;
            }
            const closeUrl = input.indexOf(")", closeLabel + 2);
            if (closeUrl < 0) {
              output += input.slice(cursor);
              break;
            }

            const label = input.slice(openLabel + 1, closeLabel);
            const url = input.slice(closeLabel + 2, closeUrl);
            const safeUrl = url.startsWith("http://") || url.startsWith("https://") ? url : "";
            output += input.slice(cursor, openLabel);
            if (safeUrl) {
              output +=
                '<a href="' +
                safeUrl +
                '" target="_blank" rel="noreferrer noopener">' +
                label +
                "</a>";
            } else {
              output += input.slice(openLabel, closeUrl + 1);
            }
            cursor = closeUrl + 1;
          }
          return output;
        };

        const backtick = String.fromCharCode(96);
        line = applyDelimited(line, backtick, '<code class="md-inline">', "</code>");
        line = applyDelimited(line, "**", "<strong>", "</strong>");
        line = applyDelimited(line, "*", "<em>", "</em>");
        line = renderLinks(line);
        return line;
      }

      function renderMarkdown(markdown) {
        const source = String(markdown || "").replaceAll("\\r\\n", "\\n");
        const lines = source.split("\\n");
        const blocks = [];
        let inList = false;
        let inCode = false;
        const codeLines = [];
        const codeFence = String.fromCharCode(96).repeat(3);

        const closeList = () => {
          if (inList) {
            blocks.push("</ul>");
            inList = false;
          }
        };

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();

          if (trimmed.startsWith(codeFence)) {
            closeList();
            if (!inCode) {
              inCode = true;
              codeLines.length = 0;
            } else {
              blocks.push(
                '<pre class="md-code"><code>' + escapeHtml(codeLines.join("\\n")) + "</code></pre>"
              );
              inCode = false;
            }
            continue;
          }

          if (inCode) {
            codeLines.push(rawLine);
            continue;
          }

          if (!trimmed) {
            closeList();
            continue;
          }

          if (trimmed.startsWith("### ")) {
            closeList();
            blocks.push("<h3>" + formatInline(trimmed.slice(4)) + "</h3>");
            continue;
          }
          if (trimmed.startsWith("## ")) {
            closeList();
            blocks.push("<h2>" + formatInline(trimmed.slice(3)) + "</h2>");
            continue;
          }
          if (trimmed.startsWith("# ")) {
            closeList();
            blocks.push("<h1>" + formatInline(trimmed.slice(2)) + "</h1>");
            continue;
          }
          if (trimmed.startsWith("> ")) {
            closeList();
            blocks.push('<div class="md-quote">' + formatInline(trimmed.slice(2)) + "</div>");
            continue;
          }
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            if (!inList) {
              blocks.push("<ul>");
              inList = true;
            }
            blocks.push("<li>" + formatInline(trimmed.slice(2)) + "</li>");
            continue;
          }

          closeList();
          blocks.push("<p>" + formatInline(trimmed) + "</p>");
        }

        if (inCode) {
          blocks.push('<pre class="md-code"><code>' + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
        }

        closeList();
        return blocks.join("");
      }

      function appendChatMessage(role, text, meta, extraClass) {
        const card = document.createElement("div");
        card.className = "message" + (extraClass ? " " + extraClass : "");

        const metaDiv = document.createElement("div");
        metaDiv.className = "meta";
        const left = document.createElement("span");
        left.textContent = role;
        const right = document.createElement("span");
        right.textContent = meta || "";
        metaDiv.append(left, right);

        const body = document.createElement("div");
        body.className = "md-body";
        body.innerHTML = renderMarkdown(text || "");

        card.append(metaDiv, body);
        chatLogEl.appendChild(card);
        chatLogEl.scrollTop = chatLogEl.scrollHeight;

        const updateScroll = () => {
          chatLogEl.scrollTop = chatLogEl.scrollHeight;
        };

        return {
          card,
          body,
          rawText: text || "",
          setMeta(nextMeta) {
            right.textContent = nextMeta || "";
          },
          setLoading(active) {
            const existing = card.querySelector(".wait-loader");
            if (active) {
              if (!existing) {
                const loader = document.createElement("div");
                loader.className = "wait-loader";
                loader.innerHTML =
                  '<span class="jump-head" aria-hidden="true">🙂</span><span>Réponse en cours...</span>';
                card.insertBefore(loader, body);
              }
            } else if (existing) {
              existing.remove();
            }
            updateScroll();
          },
          setText(nextText) {
            this.rawText = String(nextText || "");
            body.innerHTML = renderMarkdown(this.rawText);
            updateScroll();
          },
          appendText(chunk) {
            this.setText((this.rawText || "") + String(chunk || ""));
          }
        };
      }

      async function streamText(messageView, fullText) {
        const text = String(fullText || "");
        if (!text) {
          messageView.setText("(empty response)");
          return;
        }
        messageView.setText("");

        const total = text.length;
        const chunkSize = total > 2600 ? 44 : total > 1200 ? 28 : 16;
        const delay = total > 2600 ? 8 : 14;

        for (let i = 0; i < total; i += chunkSize) {
          messageView.appendText(text.slice(i, i + chunkSize));
          await sleep(delay);
        }
      }

      function applyGraphTransform() {
        if (!graphLayerEl) return;
        graphLayerEl.setAttribute(
          "transform",
          "translate(" + graphView.x + "," + graphView.y + ") scale(" + graphView.scale + ")"
        );
      }

      function truncateMiddle(text, maxLength) {
        const value = String(text || "");
        if (value.length <= maxLength) return value;
        const left = Math.ceil(maxLength * 0.55);
        const right = Math.max(4, maxLength - left - 1);
        return value.slice(0, left) + "…" + value.slice(-right);
      }

      function edgePathForNodes(source, target) {
        const nodeWidth = 236;
        const nodeHeight = 56;
        const sx = source.position.x + nodeWidth;
        const sy = source.position.y + nodeHeight / 2;
        const tx = target.position.x;
        const ty = target.position.y + nodeHeight / 2;
        const distance = Math.abs(tx - sx);
        const direction = tx >= sx ? 1 : -1;
        const curve = Math.max(80, Math.min(280, distance * 0.45 || 90));
        const c1x = sx + direction * curve;
        const c2x = tx - direction * curve;
        return "M " + sx + " " + sy + " C " + c1x + " " + sy + ", " + c2x + " " + ty + ", " + tx + " " + ty;
      }

      function riskColor(riskLevel) {
        if (riskLevel === "high") return "#ef4444";
        if (riskLevel === "medium") return "#f59e0b";
        return "#22c55e";
      }

      function roleStroke(role) {
        if (role === "entry") return "#38bdf8";
        if (role === "routing") return "#22d3ee";
        if (role === "service") return "#60a5fa";
        if (role === "data") return "#a78bfa";
        if (role === "config") return "#f59e0b";
        return "#64748b";
      }

      function graphBounds(nodes) {
        if (!nodes || nodes.length === 0) {
          return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
        }

        const nodeWidth = 236;
        const nodeHeight = 56;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const node of nodes) {
          minX = Math.min(minX, node.position.x);
          minY = Math.min(minY, node.position.y);
          maxX = Math.max(maxX, node.position.x + nodeWidth);
          maxY = Math.max(maxY, node.position.y + nodeHeight);
        }

        return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
      }

      function fitGraphToViewport() {
        if (!graphViewportEl || !currentGraphData || !Array.isArray(currentGraphData.nodes)) {
          return;
        }
        const padding = 64;
        const bounds = graphBounds(currentGraphData.nodes);
        const viewportWidth = graphViewportEl.clientWidth || 1;
        const viewportHeight = graphViewportEl.clientHeight || 1;
        const targetScale = Math.min(
          1.9,
          Math.max(
            0.32,
            Math.min(
              (viewportWidth - padding * 2) / bounds.width,
              (viewportHeight - padding * 2) / bounds.height
            )
          )
        );

        graphView.scale = targetScale;
        graphView.x = padding - bounds.minX * targetScale;
        graphView.y = padding - bounds.minY * targetScale;
        applyGraphTransform();
      }

      function drawGraphHighlights(summary) {
        if (graphSummaryEl) {
          graphSummaryEl.innerHTML =
            "<div><strong>Root:</strong> " +
            (summary.rootPath || ".") +
            "</div><div><strong>Nodes:</strong> " +
            (summary.nodeCount || 0) +
            " • <strong>Total edges:</strong> " +
            (summary.edgeCount || 0) +
            " • <strong>Dirs:</strong> " +
            (summary.directories || 0) +
            "</div><div><strong>Imports:</strong> " +
            (summary.importEdgeCount || 0) +
            " • <strong>User flow:</strong> " +
            (summary.flowEdgeCount || 0) +
            "</div>";
        }

        if (graphKeyFilesEl) {
          graphKeyFilesEl.innerHTML = "";
          const keyFiles = Array.isArray(summary.keyFiles) ? summary.keyFiles : [];
          if (keyFiles.length === 0) {
            const empty = document.createElement("span");
            empty.className = "chip-btn";
            empty.textContent = "(none)";
            graphKeyFilesEl.appendChild(empty);
          } else {
            for (const filePath of keyFiles) {
              const chip = document.createElement("button");
              chip.type = "button";
              chip.className = "chip-btn";
              chip.dataset.filePath = filePath;
              chip.textContent = filePath;
              graphKeyFilesEl.appendChild(chip);
            }
          }
        }

        if (graphRiskFilesEl) {
          graphRiskFilesEl.innerHTML = "";
          const riskFiles = Array.isArray(summary.riskFiles) ? summary.riskFiles : [];
          if (riskFiles.length === 0) {
            const empty = document.createElement("span");
            empty.className = "chip-btn";
            empty.textContent = "(none)";
            graphRiskFilesEl.appendChild(empty);
          } else {
            const nodeById = new Map((currentGraphData.nodes || []).map((node) => [node.id, node]));
            for (const filePath of riskFiles) {
              const chip = document.createElement("button");
              chip.type = "button";
              const node = nodeById.get(filePath);
              const riskLevel = node?.data?.riskLevel || "medium";
              chip.className = "chip-btn risk-" + riskLevel;
              chip.dataset.filePath = filePath;
              chip.textContent = filePath;
              graphRiskFilesEl.appendChild(chip);
            }
          }
        }
      }

      function drawGraph() {
        if (!graphLayerEl) return;
        graphLayerEl.innerHTML = "";
        applyGraphTransform();
        if (!currentGraphData) return;

        const nodesById = new Map();
        for (const node of currentGraphData.nodes || []) {
          nodesById.set(node.id, node);
        }

        const visibleEdges = (currentGraphData.edges || []).filter((edge) => {
          if (edge?.data?.kind === "flow") {
            return graphFilters.showFlow;
          }
          return graphFilters.showImports;
        });

        for (const edge of visibleEdges.filter((item) => item?.data?.kind !== "flow")) {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          if (!source || !target) continue;

          const importPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          importPath.setAttribute("d", edgePathForNodes(source, target));
          importPath.setAttribute("fill", "none");
          importPath.setAttribute("stroke", "#64748b");
          importPath.setAttribute("stroke-width", "1.4");
          importPath.setAttribute("stroke-dasharray", "5 5");
          importPath.setAttribute("opacity", "0.72");
          graphLayerEl.appendChild(importPath);
        }

        for (const edge of visibleEdges.filter((item) => item?.data?.kind === "flow")) {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          if (!source || !target) continue;

          const flowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          flowPath.setAttribute("d", edgePathForNodes(source, target));
          flowPath.setAttribute("fill", "none");
          flowPath.setAttribute("stroke", "url(#edge-flow-gradient)");
          flowPath.setAttribute("stroke-width", "2.7");
          flowPath.setAttribute("marker-end", "url(#edge-flow-arrow)");
          flowPath.setAttribute("opacity", "0.92");
          graphLayerEl.appendChild(flowPath);
        }

        const sortedNodes = [...(currentGraphData.nodes || [])].sort(
          (a, b) => (a.data?.importance || 0) - (b.data?.importance || 0) || a.id.localeCompare(b.id)
        );

        for (const node of sortedNodes) {
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.style.cursor = "pointer";
          const selected = selectedNodeId === node.id;

          const glow = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          glow.setAttribute("x", String(node.position.x - 2));
          glow.setAttribute("y", String(node.position.y - 2));
          glow.setAttribute("width", "240");
          glow.setAttribute("height", "60");
          glow.setAttribute("rx", "13");
          glow.setAttribute("ry", "13");
          glow.setAttribute("fill", selected ? "#dbeafe" : "#e2e8f0");
          glow.setAttribute("opacity", selected ? "0.7" : "0.22");

          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", String(node.position.x));
          rect.setAttribute("y", String(node.position.y));
          rect.setAttribute("width", "236");
          rect.setAttribute("height", "56");
          rect.setAttribute("rx", "12");
          rect.setAttribute("ry", "12");
          rect.setAttribute("fill", selected ? "#0f172a" : "#111827");
          rect.setAttribute("stroke", selected ? "#38bdf8" : roleStroke(node.data?.role));
          rect.setAttribute("stroke-width", selected ? "2.8" : "2");

          const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
          title.setAttribute("x", String(node.position.x + 12));
          title.setAttribute("y", String(node.position.y + 23));
          title.setAttribute("font-size", "12");
          title.setAttribute("font-weight", "700");
          title.setAttribute("font-family", "ui-monospace, SFMono-Regular, Menlo, monospace");
          title.setAttribute("fill", "#f8fafc");
          title.textContent = truncateMiddle(node.data.label, 30);

          const subtitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
          subtitle.setAttribute("x", String(node.position.x + 12));
          subtitle.setAttribute("y", String(node.position.y + 40));
          subtitle.setAttribute("font-size", "10");
          subtitle.setAttribute("font-family", "ui-monospace, SFMono-Regular, Menlo, monospace");
          subtitle.setAttribute("fill", "#93c5fd");
          subtitle.textContent = truncateMiddle(
            (node.data.directory ? node.data.directory + "/" : "") + (node.data.role || "module"),
            38
          );

          const risk = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          risk.setAttribute("cx", String(node.position.x + 220));
          risk.setAttribute("cy", String(node.position.y + 14));
          risk.setAttribute("r", "5");
          risk.setAttribute("fill", riskColor(node.data?.riskLevel));
          risk.setAttribute("stroke", "#f8fafc");
          risk.setAttribute("stroke-width", "1");

          group.append(glow, rect, title, subtitle, risk);
          group.addEventListener("click", (event) => {
            event.stopPropagation();
            onNodeClick(node);
          });
          graphLayerEl.appendChild(group);
        }
      }

      function renderGraph(payload) {
        const summary = payload.summary || {};

        currentGraphData = {
          nodes: payload.nodes || [],
          edges: payload.edges || [],
          summary
        };
        selectedNodeId = null;
        clickedTrail.length = 0;
        tourState.paths = [];
        tourState.index = -1;
        drawGraphHighlights(summary);
        drawGraph();
        fitGraphToViewport();
        renderTrailChips();
        syncTourStatus();
        setInspectorPlaceholder(
          "Inspector: sélectionne un fichier",
          "<p>Clique un fichier dans le graphe pour obtenir une explication pédagogique détaillée.</p>"
        );
      }

      async function generateGraph() {
        if (!state.sessionId) {
          setStatus("Cree une session avant de generer le schema.", "err");
          return;
        }

        const rootPath = graphRootPathEl.value.trim() || ".";
        const maxNodes = Number(graphMaxNodesEl.value || "180");
        if (!Number.isFinite(maxNodes) || maxNodes < 20 || maxNodes > 400) {
          setStatus("maxNodes doit etre entre 20 et 400.", "err");
          return;
        }

        setStatus("Generation schema repo...", "");
        generateGraphBtn.disabled = true;
        try {
          const response = await fetch(
            state.apiBase + "/api/sessions/" + state.sessionId + "/repo_graph",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ rootPath, maxNodes })
            }
          );
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Repo graph generation failed");

          renderGraph(payload);
          appendChatMessage(
            "assistant",
            "Schema repo genere pour " +
              (payload.summary?.rootPath || ".") +
              " avec " +
              (payload.summary?.nodeCount || 0) +
              " noeuds, " +
              (payload.summary?.importEdgeCount || 0) +
              " liens d'import et " +
              (payload.summary?.flowEdgeCount || 0) +
              " liens user-flow.",
            "repo-graph",
            "assistant"
          );
          setStatus("Schema repo genere.", "ok");
        } catch (error) {
          appendChatMessage(
            "assistant",
            "Erreur schema repo: " + (error.message || String(error)),
            "repo-graph | error",
            "assistant"
          );
          setStatus("Erreur schema repo: " + (error.message || String(error)), "err");
        } finally {
          generateGraphBtn.disabled = !state.sessionId;
        }
      }

      async function scanRepoOverview() {
        if (!state.sessionId) return;
        const rootPath = graphRootPathEl.value.trim() || ".";
        const maxNodes = Number(graphMaxNodesEl.value || "180");
        try {
          const response = await fetch(
            state.apiBase + "/api/sessions/" + state.sessionId + "/repo_overview",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ rootPath, maxNodes })
            }
          );
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Repo overview failed");

          const overview = payload.overview || {};
          const directoryNotes = Array.isArray(overview.directoryNotes)
            ? overview.directoryNotes.join("\\n- ")
            : "";
          const entryPoints = Array.isArray(overview.entryPoints)
            ? overview.entryPoints.join("\\n- ")
            : "";
          const commands = Array.isArray(overview.suggestedCommands)
            ? overview.suggestedCommands.join("\\n- ")
            : "";

          const overviewText = [
            "Overview:",
            overview.overview || "",
            "",
            "Directory notes:",
            directoryNotes ? "- " + directoryNotes : "- (none)",
            "",
            "Entry points:",
            entryPoints ? "- " + entryPoints : "- (none)",
            "",
            "Suggested commands:",
            commands ? "- " + commands : "- (none)"
          ].join("\\n");
          const assistantMsg = appendChatMessage(
            "assistant",
            "",
            "auto-scan | " +
              payload.mode +
              " | nodes=" +
              (payload.summary?.nodeCount || 0) +
              " | edges=" +
              (payload.summary?.edgeCount || 0),
            "assistant"
          );
          await streamText(assistantMsg, overviewText);
        } catch (error) {
          appendChatMessage(
            "assistant",
            "Erreur overview: " + (error.message || String(error)),
            "auto-scan | error",
            "assistant"
          );
        }
      }

      function findNodeByPath(filePath) {
        if (!currentGraphData || !Array.isArray(currentGraphData.nodes)) {
          return null;
        }
        return currentGraphData.nodes.find((node) => node?.data?.path === filePath) || null;
      }

      async function openNodeByPath(filePath, options = {}) {
        const node = findNodeByPath(filePath);
        if (!node) {
          setStatus("Fichier non present dans le graphe actuel: " + filePath, "err");
          return;
        }
        await onNodeClick(node, options);
      }

      async function onNodeClick(node, options = {}) {
        if (!state.sessionId) return;
        const requestId = ++inspectorRequestId;
        const centerInView = options.centerInView !== false;
        selectedNodeId = node.id;
        pushTrailPath(node.data.path);
        drawGraph();
        if (centerInView) {
          centerNodeInView(node);
        }

        const maybeTourIndex = tourState.paths.indexOf(node.data.path);
        if (maybeTourIndex >= 0) {
          tourState.index = maybeTourIndex;
        }
        syncTourStatus();

        setInspectorPlaceholder(
          node.data.path,
          "<p>Analyse pédagogique en cours...</p><p class='subtle'>Fonctions, variables, imports/exports, risques et rôle dans le flow.</p>"
        );
        const rootPath = graphRootPathEl.value.trim() || ".";
        const maxNodes = Number(graphMaxNodesEl.value || "180");

        try {
          const response = await fetch(
            state.apiBase + "/api/sessions/" + state.sessionId + "/explain_file",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                path: node.data.path,
                rootPath,
                maxNodes,
                trailPaths: clickedTrail.slice(0, Math.max(0, clickedTrail.length - 1))
              })
            }
          );
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "File explain failed");
          if (requestId !== inspectorRequestId) {
            return;
          }

          renderInspectorContent(node, payload.explanation || {}, payload.mode || "heuristic");
          setStatus("Analyse fichier mise a jour dans l'inspector.", "ok");
        } catch (error) {
          if (requestId !== inspectorRequestId) {
            return;
          }
          setInspectorPlaceholder(
            node.data.path,
            "<p>Erreur: " + escapeHtml(error.message || String(error)) + "</p>"
          );
          setStatus("Erreur analyse fichier: " + (error.message || String(error)), "err");
        }
      }

      async function runGraphSearch() {
        const query = graphSearchInputEl?.value || "";
        const matches = findSearchMatches(query);
        if (matches.length === 0) {
          setStatus("Aucun fichier ne correspond a la recherche.", "err");
          return;
        }

        const paths = matches.slice(0, 10).map((node) => node.data.path);
        tourState.paths = paths;
        tourState.index = 0;
        syncTourStatus();
        await openNodeByPath(paths[0], { centerInView: true });
        setStatus("Recherche: " + matches.length + " resultat(s), premier ouvert.", "ok");
      }

      async function startGuidedTour() {
        const paths = buildGuidedTourPaths();
        if (paths.length === 0) {
          setStatus("Tour indisponible: genere d'abord un graphe avec des noeuds.", "err");
          return;
        }

        tourState.paths = paths;
        tourState.index = 0;
        syncTourStatus();
        await openNodeByPath(paths[0], { centerInView: true });
        setStatus("Tour guide initialise.", "ok");
      }

      async function navigateTour(direction) {
        if (tourState.paths.length === 0 || tourState.index < 0) {
          setStatus("Tour inactif. Lance 'Start guided tour'.", "err");
          return;
        }
        const nextIndex = tourState.index + direction;
        if (nextIndex < 0 || nextIndex >= tourState.paths.length) {
          setStatus("Fin de tour atteinte.", "ok");
          syncTourStatus();
          return;
        }
        tourState.index = nextIndex;
        syncTourStatus();
        await openNodeByPath(tourState.paths[tourState.index], { centerInView: true });
      }

      async function createSession() {
        const repoPath = repoPathEl.value.trim();
        if (!repoPath) {
          setStatus("Repo path obligatoire.", "err");
          return;
        }

        state.repoPath = repoPath;
        window.localStorage.setItem("repoWatcherRepoPath", repoPath);

        setStatus("Creation session...", "");
        createSessionBtn.disabled = true;
        try {
          const response = await fetch(state.apiBase + "/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ repoPath })
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Session creation failed");

          state.sessionId = payload.id;
          resetGraphPanels();
          updateSessionState();
          setStatus("Session creee. Scan initial...", "");
          appendChatMessage("system", "Session ouverte sur: " + repoPath, "session", "assistant");

          await generateGraph();
          await scanRepoOverview();
          setStatus("Session creee et scan initial termine.", "ok");
        } catch (error) {
          state.sessionId = null;
          updateSessionState();
          setStatus("Erreur creation session: " + (error.message || String(error)), "err");
        } finally {
          createSessionBtn.disabled = false;
        }
      }

      async function sendMessage() {
        if (!state.sessionId) {
          setStatus("Cree une session avant d'envoyer un message.", "err");
          return;
        }

        const message = messageInputEl.value.trim();
        if (!message) {
          setStatus("Message vide.", "err");
          return;
        }

        appendChatMessage("user", message, "you");
        messageInputEl.value = "";
        setStatus("Generation reponse IA...", "");
        sendBtn.disabled = true;

        const assistantMsg = appendChatMessage("assistant", "", "stream", "assistant");
        assistantMsg.setLoading(true);

        try {
          const response = await fetch(
            state.apiBase + "/api/sessions/" + state.sessionId + "/chat/stream",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message })
            }
          );
          if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.error || "Chat stream request failed");
          }
          if (!response.body) {
            throw new Error("Streaming body unavailable");
          }

          assistantMsg.setText("");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\\n");
            buffer = lines.pop() || "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) {
                continue;
              }
              let event;
              try {
                event = JSON.parse(line);
              } catch {
                continue;
              }

              if (event.type === "meta") {
                assistantMsg.setMeta("stream | " + (event.mode || "agent"));
                continue;
              }
              if (event.type === "delta") {
                assistantMsg.setLoading(false);
                assistantMsg.appendText(event.text || "");
                continue;
              }
              if (event.type === "done") {
                assistantMsg.setLoading(false);
                continue;
              }
              if (event.type === "error") {
                assistantMsg.setLoading(false);
                assistantMsg.setMeta("error");
                assistantMsg.setText("Erreur message: " + (event.message || "Unknown error"));
              }
            }
          }

          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer.trim());
              if (event.type === "error") {
                assistantMsg.setLoading(false);
                assistantMsg.setMeta("error");
                assistantMsg.setText("Erreur message: " + (event.message || "Unknown error"));
              }
            } catch {
              // ignore trailing partial data
            }
          }

          assistantMsg.setLoading(false);
          setStatus("Reponse recue.", "ok");
        } catch (error) {
          assistantMsg.setLoading(false);
          assistantMsg.setText("Erreur message: " + (error.message || String(error)));
          assistantMsg.setMeta("error");
          setStatus("Erreur message: " + (error.message || String(error)), "err");
        } finally {
          sendBtn.disabled = !state.sessionId;
        }
      }

      if (graphViewportEl) {
        graphViewportEl.addEventListener("wheel", (event) => {
          event.preventDefault();
          const delta = event.deltaY < 0 ? 1.12 : 0.9;
          graphView.scale = Math.max(0.3, Math.min(2.8, graphView.scale * delta));
          applyGraphTransform();
        });

        graphViewportEl.addEventListener("pointerdown", (event) => {
          dragState = {
            x: event.clientX,
            y: event.clientY,
            startX: graphView.x,
            startY: graphView.y
          };
          graphViewportEl.classList.add("dragging");
        });

        window.addEventListener("pointermove", (event) => {
          if (!dragState) return;
          const dx = event.clientX - dragState.x;
          const dy = event.clientY - dragState.y;
          graphView.x = dragState.startX + dx;
          graphView.y = dragState.startY + dy;
          applyGraphTransform();
        });

        window.addEventListener("pointerup", () => {
          dragState = null;
          graphViewportEl.classList.remove("dragging");
        });
      }

      const onChipClick = async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const filePath = target.dataset.filePath;
        if (!filePath) return;
        await openNodeByPath(filePath);
      };

      graphKeyFilesEl?.addEventListener("click", onChipClick);
      graphRiskFilesEl?.addEventListener("click", onChipClick);
      graphTrailEl?.addEventListener("click", onChipClick);

      fitGraphBtn?.addEventListener("click", () => {
        fitGraphToViewport();
      });

      clearTrailBtn?.addEventListener("click", () => {
        clickedTrail.length = 0;
        renderTrailChips();
      });

      toggleImportEdgesEl?.addEventListener("change", () => {
        graphFilters.showImports = Boolean(toggleImportEdgesEl.checked);
        drawGraph();
      });

      toggleFlowEdgesEl?.addEventListener("change", () => {
        graphFilters.showFlow = Boolean(toggleFlowEdgesEl.checked);
        drawGraph();
      });

      searchGraphBtn?.addEventListener("click", async () => {
        await runGraphSearch();
      });

      graphSearchInputEl?.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          await runGraphSearch();
        }
      });

      tourStartBtn?.addEventListener("click", async () => {
        await startGuidedTour();
      });

      tourPrevBtn?.addEventListener("click", async () => {
        await navigateTour(-1);
      });

      tourNextBtn?.addEventListener("click", async () => {
        await navigateTour(1);
      });

      repoPathEl.value = state.repoPath;
      updateSessionState();
      resetGraphPanels();
      applyGraphTransform();
      renderTrailChips();

      createSessionBtn.addEventListener("click", createSession);
      sendBtn.addEventListener("click", sendMessage);
      generateGraphBtn.addEventListener("click", async () => {
        await generateGraph();
        await scanRepoOverview();
      });
      clearBtn.addEventListener("click", () => {
        chatLogEl.innerHTML = "";
        setStatus("Chat efface.", "");
      });
      messageInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          sendMessage();
        }
      });
    </script>
  </body>
</html>`;
}

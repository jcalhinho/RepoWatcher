const state = {
        apiBase: window.location.origin,
        repoPath: window.localStorage.getItem("repoWatcherRepoPath") || "",
        sessionId: null
      };

      const graphView = { x: 30, y: 30, scale: 0.9 };
      const graphFilters = { showImports: true, showApi: true, showFlow: true, showConfig: true };
      let currentGraphData = null;
      let selectedNodeId = null;
      let selectedFilePath = null;
      const clickedTrail = [];
      const tourState = { paths: [], index: -1 };
      let dragState = null;
      let nodeRequestId = 0;
      let explainRequestId = 0;

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
      const toggleApiEdgesEl = document.getElementById("toggleApiEdges");
      const toggleConfigEdgesEl = document.getElementById("toggleConfigEdges");
      const toggleFlowEdgesEl = document.getElementById("toggleFlowEdges");
      const fileViewerPathEl = document.getElementById("fileViewerPath");
      const fileViewerMetaEl = document.getElementById("fileViewerMeta");
      const fileViewerBodyEl = document.getElementById("fileViewerBody");
      const explainFileBtn = document.getElementById("explainFileBtn");
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
        selectedFilePath = null;
        clickedTrail.length = 0;
        tourState.paths = [];
        tourState.index = -1;
        graphFilters.showImports = true;
        graphFilters.showApi = true;
        graphFilters.showConfig = true;
        graphFilters.showFlow = true;
        if (toggleImportEdgesEl) toggleImportEdgesEl.checked = true;
        if (toggleApiEdgesEl) toggleApiEdgesEl.checked = true;
        if (toggleConfigEdgesEl) toggleConfigEdgesEl.checked = true;
        if (toggleFlowEdgesEl) toggleFlowEdgesEl.checked = true;
        graphSummaryEl.textContent = "";
        if (graphKeyFilesEl) graphKeyFilesEl.innerHTML = "";
        if (graphRiskFilesEl) graphRiskFilesEl.innerHTML = "";
        if (graphTrailEl) graphTrailEl.innerHTML = "";
        if (graphLayerEl) graphLayerEl.innerHTML = "";
        syncTourStatus();
        setFileViewerPlaceholder(
          "Aucun fichier sélectionné",
          "Clique un fichier dans le graphe pour afficher son code.",
          "Le visualiseur affichera ici le contenu du fichier avec numéros de ligne."
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
          chip.title = filePath;
          chip.textContent = formatChipPath(filePath);
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
        if (explainFileBtn) explainFileBtn.disabled = !hasSession || !selectedFilePath;
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

      function setFileViewerPlaceholder(pathLabel, metaLabel, message) {
        if (fileViewerPathEl) {
          fileViewerPathEl.textContent = pathLabel;
        }
        if (fileViewerMetaEl) {
          fileViewerMetaEl.textContent = metaLabel;
        }
        if (fileViewerBodyEl) {
          fileViewerBodyEl.innerHTML = '<div class="file-viewer-empty">' + escapeHtml(message) + "</div>";
        }
      }

      function renderFileViewerContent(filePath, content) {
        if (fileViewerPathEl) {
          fileViewerPathEl.textContent = filePath;
        }

        const normalizedContent = String(content || "").replaceAll("\r\n", "\n");
        const allLines = normalizedContent.split("\n");
        const maxRenderedLines = 2200;
        const lines = allLines.slice(0, maxRenderedLines);
        const truncated = allLines.length > lines.length;

        if (fileViewerMetaEl) {
          fileViewerMetaEl.textContent =
            lines.length + " ligne(s)" + (truncated ? " • affichage tronqué" : "");
        }

        if (!fileViewerBodyEl) {
          return;
        }

        const htmlRows = lines
          .map((line, index) => {
            const safeLine = line.length > 0 ? escapeHtml(line) : "&nbsp;";
            return (
              '<div class="file-line">' +
              '<span class="file-gutter">' +
              String(index + 1) +
              "</span>" +
              '<span class="file-code">' +
              safeLine +
              "</span>" +
              "</div>"
            );
          })
          .join("");

        const truncatedHint = truncated
          ? '<div class="file-truncated">Affichage limité aux ' +
            String(maxRenderedLines) +
            " premières lignes.</div>"
          : "";

        fileViewerBodyEl.innerHTML = '<div class="file-lines">' + htmlRows + truncatedHint + "</div>";
      }

      function buildExplainText(exp) {
        const interactions = Array.isArray(exp?.interactions) ? exp.interactions.join("\n- ") : "";
        const keyFunctions = Array.isArray(exp?.keyFunctions) ? exp.keyFunctions.join("\n- ") : "";
        const keyVariables = Array.isArray(exp?.keyVariables) ? exp.keyVariables.join("\n- ") : "";
        const imports = Array.isArray(exp?.imports) ? exp.imports.join("\n- ") : "";
        const exportsList = Array.isArray(exp?.exports) ? exp.exports.join("\n- ") : "";
        const risks = Array.isArray(exp?.risks) ? exp.risks.join("\n- ") : "";
        return [
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
        ].join("\n");
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
          .replace(/"/g, "&quot;")
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
        const source = String(markdown || "").replaceAll("\r\n", "\n");
        const lines = source.split("\n");
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
                '<pre class="md-code"><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>"
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
          blocks.push('<pre class="md-code"><code>' + escapeHtml(codeLines.join("\n")) + "</code></pre>");
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

      function formatChipPath(filePath) {
        const value = String(filePath || "");
        const parts = value.split("/").filter(Boolean);
        if (parts.length <= 3) {
          return value;
        }
        return parts[0] + "/.../" + parts.slice(-2).join("/");
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
            " • <strong>API links:</strong> " +
            (summary.apiEdgeCount || 0) +
            " • <strong>Config links:</strong> " +
            (summary.configEdgeCount || 0) +
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
              chip.title = filePath;
              chip.textContent = formatChipPath(filePath);
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
              chip.title = filePath;
              chip.textContent = formatChipPath(filePath);
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
          if (edge?.data?.kind === "api") {
            return graphFilters.showApi;
          }
          if (edge?.data?.kind === "config") {
            return graphFilters.showConfig;
          }
          return graphFilters.showImports;
        });

        for (const edge of visibleEdges.filter((item) => item?.data?.kind === "import")) {
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

        for (const edge of visibleEdges.filter((item) => item?.data?.kind === "config")) {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          if (!source || !target) continue;

          const configPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          configPath.setAttribute("d", edgePathForNodes(source, target));
          configPath.setAttribute("fill", "none");
          configPath.setAttribute("stroke", "#f59e0b");
          configPath.setAttribute("stroke-width", "2");
          configPath.setAttribute("stroke-dasharray", "2 6");
          configPath.setAttribute("opacity", "0.84");
          graphLayerEl.appendChild(configPath);
        }

        for (const edge of visibleEdges.filter((item) => item?.data?.kind === "api")) {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          if (!source || !target) continue;

          const apiPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          apiPath.setAttribute("d", edgePathForNodes(source, target));
          apiPath.setAttribute("fill", "none");
          apiPath.setAttribute("stroke", "#ec4899");
          apiPath.setAttribute("stroke-width", "2.2");
          apiPath.setAttribute("stroke-dasharray", "7 4");
          apiPath.setAttribute("opacity", "0.86");
          graphLayerEl.appendChild(apiPath);
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
        selectedFilePath = null;
        updateSessionState();
        syncTourStatus();
        setFileViewerPlaceholder(
          "Aucun fichier sélectionné",
          "Clique un fichier dans le graphe pour afficher son code.",
          "Le visualiseur affichera ici le contenu du fichier avec numéros de ligne."
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
              " liens d'import, " +
              (payload.summary?.apiEdgeCount || 0) +
              " liens API, " +
              (payload.summary?.configEdgeCount || 0) +
              " liens config et " +
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
            ? overview.directoryNotes.join("\n- ")
            : "";
          const entryPoints = Array.isArray(overview.entryPoints)
            ? overview.entryPoints.join("\n- ")
            : "";
          const commands = Array.isArray(overview.suggestedCommands)
            ? overview.suggestedCommands.join("\n- ")
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
          ].join("\n");
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

      async function requestFileContent(filePath) {
        if (!state.sessionId) {
          throw new Error("Session absente");
        }
        const response = await fetch(
          state.apiBase + "/api/sessions/" + state.sessionId + "/file/read",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: filePath })
          }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "File read failed");
        }
        return payload;
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
        const requestId = ++nodeRequestId;
        const centerInView = options.centerInView !== false;
        selectedNodeId = node.id;
        selectedFilePath = node.data.path;
        updateSessionState();
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

        setFileViewerPlaceholder(
          node.data.path,
          "Chargement du fichier...",
          "Lecture du contenu en cours..."
        );

        const filePromise = requestFileContent(node.data.path);
        void filePromise
          .then((payload) => {
            if (requestId !== nodeRequestId) return;
            renderFileViewerContent(node.data.path, payload.content || "");
          })
          .catch((error) => {
            if (requestId !== nodeRequestId) return;
            setFileViewerPlaceholder(
              node.data.path,
              "Erreur lecture fichier",
              "Erreur: " + (error?.message || String(error))
            );
          });
      }

      async function explainSelectedFile() {
        if (!state.sessionId) {
          setStatus("Cree une session avant de demander une explication.", "err");
          return;
        }
        if (!selectedFilePath) {
          setStatus("Selectionne un fichier dans le graphe avant l'explication.", "err");
          return;
        }

        const filePath = selectedFilePath;
        const requestId = ++explainRequestId;
        if (explainFileBtn) explainFileBtn.disabled = true;

        const explainMsg = appendChatMessage(
          "assistant",
          "",
          "file explain | " + filePath,
          "assistant"
        );
        explainMsg.setLoading(true);

        const rootPath = graphRootPathEl.value.trim() || ".";
        const maxNodes = Number(graphMaxNodesEl.value || "180");

        try {
          const response = await fetch(
            state.apiBase + "/api/sessions/" + state.sessionId + "/explain_file",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                path: filePath,
                rootPath,
                maxNodes,
                trailPaths: clickedTrail.slice(0, Math.max(0, clickedTrail.length - 1))
              })
            }
          );
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "File explain failed");

          if (requestId !== explainRequestId) {
            explainMsg.setLoading(false);
            explainMsg.setMeta("file explain | stale");
            explainMsg.setText("Analyse interrompue (nouvelle demande).");
            return;
          }
          explainMsg.setMeta(
            "file explain | " + payload.mode + " | confidence=" + (payload.explanation?.confidence || "n/a")
          );
          explainMsg.setLoading(false);
          explainMsg.setText(buildExplainText(payload.explanation || {}));
          setStatus("Analyse fichier ajoutée au chat.", "ok");
        } catch (error) {
          if (requestId !== explainRequestId) {
            explainMsg.setLoading(false);
            explainMsg.setMeta("file explain | stale");
            explainMsg.setText("Analyse interrompue (nouvelle demande).");
            return;
          }
          explainMsg.setLoading(false);
          explainMsg.setMeta("file explain | error");
          explainMsg.setText("Erreur analyse fichier: " + (error?.message || String(error)));
          setStatus("Erreur analyse fichier: " + (error?.message || String(error)), "err");
        } finally {
          updateSessionState();
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
            const lines = buffer.split("\n");
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

      toggleApiEdgesEl?.addEventListener("change", () => {
        graphFilters.showApi = Boolean(toggleApiEdgesEl.checked);
        drawGraph();
      });

      toggleConfigEdgesEl?.addEventListener("change", () => {
        graphFilters.showConfig = Boolean(toggleConfigEdgesEl.checked);
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
      explainFileBtn?.addEventListener("click", async () => {
        await explainSelectedFile();
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

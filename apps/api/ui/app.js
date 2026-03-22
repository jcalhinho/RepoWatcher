import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "https://esm.sh/htm@3.1.1";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  MarkerType,
  ReactFlowProvider,
  applyNodeChanges
} from "reactflow";

const html = htm.bind(React.createElement);

const state = {
  apiBase: window.location.origin,
  repoPath: window.localStorage.getItem("repoWatcherRepoPath") || "",
  sessionId: null,
  lang: window.localStorage.getItem("repoWatcherLang") === "en" ? "en" : "fr"
};
const DEFAULT_GRAPH_ROOT_PATH = ".";

const initialFilters = {
  import: true,
  api: true,
  config: true,
  flow: true
};

function edgeColor(kind) {
  if (kind === "api") return "#ec4899";
  if (kind === "config") return "#f59e0b";
  if (kind === "flow") return "#0ea5e9";
  return "#64748b";
}

function roleStroke(role) {
  if (role === "entry") return "#38bdf8";
  if (role === "routing") return "#22d3ee";
  if (role === "service") return "#60a5fa";
  if (role === "data") return "#a78bfa";
  if (role === "config") return "#f59e0b";
  return "#64748b";
}

function zoneOf(pathValue) {
  const normalized = String(pathValue || "").toLowerCase();
  const first = normalized.split("/")[0] || "";
  if (/(backend|server|api|services?)/.test(first)) return "backend";
  if (/(frontend|web|client|ui|mobile|app)/.test(first)) return "frontend";
  return "shared";
}

function truncateMiddle(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  const left = Math.ceil(maxLength * 0.58);
  const right = Math.max(4, maxLength - left - 1);
  return text.slice(0, left) + "…" + text.slice(-right);
}

function shortPath(pathValue) {
  const parts = String(pathValue || "").split("/").filter(Boolean);
  if (parts.length <= 2) return String(pathValue || "");
  return ".../" + parts.slice(-2).join("/");
}

function pathSegments(pathValue) {
  return String(pathValue || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function primaryBucket(pathValue) {
  const parts = pathSegments(pathValue);
  return parts[0] || "root";
}

function isEntryLike(node) {
  const role = String(node?.data?.role || "").toLowerCase();
  if (role === "entry" || role === "routing") return true;
  const pathValue = String(node?.data?.path || "").toLowerCase();
  const label = String(node?.data?.label || "").toLowerCase();
  return /(main|index|app|server|root)\.[a-z0-9]+$/.test(pathValue) || /(main|index|app|server)/.test(label);
}

function setStatus(setter, message, type = "") {
  setter({ message, type });
}

function createMessage(role, text, meta = "", loading = false) {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    meta,
    loading
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdownToHtml(markdownText) {
  const raw = String(markdownText || "");
  if (!raw.trim()) return "";

  const codeBlocks = [];
  let text = raw.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const id = codeBlocks.length;
    codeBlocks.push({
      lang: String(lang || "").trim(),
      code: String(code || "")
    });
    return `@@CODEBLOCK_${id}@@`;
  });

  text = escapeHtml(text)
    .replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.*)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

  const lines = text.split("\n");
  const output = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = /^[-*]\s+/.test(trimmed);
    if (isBullet) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push("<li>" + trimmed.replace(/^[-*]\s+/, "") + "</li>");
      continue;
    }
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
    if (!trimmed) {
      output.push("<br/>");
      continue;
    }
    if (/^<h[1-3]>/.test(trimmed) || /^@@CODEBLOCK_\d+@@$/.test(trimmed)) {
      output.push(trimmed);
      continue;
    }
    output.push("<p>" + trimmed + "</p>");
  }
  if (inList) output.push("</ul>");

  let htmlContent = output.join("\n");
  htmlContent = htmlContent.replace(/@@CODEBLOCK_(\d+)@@/g, (_match, idText) => {
    const block = codeBlocks[Number(idText)];
    if (!block) return "";
    const langTag = block.lang ? '<span class="md-lang">' + escapeHtml(block.lang) + "</span>" : "";
    return (
      '<pre class="md-pre">' +
      langTag +
      "<code>" +
      escapeHtml(block.code) +
      "</code></pre>"
    );
  });
  return htmlContent;
}

function arrangeHierarchicalLayout(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length <= 1) return nodes;

  const nodeById = new Map();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  const normalizedEdges = [];
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges || []) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue;
    }
    normalizedEdges.push(edge);
    degreeById.set(edge.source, (degreeById.get(edge.source) || 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) || 0) + 1);
  }

  const connectedNodes = nodes.filter((node) => (degreeById.get(node.id) || 0) > 0);
  const orphanNodes = nodes.filter((node) => (degreeById.get(node.id) || 0) === 0);

  const roleBoost = {
    entry: 42,
    routing: 30,
    service: 14,
    data: 8,
    config: 10
  };

  const scoreNode = (node) =>
    Number(node?.data?.visualScore || 0) * 1.4 +
    Number(node?.data?.degree || 0) * 6 +
    Number(roleBoost[node?.data?.role] || 0) +
    (isEntryLike(node) ? 24 : 0);

  if (connectedNodes.length === 0) {
    const x = 240;
    let y = 40;
    return [...orphanNodes]
      .sort((a, b) => scoreNode(b) - scoreNode(a))
      .map((node) => {
        const placed = {
          ...node,
          position: { x, y },
          data: { ...node.data, lane: "orphans", level: 0, orphan: true }
        };
        y += Number(node?.data?.minHeight || 96) + 20;
        return placed;
      });
  }

  const connectedSet = new Set(connectedNodes.map((node) => node.id));
  const connectedEdges = normalizedEdges.filter(
    (edge) => connectedSet.has(edge.source) && connectedSet.has(edge.target)
  );

  const outgoing = new Map();
  for (const node of connectedNodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of connectedEdges) {
    outgoing.get(edge.source).push(edge);
  }

  const rankedNodes = [...connectedNodes].sort((a, b) => scoreNode(b) - scoreNode(a));
  const seedIds = [
    ...new Set([
      ...rankedNodes.filter(isEntryLike).slice(0, 10).map((node) => node.id),
      ...rankedNodes.slice(0, 4).map((node) => node.id)
    ])
  ];

  const distance = new Map(connectedNodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const queue = [];
  for (const id of seedIds) {
    distance.set(id, 0);
    queue.push(id);
  }
  while (queue.length > 0) {
    const sourceId = queue.shift();
    const sourceDistance = distance.get(sourceId);
    for (const edge of outgoing.get(sourceId) || []) {
      const nextDistance = sourceDistance + 1;
      if (nextDistance < distance.get(edge.target)) {
        distance.set(edge.target, nextDistance);
        queue.push(edge.target);
      }
    }
  }

  const laneWeight = new Map();
  for (const node of connectedNodes) {
    const lane = primaryBucket(node?.data?.path);
    const laneScore = scoreNode(node);
    laneWeight.set(lane, (laneWeight.get(lane) || 0) + laneScore);
  }
  const laneOrder = [...laneWeight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((entry) => entry[0]);
  const laneIndex = new Map(laneOrder.map((lane, index) => [lane, index]));

  const levelById = new Map();
  for (const node of connectedNodes) {
    const pathDepth = Math.max(0, pathSegments(node?.data?.path).length - 1);
    const distanceValue = distance.get(node.id);
    const walkDepth = Number.isFinite(distanceValue) ? distanceValue : pathDepth + 1;
    const influence =
      Number(node?.data?.visualScore || 0) +
      Number(node?.data?.apiLinks || 0) * 8 +
      Number(node?.data?.flowLinks || 0) * 11;
    const influenceLift = Math.min(2, Math.floor(influence / 85));
    let level = Math.max(0, Math.round(pathDepth * 0.58 + walkDepth * 0.92) - influenceLift);
    if (isEntryLike(node)) level = 0;
    levelById.set(node.id, level);
  }

  // Keep strong flow/api connections descending without exploding on cyclic imports.
  for (let i = 0; i < 3; i += 1) {
    for (const edge of connectedEdges) {
      const kind = edge?.data?.kind || "import";
      if (kind !== "flow" && kind !== "api") continue;
      const sourceLevel = levelById.get(edge.source);
      const targetLevel = levelById.get(edge.target);
      if (sourceLevel == null || targetLevel == null) continue;
      if (targetLevel <= sourceLevel) {
        levelById.set(edge.target, sourceLevel + 1);
      }
    }
  }

  const minLevel = Math.min(...levelById.values());
  if (Number.isFinite(minLevel) && minLevel > 0) {
    for (const [id, level] of levelById.entries()) {
      levelById.set(id, level - minLevel);
    }
  }

  const rowMap = new Map();
  for (const node of connectedNodes) {
    const level = levelById.get(node.id) || 0;
    const row = rowMap.get(level) || [];
    row.push(node);
    rowMap.set(level, row);
  }

  const horizontalGap = 30;
  const laneGap = 46;
  const verticalGap = 82;
  const intraLevelGap = 20;
  const maxRowWidth = 1760;
  const centerX = 1500;
  const leftPad = 360;
  const topPad = 40;

  const levels = [...rowMap.keys()].sort((a, b) => a - b);
  const positioned = [];
  let y = topPad;
  for (const level of levels) {
    const rowNodes = rowMap.get(level);
    rowNodes.sort((a, b) => {
      const laneA = primaryBucket(a?.data?.path);
      const laneB = primaryBucket(b?.data?.path);
      const laneDiff = (laneIndex.get(laneA) || 0) - (laneIndex.get(laneB) || 0);
      if (laneDiff !== 0) return laneDiff;
      return scoreNode(b) - scoreNode(a) || String(a?.data?.path || "").localeCompare(String(b?.data?.path || ""));
    });

    // Split very wide levels into centered sub-rows to keep a pyramid footprint.
    const subRows = [];
    let currentRow = [];
    let currentWidth = 0;
    let previousLane = null;
    for (const node of rowNodes) {
      const lane = primaryBucket(node?.data?.path);
      const width = Number(node?.data?.width || 220);
      const gap =
        currentRow.length === 0 ? 0 : horizontalGap + (previousLane !== null && lane !== previousLane ? laneGap : 0);
      const nextWidth = currentWidth + gap + width;
      if (currentRow.length > 0 && nextWidth > maxRowWidth) {
        subRows.push(currentRow);
        currentRow = [node];
        currentWidth = width;
      } else {
        currentRow.push(node);
        currentWidth = nextWidth;
      }
      previousLane = lane;
    }
    if (currentRow.length > 0) subRows.push(currentRow);

    for (let subRowIndex = 0; subRowIndex < subRows.length; subRowIndex += 1) {
      const subRow = subRows[subRowIndex];
      let rowWidth = 0;
      let subPrevLane = null;
      for (let i = 0; i < subRow.length; i += 1) {
        const node = subRow[i];
        const lane = primaryBucket(node?.data?.path);
        const width = Number(node?.data?.width || 220);
        if (i > 0) {
          rowWidth += horizontalGap;
          if (subPrevLane !== null && lane !== subPrevLane) rowWidth += laneGap;
        }
        rowWidth += width;
        subPrevLane = lane;
      }

      let x = Math.max(leftPad, centerX - rowWidth / 2);
      let rowHeight = 0;
      let visualLanePrev = null;
      for (const node of subRow) {
        const lane = primaryBucket(node?.data?.path);
        const width = Number(node?.data?.width || 220);
        const minHeight = Number(node?.data?.minHeight || 96);
        if (visualLanePrev !== null) {
          x += horizontalGap;
          if (lane !== visualLanePrev) x += laneGap;
        }
        positioned.push({
          ...node,
          position: { x, y },
          data: {
            ...node.data,
            lane,
            level,
            orphan: false
          }
        });
        x += width;
        rowHeight = Math.max(rowHeight, minHeight);
        visualLanePrev = lane;
      }

      y += rowHeight + (subRowIndex < subRows.length - 1 ? intraLevelGap : verticalGap);
    }
  }

  const orphanSorted = [...orphanNodes].sort((a, b) => {
    const roleA = String(a?.data?.role || "");
    const roleB = String(b?.data?.role || "");
    if (roleA !== roleB) {
      if (roleA === "config") return -1;
      if (roleB === "config") return 1;
    }
    return String(a?.data?.path || "").localeCompare(String(b?.data?.path || ""));
  });

  const minConnectedX = positioned.reduce(
    (minValue, node) => Math.min(minValue, Number(node?.position?.x || minValue)),
    Number.POSITIVE_INFINITY
  );
  const maxOrphanWidth = orphanSorted.reduce(
    (maxValue, node) => Math.max(maxValue, Number(node?.data?.width || 220)),
    220
  );
  const orphanColumnX = Number.isFinite(minConnectedX)
    ? Math.max(40, minConnectedX - maxOrphanWidth - 180)
    : 120;
  let orphanY = topPad;
  const orphanPositioned = orphanSorted.map((node) => {
    const placed = {
      ...node,
      position: { x: orphanColumnX, y: orphanY },
      data: {
        ...node.data,
        lane: "orphans",
        level: -1,
        orphan: true
      }
    };
    orphanY += Number(node?.data?.minHeight || 96) + 18;
    return placed;
  });

  return [...orphanPositioned, ...positioned];
}

function buildNodeAndEdgeData(payload) {
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload?.edges) ? payload.edges : [];

  const interaction = new Map();
  for (const node of rawNodes) {
    interaction.set(node.id, {
      importLinks: 0,
      apiLinks: 0,
      configLinks: 0,
      flowLinks: 0,
      degree: 0
    });
  }

  for (const edge of rawEdges) {
    const kind = edge?.data?.kind || "import";
    const source = interaction.get(edge.source);
    const target = interaction.get(edge.target);
    if (source) {
      source.degree += 1;
      if (kind === "api") source.apiLinks += 1;
      else if (kind === "config") source.configLinks += 1;
      else if (kind === "flow") source.flowLinks += 1;
      else source.importLinks += 1;
    }
    if (target) {
      target.degree += 1;
      if (kind === "api") target.apiLinks += 1;
      else if (kind === "config") target.configLinks += 1;
      else if (kind === "flow") target.flowLinks += 1;
      else target.importLinks += 1;
    }
  }

  const nodes = rawNodes.map((node) => {
    const counts = interaction.get(node.id) || {
      importLinks: 0,
      apiLinks: 0,
      configLinks: 0,
      flowLinks: 0,
      degree: 0
    };
    const importance = Number(node?.data?.importance || 0);
    const rawScore = Math.max(
      1,
      importance + counts.degree * 1.8 + counts.apiLinks * 2.2 + counts.configLinks * 1.2
    );
    const visualScore = Math.min(100, Math.log2(rawScore + 1) * 20);
    const width = Math.round(190 + visualScore * 1.55);
    const minHeight = Math.round(90 + visualScore * 0.5);
    return {
      id: node.id,
      type: "repoNode",
      position: node.position || { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        ...node.data,
        ...counts,
        score: rawScore,
        visualScore,
        zone: zoneOf(node?.data?.path),
        width,
        minHeight
      }
    };
  });

  const edges = rawEdges.map((edge) => {
    const kind = edge?.data?.kind || "import";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        kind
      },
      type: "smoothstep",
      animated: kind === "api",
      style: {
        stroke: edgeColor(kind),
        strokeWidth: kind === "api" ? 2.8 : kind === "flow" ? 2.7 : kind === "config" ? 2.2 : 1.6,
        strokeDasharray: kind === "import" ? "5 5" : kind === "config" ? "4 5" : undefined,
        opacity: kind === "api" ? 0.98 : 0.86,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      },
      markerEnd:
        kind === "flow"
          ? {
              type: MarkerType.ArrowClosed,
              width: 18,
              height: 18,
              color: edgeColor(kind)
            }
          : undefined
    };
  });

  const positionedNodes = arrangeHierarchicalLayout(nodes, rawEdges);
  return { nodes: positionedNodes, edges };
}

function RepoNode({ data, selected }) {
  const className = [
    "rf-node",
    selected || data.isFocus ? "selected" : "",
    data.isRelated ? "related" : "",
    data.isDimmed ? "dimmed" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return html`
    <div
      className=${className}
      style=${{
        width: data.width + "px",
        minHeight: data.minHeight + "px",
        borderColor: roleStroke(data.role)
      }}
      title=${data.path}
    >
      <${Handle} type="target" position=${Position.Left} className="rf-handle" />
      <${Handle} type="source" position=${Position.Right} className="rf-handle" />
      <div className="rf-node-title">${truncateMiddle(data.label, 44)}</div>
      <div className="rf-node-path">${truncateMiddle(data.path, 66)}</div>
      <div className="rf-node-badges">
        ${data.orphan ? html`<span className="rf-badge orphan">orphan</span>` : null}
        <span className=${"rf-badge " + (data.riskLevel === "high" ? "risk-high" : data.riskLevel === "medium" ? "risk-medium" : "")}>
          ${"risk:" + data.riskLevel}
        </span>
        <span className="rf-badge">${"score:" + Math.round(data.score)}</span>
        <span className="rf-badge">${"links:" + data.degree}</span>
        <span className="rf-badge">${data.zone}</span>
      </div>
    </div>
  `;
}

const nodeTypes = {
  repoNode: RepoNode
};

function App() {
  const [repoPath, setRepoPath] = useState(state.repoPath);
  const [maxNodes, setMaxNodes] = useState(220);
  const [language, setLanguage] = useState(state.lang);
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatusState] = useState({ message: "", type: "" });
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingGraph, setLoadingGraph] = useState(false);

  const [nodes, setNodes] = useState([]);
  const [allEdges, setAllEdges] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);
  const [hoverTip, setHoverTip] = useState(null);
  const [trail, setTrail] = useState([]);
  const [tourPaths, setTourPaths] = useState([]);
  const [tourIndex, setTourIndex] = useState(-1);
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [filesCollapsed, setFilesCollapsed] = useState(true);
  const [controlsPos, setControlsPos] = useState({ x: 14, y: 14 });
  const [filesPos, setFilesPos] = useState({ x: 360, y: 14 });
  const [panePercents, setPanePercents] = useState([33.33, 33.34, 33.33]);
  const rfRef = useRef(null);
  const paneLayoutRef = useRef(null);
  const paneResizeRef = useRef(null);
  const overlayDragRef = useRef(null);
  const graphStageRef = useRef(null);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [sessionUsage, setSessionUsage] = useState({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requests: 0,
    costApproxEur: 0
  });
  const [fileViewerContent, setFileViewerContent] = useState("");
  const [fileViewerLoading, setFileViewerLoading] = useState(false);
  const [fileViewerError, setFileViewerError] = useState("");

  const locale = useMemo(
    () =>
      language === "en"
        ? {
            session: "Session",
            ready: "Ready.",
            createSession: "Create session",
            creatingSession: "Creating...",
            createSessionNeeded: "Create a session before generating the graph.",
            generateGraph: "Generate graph",
            generatingGraph: "Generating...",
            graphGenerating: "Generating graph...",
            graphGeneratedStatus: "Graph generated.",
            graphReady: "Graph ready",
            nodes: "nodes",
            links: "links",
            graphError: "Graph error",
            sessionCreating: "Creating session...",
            sessionCreated: "Session created",
            sessionOpenedOn: "Session opened on",
            sessionError: "Session error",
            searchNone: "No search result.",
            searchResults: "Search",
            results: "result(s)",
            summaryTitle: "Repository Summary",
            summaryMissing: "(overview unavailable)",
            none: "(none)",
            strengths: "Strengths",
            weaknesses: "Weaknesses",
            urgentImprovements: "Urgent improvements",
            attentionPoints: "Attention points",
            security: "Security",
            suspiciousFiles: "Suspicious files to watch",
            entryPoints: "Entry points",
            suggestedCommands: "Suggested commands",
            structureNotes: "Structure notes",
            explainError: "Explain error",
            tourUnavailable: "Tour unavailable without graph.",
            tourTitle: "### AI User Tour",
            tourIntro: "Path initialized on files used when a user opens and uses the app.",
            tourStart: "Tour start:",
            tourMinimal: "- (minimal path)",
            tourLoaded: "User tour loaded",
            steps: "steps",
            tourStep: "User tour: step",
            chatCleared: "Chat cleared.",
            chatError: "Chat error",
            controls: "Graph controls",
            keyFiles: "Key files",
            riskFiles: "Risk files",
            trail: "Trail",
            importsLabel: "Imports",
            apiLinksLabel: "API links",
            configLinksLabel: "Config links",
            userFlowLabel: "User flow",
            apiFilterLabel: "API",
            configFilterLabel: "Config",
            flowFilterLabel: "Flow",
            apiFrontBackLegend: "API front->back",
            configInteractionsLegend: "Config interactions",
            connectedLabel: "Connected",
            roleLabel: "role",
            zoneLabel: "zone",
            riskLabel: "risk",
            scoreLabel: "score",
            keyCountLabel: "key",
            riskCountLabel: "risk",
            trailCountLabel: "trail",
            open: "Open",
            collapse: "Collapse",
            searchPlaceholder: "Search a file...",
            search: "Search",
            aiTour: "AI tour",
            prev: "Prev",
            next: "Next",
            fit: "Fit",
            loadingGraph: "Loading graph...",
            noNode: "No node",
            noFileSelected: "No file selected",
            clickNode: "Click a node to inspect interactions.",
            explainFile: "Explain this file",
            clear: "Clear",
            minimize: "Minimize",
            chatbot: "AI Chatbot",
            askPlaceholder: "Ask your question about the repository...",
            sending: "Sending...",
            send: "Send",
            openChatbot: "Open chatbot",
            ctrlEnter: "Ctrl/Cmd + Enter to send",
            chatCostTitle: "Current session cost (approx.)",
            chatCostEur: "EUR",
            chatCostInput: "input",
            chatCostOutput: "output",
            chatCostRequests: "requests",
            repoPath: "Local repo path",
            language: "Language",
            languageFrench: "French",
            languageEnglish: "English",
            maxNodes: "Max nodes",
            responseInProgress: "Response in progress...",
            statusDefault: "Ready.",
            mustProvideRepoPath: "Repo path is required.",
            graphRootSummaryPrefix: "nodes",
            graphRootSummaryMiddle: "edges",
            graphRootSummaryRoot: "root",
            graphRootSummaryEmpty: "Create a session and generate the graph.",
            viewerNoSelection: "No file selected.",
            viewerClickNode: "Click a node to open file content.",
            viewerLoading: "Loading file...",
            viewerReadError: "File read error",
            viewerRefresh: "Reload file",
            viewerExplain: "Explain this file in chat",
            viewerLinesLabel: "lines"
          }
        : {
            session: "Session",
            ready: "Pret.",
            createSession: "Creer session",
            creatingSession: "Creation...",
            createSessionNeeded: "Cree une session avant de generer le graphe.",
            generateGraph: "Generer graphe",
            generatingGraph: "Generation...",
            graphGenerating: "Generation du graphe...",
            graphGeneratedStatus: "Graphe genere.",
            graphReady: "Graphe pret",
            nodes: "noeuds",
            links: "liens",
            graphError: "Erreur graphe",
            sessionCreating: "Creation de session...",
            sessionCreated: "Session creee",
            sessionOpenedOn: "Session ouverte sur",
            sessionError: "Erreur session",
            searchNone: "Aucun resultat de recherche.",
            searchResults: "Recherche",
            results: "resultat(s)",
            summaryTitle: "Synthese du depot",
            summaryMissing: "(synthese indisponible)",
            none: "(aucun)",
            strengths: "Points forts",
            weaknesses: "Points faibles",
            urgentImprovements: "Urgences a ameliorer",
            attentionPoints: "Points d'attention",
            security: "Securite",
            suspiciousFiles: "Fichiers suspects a surveiller",
            entryPoints: "Points d'entree",
            suggestedCommands: "Commandes conseillees",
            structureNotes: "Notes de structure",
            explainError: "Erreur d'explication",
            tourUnavailable: "Tour indisponible sans graphe.",
            tourTitle: "### Tour utilisateur IA",
            tourIntro: "Parcours initialise sur les fichiers utilises quand un utilisateur arrive et utilise l'app.",
            tourStart: "Debut du parcours:",
            tourMinimal: "- (parcours minimal)",
            tourLoaded: "Tour utilisateur charge",
            steps: "etapes",
            tourStep: "Tour utilisateur: etape",
            chatCleared: "Chat efface.",
            chatError: "Erreur chat",
            controls: "Controles du graphe",
            keyFiles: "Fichiers cles",
            riskFiles: "Fichiers a risque",
            trail: "Parcours",
            importsLabel: "Imports",
            apiLinksLabel: "Liens API",
            configLinksLabel: "Liens config",
            userFlowLabel: "Flux utilisateur",
            apiFilterLabel: "API",
            configFilterLabel: "Config",
            flowFilterLabel: "Flux",
            apiFrontBackLegend: "API front->back",
            configInteractionsLegend: "Interactions config",
            connectedLabel: "Connectes",
            roleLabel: "role",
            zoneLabel: "zone",
            riskLabel: "risque",
            scoreLabel: "score",
            keyCountLabel: "cles",
            riskCountLabel: "risques",
            trailCountLabel: "parcours",
            open: "Ouvrir",
            collapse: "Reduire",
            searchPlaceholder: "Rechercher un fichier...",
            search: "Rechercher",
            aiTour: "Tour IA",
            prev: "Prec",
            next: "Suiv",
            fit: "Ajuster vue",
            loadingGraph: "Chargement du graphe...",
            noNode: "Aucun noeud",
            noFileSelected: "Aucun fichier selectionne",
            clickNode: "Clique un noeud pour voir ses interactions.",
            explainFile: "Expliquer ce fichier",
            clear: "Effacer",
            minimize: "Minimiser",
            chatbot: "Chatbot IA",
            askPlaceholder: "Pose ta question sur le repo...",
            sending: "Envoi...",
            send: "Envoyer",
            openChatbot: "Ouvrir le chatbot",
            ctrlEnter: "Ctrl/Cmd + Enter pour envoyer",
            chatCostTitle: "Cout approx. de la session",
            chatCostEur: "EUR",
            chatCostInput: "input",
            chatCostOutput: "output",
            chatCostRequests: "demandes",
            repoPath: "Chemin du repo local",
            language: "Langue",
            languageFrench: "Francais",
            languageEnglish: "Anglais",
            maxNodes: "Noeuds max",
            responseInProgress: "Reponse en cours...",
            statusDefault: "Pret.",
            mustProvideRepoPath: "Chemin du repo obligatoire.",
            graphRootSummaryPrefix: "noeuds",
            graphRootSummaryMiddle: "liens",
            graphRootSummaryRoot: "racine",
            graphRootSummaryEmpty: "Cree une session puis genere le graphe.",
            viewerNoSelection: "Aucun fichier selectionne.",
            viewerClickNode: "Clique un noeud pour ouvrir le contenu du fichier.",
            viewerLoading: "Chargement du fichier...",
            viewerReadError: "Erreur lecture fichier",
            viewerRefresh: "Recharger fichier",
            viewerExplain: "Expliquer ce fichier dans le chat",
            viewerLinesLabel: "lignes"
          },
    [language]
  );

  const t = useCallback((key) => locale[key] || key, [locale]);

  const applySessionUsage = useCallback((payload) => {
    const usage = payload?.sessionUsage;
    if (!usage || typeof usage !== "object") return;
    setSessionUsage({
      inputTokens: Math.max(0, Number(usage.inputTokens) || 0),
      outputTokens: Math.max(0, Number(usage.outputTokens) || 0),
      totalTokens: Math.max(0, Number(usage.totalTokens) || 0),
      requests: Math.max(0, Number(usage.requests) || 0),
      costApproxEur: Math.max(0, Number(usage.costApproxEur) || 0)
    });
  }, []);

  const filteredEdges = useMemo(() => {
    return allEdges.filter((edge) => {
      const kind = edge?.data?.kind || "import";
      return Boolean(filters[kind]);
    });
  }, [allEdges, filters]);

  useEffect(() => {
    window.localStorage.setItem("repoWatcherLang", language);
    document.documentElement.lang = language;
    state.lang = language;
  }, [language]);

  const focusNodeId = hoveredNodeId || selectedNodeId;
  const focusEdgeId = hoveredEdgeId || selectedEdgeId;

  const edgeById = useMemo(() => {
    const map = new Map();
    for (const edge of allEdges) map.set(edge.id, edge);
    return map;
  }, [allEdges]);

  const focusGraph = useMemo(() => {
    const relatedNodes = new Set();
    const focusEdgeIds = new Set();
    if (focusEdgeId) {
      const focusedEdge = edgeById.get(focusEdgeId);
      if (focusedEdge) {
        focusEdgeIds.add(focusedEdge.id);
        relatedNodes.add(focusedEdge.source);
        relatedNodes.add(focusedEdge.target);
      }
    }
    if (focusNodeId) {
      for (const edge of allEdges) {
        if (edge.source !== focusNodeId && edge.target !== focusNodeId) continue;
        focusEdgeIds.add(edge.id);
        relatedNodes.add(edge.source);
        relatedNodes.add(edge.target);
      }
    }
    return { relatedNodes, focusEdgeIds };
  }, [allEdges, edgeById, focusNodeId, focusEdgeId]);

  const displayNodes = useMemo(() => {
    const hasFocus = Boolean(focusNodeId || focusEdgeId);
    return nodes.map((node) => {
      const isFocus = focusNodeId === node.id;
      const isRelated = focusGraph.relatedNodes.has(node.id);
      const isDimmed = hasFocus && !isFocus && !isRelated;
      return {
        ...node,
        data: {
          ...node.data,
          isFocus,
          isRelated,
          isDimmed
        }
      };
    });
  }, [nodes, focusNodeId, focusEdgeId, focusGraph]);

  const displayEdges = useMemo(() => {
    const hasFocus = Boolean(focusNodeId || focusEdgeId);
    return filteredEdges.map((edge) => {
      const isFocused = focusGraph.focusEdgeIds.has(edge.id);
      const isDimmed = hasFocus && !isFocused;
      const baseWidth = Number(edge?.style?.strokeWidth || 2);
      return {
        ...edge,
        animated: isFocused ? true : edge.animated,
        className: isFocused ? "rf-edge-focus" : isDimmed ? "rf-edge-dim" : "rf-edge-normal",
        style: {
          ...edge.style,
          strokeWidth: isFocused ? baseWidth + 1.15 : baseWidth,
          opacity: isDimmed ? 0.1 : isFocused ? 1 : Number(edge?.style?.opacity || 0.86)
        }
      };
    });
  }, [filteredEdges, focusGraph, focusNodeId, focusEdgeId]);

  const nodeById = useMemo(() => {
    const map = new Map();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const selectedNode = useMemo(() => nodeById.get(selectedNodeId) || null, [nodeById, selectedNodeId]);

  const keyFiles = useMemo(() => (Array.isArray(summary?.keyFiles) ? summary.keyFiles : []), [summary]);
  const riskFiles = useMemo(() => (Array.isArray(summary?.riskFiles) ? summary.riskFiles : []), [summary]);

  const onNodesChange = useCallback((changes) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  const pointForTip = useCallback((event) => ({ x: event.clientX + 14, y: event.clientY + 12 }), []);

  const showNodeTip = useCallback(
    (event, node) => {
      if (!node) return;
      const p = pointForTip(event);
      setHoverTip({
        ...p,
        title: node.data.label,
        lines: [
          node.data.path,
          "role: " + (node.data.role || "unknown"),
          "score: " + Math.round(Number(node.data.score || 0))
        ]
      });
    },
    [pointForTip]
  );

  const showEdgeTip = useCallback(
    (event, edge) => {
      if (!edge) return;
      const p = pointForTip(event);
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      const kind = edge?.data?.kind || "import";
      setHoverTip({
        ...p,
        title: "Lien " + kind,
        lines: [
          (sourceNode?.data?.label || edge.source) + " → " + (targetNode?.data?.label || edge.target),
          (sourceNode?.data?.path || edge.source) + " → " + (targetNode?.data?.path || edge.target)
        ]
      });
    },
    [nodeById, pointForTip]
  );

  const moveTip = useCallback(
    (event) => {
      const p = pointForTip(event);
      setHoverTip((prev) => (prev ? { ...prev, ...p } : prev));
    },
    [pointForTip]
  );

  const centerNode = useCallback(
    (node) => {
      if (!node || !rfRef.current) return;
      const width = Number(node?.data?.width || 220);
      const height = Number(node?.data?.minHeight || 96);
      rfRef.current.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: Math.max(0.65, Math.min(1.4, 1 + node.data.score * 0.01)),
        duration: 420
      });
    },
    []
  );

  const selectNode = useCallback(
    (nodeId, center = false) => {
      const node = nodeById.get(nodeId);
      if (!node) return;
      setSelectedNodeId(node.id);
      setTrail((prev) => {
        if (prev[prev.length - 1] === node.id) return prev;
        const next = [...prev, node.id];
        return next.slice(-12);
      });
      if (center) centerNode(node);
    },
    [nodeById, centerNode]
  );

  const loadSelectedFile = useCallback(
    async (pathValue) => {
      if (!sessionId || !pathValue) {
        setFileViewerContent("");
        setFileViewerError("");
        setFileViewerLoading(false);
        return;
      }
      setFileViewerLoading(true);
      setFileViewerError("");
      try {
        const response = await fetch(state.apiBase + "/api/sessions/" + sessionId + "/file/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: pathValue })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "File read failed");
        }
        const content = typeof payload.content === "string" ? payload.content : "";
        setFileViewerContent(content);
      } catch (error) {
        setFileViewerContent("");
        setFileViewerError(error.message || String(error));
      } finally {
        setFileViewerLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    if (!selectedNode?.data?.path) {
      setFileViewerContent("");
      setFileViewerError("");
      setFileViewerLoading(false);
      return;
    }
    loadSelectedFile(selectedNode.data.path);
  }, [selectedNode, loadSelectedFile]);

  const addChatMessage = useCallback((message) => {
    setChatMessages((prev) => [...prev, message]);
  }, []);

  const updateChatMessage = useCallback((id, updater) => {
    setChatMessages((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updater(item) } : item))
    );
  }, []);

  const fetchRepoOverview = useCallback(
    async (sid) => {
      const response = await fetch(state.apiBase + "/api/sessions/" + sid + "/repo_overview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootPath: DEFAULT_GRAPH_ROOT_PATH,
          maxNodes: Number(maxNodes) || 220,
          lang: language
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Repo overview failed");
      }
      applySessionUsage(payload);
      const data = payload?.overview || {};
      const section = (title, values) => {
        const list = Array.isArray(values) ? values.filter(Boolean) : [];
        return [title + ":", ...(list.length > 0 ? list.map((item) => "- " + item) : ["- " + t("none")]), ""];
      };
      const text = [
        "## " + t("summaryTitle"),
        "",
        data.overview || t("summaryMissing"),
        "",
        ...section(t("strengths"), data.strengths),
        ...section(t("weaknesses"), data.weaknesses),
        ...section(t("urgentImprovements"), data.urgentImprovements),
        ...section(t("attentionPoints"), data.attentionPoints),
        ...section(t("security"), data.securityFindings),
        ...section(t("suspiciousFiles"), data.suspiciousFiles),
        ...section(t("entryPoints"), data.entryPoints),
        ...section(t("suggestedCommands"), data.suggestedCommands),
        ...section(t("structureNotes"), data.directoryNotes)
      ].join("\n");
      addChatMessage(createMessage("assistant", text, "repo-overview"));
    },
    [maxNodes, language, addChatMessage, applySessionUsage, t]
  );

  const generateGraph = useCallback(
    async (sid = sessionId, withOverview = false) => {
      if (!sid) {
        setStatus(setStatusState, t("createSessionNeeded"), "err");
        return;
      }
      setLoadingGraph(true);
      setStatus(setStatusState, t("graphGenerating"), "");
      try {
        const response = await fetch(state.apiBase + "/api/sessions/" + sid + "/repo_graph", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rootPath: DEFAULT_GRAPH_ROOT_PATH,
            maxNodes: Number(maxNodes) || 220,
            lang: language
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Repo graph generation failed");
        }
        const prepared = buildNodeAndEdgeData(payload);
        setNodes(prepared.nodes);
        setAllEdges(prepared.edges);
        setSummary(payload.summary || null);
        setSelectedNodeId(null);
        setHoveredNodeId(null);
        setSelectedEdgeId(null);
        setHoveredEdgeId(null);
        setHoverTip(null);
        setTrail([]);
        setTourPaths([]);
        setTourIndex(-1);
        setStatus(setStatusState, t("graphGeneratedStatus"), "ok");
        addChatMessage(
          createMessage(
            "assistant",
            t("graphReady") +
              ": " +
              (payload.summary?.nodeCount || 0) +
              " " +
              t("nodes") +
              ", " +
              (payload.summary?.edgeCount || 0) +
              " " +
              t("links") +
              ".",
            "repo-graph"
          )
        );
        requestAnimationFrame(() => {
          rfRef.current?.fitView({ padding: 0.18, duration: 350 });
        });
        if (withOverview) {
          await fetchRepoOverview(sid);
        }
      } catch (error) {
        setStatus(setStatusState, t("graphError") + ": " + (error.message || String(error)), "err");
        addChatMessage(
          createMessage("assistant", t("graphError") + ": " + (error.message || String(error)), "error")
        );
      } finally {
        setLoadingGraph(false);
      }
    },
    [sessionId, maxNodes, language, setNodes, addChatMessage, fetchRepoOverview, t]
  );

  const createSession = useCallback(async () => {
    const pathValue = String(repoPath || "").trim();
    if (!pathValue) {
      setStatus(setStatusState, t("mustProvideRepoPath"), "err");
      return;
    }
    setLoadingSession(true);
    setStatus(setStatusState, t("sessionCreating"), "");
    try {
      const response = await fetch(state.apiBase + "/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath: pathValue })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Session creation failed");
      }
      window.localStorage.setItem("repoWatcherRepoPath", pathValue);
      setSessionId(payload.id);
      setSessionUsage({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requests: 0,
        costApproxEur: 0
      });
      state.sessionId = payload.id;
      setStatus(setStatusState, t("sessionCreated") + ": " + payload.id, "ok");
      addChatMessage(createMessage("system", t("sessionOpenedOn") + " " + pathValue, "session"));
      await generateGraph(payload.id, true);
    } catch (error) {
      setStatus(setStatusState, t("sessionError") + ": " + (error.message || String(error)), "err");
    } finally {
      setLoadingSession(false);
    }
  }, [repoPath, addChatMessage, generateGraph, t]);

  const onSearch = useCallback(() => {
    const needle = String(searchTerm || "").trim().toLowerCase();
    if (!needle) return;
    const matches = [...nodes]
      .map((node) => {
        const pathValue = String(node.data.path || "").toLowerCase();
        const label = String(node.data.label || "").toLowerCase();
        const role = String(node.data.role || "").toLowerCase();
        let score = 0;
        if (pathValue === needle) score += 12;
        if (label === needle) score += 10;
        if (pathValue.includes(needle)) score += 4;
        if (label.includes(needle)) score += 5;
        if (role.includes(needle)) score += 3;
        return { node, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.node.data.score - a.node.data.score);
    if (matches.length === 0) {
      setStatus(setStatusState, t("searchNone"), "err");
      return;
    }
    const pathIds = matches.slice(0, 12).map((item) => item.node.id);
    setTourPaths(pathIds);
    setTourIndex(0);
    selectNode(pathIds[0], true);
    setStatus(setStatusState, t("searchResults") + ": " + matches.length + " " + t("results") + ".", "ok");
  }, [searchTerm, nodes, selectNode, t]);

  const explainNodeStep = useCallback(async ({
    nodeId,
    stepIndex = 0,
    totalSteps = 1,
    orderedNodeIds = [],
    source = "explain-file"
  }) => {
    if (!sessionId || !nodeId) return;
    const node = nodeById.get(nodeId);
    if (!node) return;
    const message = createMessage("assistant", "", "explain-file", true);
    addChatMessage(message);
    try {
      const priorIds = Array.isArray(orderedNodeIds) ? orderedNodeIds.slice(0, Math.max(0, stepIndex)) : [];
      const priorPaths = priorIds
        .map((id) => nodeById.get(id)?.data?.path)
        .filter(Boolean)
        .slice(-10);
      const response = await fetch(state.apiBase + "/api/sessions/" + sessionId + "/explain_file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: node.data.path,
          rootPath: DEFAULT_GRAPH_ROOT_PATH,
          maxNodes: Number(maxNodes) || 220,
          trailPaths: priorPaths,
          lang: language
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Explain failed");
      }
      applySessionUsage(payload);
      const exp = payload.explanation || {};
      const normalizedStep = Number.isFinite(stepIndex) ? Math.max(0, stepIndex) : 0;
      const normalizedTotal = Number.isFinite(totalSteps) ? Math.max(1, totalSteps) : 1;
      const text = [
        `${language === "en" ? "### Step" : "### Etape"} ${normalizedStep + 1}/${normalizedTotal} - ${node.data.label}`,
        `${language === "en" ? "File" : "Fichier"}: \`${node.data.path}\``,
        "",
        language === "en" ? "Why in the user flow:" : "Pourquoi dans le flow utilisateur:",
        exp.whyInFlow || "",
        "",
        language === "en" ? "What this file does:" : "Ce que fait ce fichier:",
        exp.overview || "",
        "",
        language === "en" ? "Utility in the app:" : "Utilite dans l'app:",
        exp.utilityInApp || "",
        "",
        language === "en" ? "Interactions:" : "Interactions:",
        ...(Array.isArray(exp.interactions) && exp.interactions.length > 0 ? exp.interactions : [t("none")]),
        "",
        language === "en" ? "Attention points:" : "Points de vigilance:",
        ...(Array.isArray(exp.risks) && exp.risks.length > 0 ? exp.risks : [t("none")])
      ].join("\n");
      updateChatMessage(message.id, () => ({ loading: false, text, meta: source + " done" }));
    } catch (error) {
      updateChatMessage(message.id, () => ({
        loading: false,
        text: t("explainError") + ": " + (error.message || String(error)),
        meta: "error"
      }));
    }
  }, [sessionId, maxNodes, language, nodeById, addChatMessage, updateChatMessage, applySessionUsage, t]);

  const buildUserJourneyTour = useCallback(() => {
    if (nodes.length === 0) return [];

    const nodeMap = new Map();
    const outgoingByKind = new Map();
    const incomingByKind = new Map();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      outgoingByKind.set(node.id, { flow: [], api: [], import: [], config: [] });
      incomingByKind.set(node.id, { flow: 0, api: 0, import: 0, config: 0 });
    }

    for (const edge of allEdges) {
      const kind = edge?.data?.kind || "import";
      if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
      const out = outgoingByKind.get(edge.source);
      if (out && Array.isArray(out[kind])) out[kind].push(edge.target);
      const incoming = incomingByKind.get(edge.target);
      if (incoming) incoming[kind] += 1;
    }

    const nodeWeight = (node) => {
      const incoming = incomingByKind.get(node.id) || { flow: 0, api: 0, import: 0, config: 0 };
      return (
        Number(node?.data?.visualScore || 0) +
        Number(node?.data?.degree || 0) * 1.9 +
        (isEntryLike(node) ? 44 : 0) +
        (node?.data?.zone === "frontend" ? 18 : 0) +
        (node?.data?.role === "entry" ? 18 : 0) +
        (incoming.flow + incoming.api === 0 ? 10 : 0)
      );
    };

    const startCandidates = [...nodes]
      .filter((node) => {
        const incoming = incomingByKind.get(node.id) || { flow: 0, api: 0, import: 0, config: 0 };
        return isEntryLike(node) || (node?.data?.zone === "frontend" && incoming.flow + incoming.api === 0);
      })
      .sort((a, b) => nodeWeight(b) - nodeWeight(a));

    const startNode =
      startCandidates[0] ||
      [...nodes].sort((a, b) => nodeWeight(b) - nodeWeight(a) || String(a?.data?.path || "").localeCompare(String(b?.data?.path || "")))[0];
    if (!startNode) return [];

    const visited = new Set();
    const ids = [];
    let currentId = startNode.id;

    const nextWeight = (nextNode, kind, currentZone) => {
      const incoming = incomingByKind.get(nextNode.id) || { flow: 0, api: 0, import: 0, config: 0 };
      return (
        Number(nextNode?.data?.visualScore || 0) +
        Number(nextNode?.data?.degree || 0) * 1.6 +
        (kind === "flow" ? 56 : kind === "api" ? 48 : kind === "import" ? 20 : 8) +
        (kind === "api" && currentZone === "frontend" && nextNode?.data?.zone === "backend" ? 30 : 0) +
        (nextNode?.data?.role === "service" ? 12 : 0) +
        (nextNode?.data?.role === "routing" ? 8 : 0) -
        Math.min(8, incoming.import * 0.4)
      );
    };

    while (currentId && ids.length < 14) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      ids.push(currentId);
      const currentNode = nodeMap.get(currentId);
      if (!currentNode) break;
      const currentZone = currentNode?.data?.zone || zoneOf(currentNode?.data?.path);
      const out = outgoingByKind.get(currentId) || { flow: [], api: [], import: [], config: [] };
      let nextId = null;
      for (const kind of ["flow", "api", "import", "config"]) {
        const candidates = (out[kind] || [])
          .filter((targetId) => nodeMap.has(targetId) && !visited.has(targetId))
          .sort((a, b) => {
            const scoreB = nextWeight(nodeMap.get(b), kind, currentZone);
            const scoreA = nextWeight(nodeMap.get(a), kind, currentZone);
            return scoreB - scoreA;
          });
        if (candidates.length > 0) {
          nextId = candidates[0];
          break;
        }
      }
      if (!nextId) break;
      currentId = nextId;
    }

    const appendPath = (pathValue) => {
      const node = nodes.find((item) => item.id === pathValue || item.data.path === pathValue);
      if (!node || visited.has(node.id)) return;
      visited.add(node.id);
      ids.push(node.id);
    };
    for (const pathValue of keyFiles) appendPath(pathValue);
    for (const pathValue of riskFiles) appendPath(pathValue);

    return ids.slice(0, 14);
  }, [nodes, allEdges, keyFiles, riskFiles]);

  const startTour = useCallback(async () => {
    const ids = buildUserJourneyTour();
    if (ids.length === 0) {
      setStatus(setStatusState, t("tourUnavailable"), "err");
      return;
    }

    setTourPaths(ids);
    setTourIndex(0);
    selectNode(ids[0], true);

    const orderedPaths = ids
      .map((id) => nodeById.get(id)?.data?.path)
      .filter(Boolean)
      .slice(0, 6)
      .map((item) => "- " + item)
      .join("\n");

    addChatMessage(
      createMessage(
        "assistant",
        [
          t("tourTitle"),
          t("tourIntro"),
          "",
          t("tourStart"),
          orderedPaths || t("tourMinimal")
        ].join("\n"),
        "tour"
      )
    );
    setStatus(setStatusState, t("tourLoaded") + " (" + ids.length + " " + t("steps") + ").", "ok");
    await explainNodeStep({
      nodeId: ids[0],
      stepIndex: 0,
      totalSteps: ids.length,
      orderedNodeIds: ids,
      source: "tour-step"
    });
  }, [buildUserJourneyTour, nodeById, addChatMessage, selectNode, explainNodeStep, t]);

  const moveTour = useCallback(
    async (direction) => {
      if (tourPaths.length === 0 || tourIndex < 0) return;
      const next = tourIndex + direction;
      if (next < 0 || next >= tourPaths.length) return;
      setTourIndex(next);
      selectNode(tourPaths[next], true);
      setStatus(
        setStatusState,
        t("tourStep") + " " + (next + 1) + "/" + tourPaths.length,
        "ok"
      );
      await explainNodeStep({
        nodeId: tourPaths[next],
        stepIndex: next,
        totalSteps: tourPaths.length,
        orderedNodeIds: tourPaths,
        source: "tour-step"
      });
    },
    [tourPaths, tourIndex, selectNode, explainNodeStep]
  );

  const explainSelectedFile = useCallback(async () => {
    if (!selectedNode) return;
    const indexInTour = tourPaths.indexOf(selectedNode.id);
    const orderedNodeIds =
      indexInTour >= 0
        ? tourPaths
        : trail.length > 0
          ? trail
          : [selectedNode.id];
    const stepIndex = indexInTour >= 0 ? indexInTour : Math.max(0, orderedNodeIds.length - 1);
    await explainNodeStep({
      nodeId: selectedNode.id,
      stepIndex,
      totalSteps: Math.max(1, orderedNodeIds.length),
      orderedNodeIds,
      source: "explain-file"
    });
  }, [selectedNode, tourPaths, trail, explainNodeStep]);

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setStatus(setStatusState, t("chatCleared"), "");
  }, [t]);

  const sendChat = useCallback(async () => {
    if (!sessionId || chatSending) return;
    const messageText = String(chatInput || "").trim();
    if (!messageText) return;
    setChatInput("");
    setChatSending(true);
    addChatMessage(createMessage("user", messageText, "you"));
    const assistant = createMessage("assistant", "", "stream", true);
    addChatMessage(assistant);
    try {
      const response = await fetch(state.apiBase + "/api/sessions/" + sessionId + "/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: messageText, lang: language })
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Chat stream failed");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (event.type === "meta") {
            updateChatMessage(assistant.id, (msg) => ({ meta: "stream | " + (event.mode || msg.meta) }));
            applySessionUsage(event);
            continue;
          }
          if (event.type === "delta") {
            updateChatMessage(assistant.id, (msg) => ({
              loading: false,
              text: (msg.text || "") + String(event.text || "")
            }));
            continue;
          }
          if (event.type === "done") {
            applySessionUsage(event);
            updateChatMessage(assistant.id, () => ({ loading: false }));
            continue;
          }
          if (event.type === "error") {
            updateChatMessage(assistant.id, () => ({
              loading: false,
              meta: "error",
              text: t("chatError") + ": " + String(event.message || "Unknown error")
            }));
          }
        }
      }
      updateChatMessage(assistant.id, () => ({ loading: false }));
    } catch (error) {
      updateChatMessage(assistant.id, () => ({
        loading: false,
        meta: "error",
        text: t("chatError") + ": " + (error.message || String(error))
      }));
    } finally {
      setChatSending(false);
    }
  }, [sessionId, chatSending, chatInput, language, addChatMessage, updateChatMessage, applySessionUsage, t]);

  const summaryText = summary
    ? t("graphRootSummaryPrefix") +
      ": " +
      (summary.nodeCount || 0) +
      " • " +
      t("graphRootSummaryMiddle") +
      ": " +
      (summary.edgeCount || 0) +
      " • " +
      t("graphRootSummaryRoot") +
      ": " +
      (summary.rootPath || ".")
    : t("graphRootSummaryEmpty");

  const localeTag = language === "en" ? "en-US" : "fr-FR";
  const sessionCostText = useMemo(() => {
    const num = new Intl.NumberFormat(localeTag, { maximumFractionDigits: 0 });
    const eur = new Intl.NumberFormat(localeTag, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    });
    return (
      `~${eur.format(Number(sessionUsage.costApproxEur || 0))} ${t("chatCostEur")} · ` +
      `${t("chatCostInput")}: ${num.format(Number(sessionUsage.inputTokens || 0))} · ` +
      `${t("chatCostOutput")}: ${num.format(Number(sessionUsage.outputTokens || 0))} · ` +
      `${t("chatCostRequests")}: ${num.format(Number(sessionUsage.requests || 0))}`
    );
  }, [localeTag, sessionUsage, t]);

  const fileViewerLineCount = useMemo(
    () => (fileViewerContent ? fileViewerContent.split(/\r?\n/).length : 0),
    [fileViewerContent]
  );

  const startPaneResize = useCallback(
    (splitterIndex, event) => {
      if (!paneLayoutRef.current) return;
      const rect = paneLayoutRef.current.getBoundingClientRect();
      paneResizeRef.current = {
        splitterIndex,
        startX: event.clientX,
        width: Math.max(1, rect.width),
        percents: [...panePercents]
      };
      event.preventDefault();
    },
    [panePercents]
  );

  useEffect(() => {
    const MIN_PANEL_PERCENT = 12;
    const onMove = (event) => {
      const drag = paneResizeRef.current;
      if (!drag) return;
      const deltaPercent = ((event.clientX - drag.startX) / drag.width) * 100;
      if (drag.splitterIndex === 0) {
        const total = drag.percents[0] + drag.percents[1];
        const nextLeft = Math.max(
          MIN_PANEL_PERCENT,
          Math.min(total - MIN_PANEL_PERCENT, drag.percents[0] + deltaPercent)
        );
        const nextCenter = total - nextLeft;
        setPanePercents([nextLeft, nextCenter, drag.percents[2]]);
      } else {
        const total = drag.percents[1] + drag.percents[2];
        const nextCenter = Math.max(
          MIN_PANEL_PERCENT,
          Math.min(total - MIN_PANEL_PERCENT, drag.percents[1] + deltaPercent)
        );
        const nextRight = total - nextCenter;
        setPanePercents([drag.percents[0], nextCenter, nextRight]);
      }
    };
    const onUp = () => {
      paneResizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startOverlayDrag = useCallback((kind, event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button,input,textarea,select,label")) {
      return;
    }
    const current = kind === "controls" ? controlsPos : filesPos;
    overlayDragRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      x: current.x,
      y: current.y
    };
    event.preventDefault();
  }, [controlsPos, filesPos]);

  useEffect(() => {
    const onMove = (event) => {
      const drag = overlayDragRef.current;
      if (!drag) return;
      const stage = graphStageRef.current;
      const maxX = stage ? Math.max(8, stage.clientWidth - 140) : Number.POSITIVE_INFINITY;
      const maxY = stage ? Math.max(8, stage.clientHeight - 90) : Number.POSITIVE_INFINITY;
      const next = {
        x: Math.max(8, Math.min(maxX, drag.x + (event.clientX - drag.startX))),
        y: Math.max(8, Math.min(maxY, drag.y + (event.clientY - drag.startY)))
      };
      if (drag.kind === "controls") {
        setControlsPos(next);
      } else {
        setFilesPos(next);
      }
    };
    const onUp = () => {
      overlayDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return html`
    <main className="workspace">
      <section className="session-bar">
        <label className="top-control repo">
          ${t("repoPath")}
          <input
            value=${repoPath}
            onChange=${(e) => setRepoPath(e.target.value)}
            placeholder="/Users/.../my-repo"
          />
        </label>
        <label className="top-control max">
          ${t("maxNodes")}
          <input
            type="number"
            min="20"
            max="400"
            value=${maxNodes}
            onChange=${(e) => setMaxNodes(Number(e.target.value || 220))}
          />
        </label>
        <button className="top-action" onClick=${createSession} disabled=${loadingSession}>
          ${loadingSession ? t("creatingSession") : t("createSession")}
        </button>
        <button className="secondary top-action" onClick=${() => generateGraph()} disabled=${!sessionId || loadingGraph}>
          ${loadingGraph ? t("generatingGraph") : t("generateGraph")}
        </button>
        <div className="lang-switch" role="group" aria-label=${t("language")}>
          <button
            type="button"
            className=${"lang-flag " + (language === "fr" ? "active" : "")}
            title=${t("languageFrench")}
            aria-pressed=${language === "fr"}
            onClick=${() => setLanguage("fr")}
          >
            🇫🇷
          </button>
          <button
            type="button"
            className=${"lang-flag " + (language === "en" ? "active" : "")}
            title=${t("languageEnglish")}
            aria-pressed=${language === "en"}
            onClick=${() => setLanguage("en")}
          >
            🇺🇸
          </button>
        </div>
      </section>

      <section className="pane-layout" ref=${paneLayoutRef}>
        <section className="pane pane-left" style=${{ width: panePercents[0] + "%" }}>
          <div className="file-viewer-shell">
            <div className="file-viewer-head">
              <div>
                <div className="file-viewer-path">
                  ${selectedNode?.data?.path || t("viewerNoSelection")}
                </div>
                <div className="file-viewer-meta">
                  ${fileViewerError
                    ? t("viewerReadError") + ": " + fileViewerError
                    : selectedNode?.data?.path
                      ? fileViewerLineCount + " " + t("viewerLinesLabel")
                      : t("viewerClickNode")}
                </div>
              </div>
              <div className="file-viewer-actions">
                <button
                  className="secondary"
                  disabled=${!selectedNode?.data?.path || fileViewerLoading}
                  onClick=${() => loadSelectedFile(selectedNode?.data?.path || "")}
                >
                  ${t("viewerRefresh")}
                </button>
                <button onClick=${explainSelectedFile} disabled=${!selectedNode}>
                  ${t("viewerExplain")}
                </button>
              </div>
            </div>
            <div className="file-viewer-body">
              ${fileViewerLoading
                ? html`<div className="spinner">${t("viewerLoading")}</div>`
                : fileViewerContent
                  ? html`
                      <div className="file-code">
                        ${fileViewerContent.split(/\r?\n/).map(
                          (line, index) => html`
                            <div className="file-line">
                              <span className="file-ln">${index + 1}</span>
                              <span className="file-text">${line || " "}</span>
                            </div>
                          `
                        )}
                      </div>
                    `
                  : html`<div className="file-viewer-empty">${t("viewerClickNode")}</div>`}
            </div>
          </div>
        </section>

        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          onPointerDown=${(event) => startPaneResize(0, event)}
        ></div>

        <section className="pane pane-center" style=${{ width: panePercents[1] + "%" }}>
          <section className="graph-shell">
            <div className="graph-canvas" ref=${graphStageRef}>
              <${ReactFlowProvider}>
                <${ReactFlow}
                  nodes=${displayNodes}
                  edges=${displayEdges}
                  nodeTypes=${nodeTypes}
                  onNodesChange=${onNodesChange}
                  onInit=${(instance) => {
                    rfRef.current = instance;
                  }}
                  onNodeClick=${(_event, node) => {
                    setSelectedEdgeId(null);
                    selectNode(node.id);
                  }}
                  onNodeMouseEnter=${(event, node) => {
                    setHoveredEdgeId(null);
                    setHoveredNodeId(node.id);
                    showNodeTip(event, node);
                  }}
                  onNodeMouseMove=${(event) => moveTip(event)}
                  onNodeMouseLeave=${() => {
                    setHoveredNodeId(null);
                    setHoverTip(null);
                  }}
                  onEdgeClick=${(event, edge) => {
                    setSelectedNodeId(null);
                    setHoveredNodeId(null);
                    setSelectedEdgeId(edge.id);
                    showEdgeTip(event, edge);
                  }}
                  onEdgeMouseEnter=${(event, edge) => {
                    setHoveredNodeId(null);
                    setHoveredEdgeId(edge.id);
                    showEdgeTip(event, edge);
                  }}
                  onEdgeMouseMove=${(event) => moveTip(event)}
                  onEdgeMouseLeave=${() => {
                    setHoveredEdgeId(null);
                    setHoverTip(null);
                  }}
                  onPaneClick=${() => {
                    setSelectedNodeId(null);
                    setHoveredNodeId(null);
                    setSelectedEdgeId(null);
                    setHoveredEdgeId(null);
                    setHoverTip(null);
                  }}
                  fitView=${true}
                  fitViewOptions=${{ padding: 0.2 }}
                  minZoom=${0.25}
                  maxZoom=${2.6}
                  elevateEdgesOnSelect=${true}
                  defaultEdgeOptions=${{
                    type: "smoothstep",
                    style: { strokeWidth: 2.2, opacity: 0.9 }
                  }}
                  proOptions=${{ hideAttribution: true }}
                >
                  <${Background} gap=${26} size=${1} color="#cbd5e1" />
                  <${Controls} position="bottom-right" showInteractive=${false} />
                  <${MiniMap}
                    pannable=${true}
                    zoomable=${true}
                    nodeColor=${(node) => roleStroke(node?.data?.role)}
                    maskColor="rgba(15,23,42,0.2)"
                  />
                <//>
              <//>

              <div
                className=${"overlay-panel floating-overlay" + (controlsCollapsed ? " collapsed" : "")}
                style=${{ left: controlsPos.x + "px", top: controlsPos.y + "px" }}
              >
                <div className="overlay-head floating-head" onPointerDown=${(event) => startOverlayDrag("controls", event)}>
                  <h3>${t("controls")}</h3>
                  <button className="chip panel-toggle" onClick=${() => setControlsCollapsed((prev) => !prev)}>
                    ${controlsCollapsed ? t("open") : t("collapse")}
                  </button>
                </div>
                ${controlsCollapsed
                  ? null
                  : html`
                      <p className="overlay-muted">${summaryText}</p>
                      <div className="chip-row">
                        <label><input type="checkbox" checked=${filters.import} onChange=${() => setFilters((f) => ({ ...f, import: !f.import }))} /> ${t("importsLabel")}</label>
                        <label><input type="checkbox" checked=${filters.api} onChange=${() => setFilters((f) => ({ ...f, api: !f.api }))} /> ${t("apiFilterLabel")}</label>
                        <label><input type="checkbox" checked=${filters.config} onChange=${() => setFilters((f) => ({ ...f, config: !f.config }))} /> ${t("configFilterLabel")}</label>
                        <label><input type="checkbox" checked=${filters.flow} onChange=${() => setFilters((f) => ({ ...f, flow: !f.flow }))} /> ${t("flowFilterLabel")}</label>
                      </div>
                      <div className="flow-legend">
                        <span className="legend-item"><span className="legend-dot api"></span>${t("apiFrontBackLegend")}</span>
                        <span className="legend-item"><span className="legend-dot config"></span>${t("configInteractionsLegend")}</span>
                        <span className="legend-item"><span className="legend-dot import"></span>${t("importsLabel")}</span>
                        <span className="legend-item"><span className="legend-dot flow"></span>${t("userFlowLabel")}</span>
                      </div>
                      <div className="chip-row">
                        <input
                          value=${searchTerm}
                          onChange=${(e) => setSearchTerm(e.target.value)}
                          placeholder=${t("searchPlaceholder")}
                          onKeyDown=${(e) => {
                            if (e.key === "Enter") onSearch();
                          }}
                        />
                        <button className="secondary" onClick=${onSearch}>${t("search")}</button>
                        <button className="secondary" onClick=${startTour}>${t("aiTour")}</button>
                        <button className="secondary" disabled=${tourIndex <= 0} onClick=${() => moveTour(-1)}>${t("prev")}</button>
                        <button className="secondary" disabled=${tourIndex < 0 || tourIndex >= tourPaths.length - 1} onClick=${() => moveTour(1)}>${t("next")}</button>
                        <button className="secondary" onClick=${() => rfRef.current?.fitView({ padding: 0.18, duration: 260 })}>${t("fit")}</button>
                      </div>
                      ${loadingGraph
                        ? html`<div className="spinner">${t("loadingGraph")}</div>`
                        : null}
                    `}
              </div>

              <div
                className=${"overlay-panel floating-overlay" + (filesCollapsed ? " collapsed" : "")}
                style=${{ left: filesPos.x + "px", top: filesPos.y + "px" }}
              >
                <div className="overlay-head floating-head" onPointerDown=${(event) => startOverlayDrag("files", event)}>
                  <h3>${t("keyFiles")}</h3>
                  <button className="chip panel-toggle" onClick=${() => setFilesCollapsed((prev) => !prev)}>
                    ${filesCollapsed ? t("open") : t("collapse")}
                  </button>
                </div>
                ${filesCollapsed
                  ? null
                  : html`
                      <div className="chip-row">
                        ${keyFiles.length === 0
                          ? html`<span className="chip empty">${t("none")}</span>`
                          : keyFiles.map((pathValue) => {
                              const node = nodes.find((item) => item.data.path === pathValue || item.id === pathValue);
                              if (!node) return null;
                              return html`<button className="chip" title=${pathValue} onClick=${() => selectNode(node.id, true)}>${shortPath(pathValue)}</button>`;
                            })}
                      </div>
                      <h3 style=${{ marginTop: "8px" }}>${t("riskFiles")}</h3>
                      <div className="chip-row">
                        ${riskFiles.length === 0
                          ? html`<span className="chip empty">${t("none")}</span>`
                          : riskFiles.map((pathValue) => {
                              const node = nodes.find((item) => item.data.path === pathValue || item.id === pathValue);
                              if (!node) return null;
                              const risk = node.data.riskLevel || "low";
                              return html`<button className=${"chip " + (risk === "high" ? "risk-high" : risk === "medium" ? "risk-medium" : "")} title=${pathValue} onClick=${() => selectNode(node.id, true)}>${shortPath(pathValue)}</button>`;
                            })}
                      </div>
                      <h3 style=${{ marginTop: "8px" }}>${t("trail")}</h3>
                      <div className="chip-row">
                        ${trail.length === 0
                          ? html`<span className="chip empty">${t("noNode")}</span>`
                          : trail.map((id) => {
                              const node = nodeById.get(id);
                              if (!node) return null;
                              return html`<button className="chip" title=${node.data.path} onClick=${() => selectNode(node.id, true)}>${shortPath(node.data.path)}</button>`;
                            })}
                      </div>
                    `}
              </div>
            </div>
          </section>
        </section>

        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          onPointerDown=${(event) => startPaneResize(1, event)}
        ></div>

        <aside className="pane pane-right" style=${{ width: panePercents[2] + "%" }}>
          <section className="chat-shell">
            <div className="chat-head">
              <div className="chat-head-main">
                <h2 className="chat-title">
                  <span className="chat-buddy" aria-hidden="true">🙂</span>
                  ${t("chatbot")}
                </h2>
                <div className="chat-cost" title=${t("chatCostTitle")}>${sessionCostText}</div>
              </div>
              <div>
                <button className="secondary" onClick=${clearChat}>${t("clear")}</button>
              </div>
            </div>
            <div className="chat-log">
              ${chatMessages.map(
                (message) => html`
                  <div className=${"chat-msg " + (message.role === "assistant" ? "assistant" : "")}>
                    <div className="chat-msg-meta">
                      <span>${message.role}</span>
                      <span>${message.meta || ""}</span>
                    </div>
                    ${message.loading ? html`<div className="spinner">${t("responseInProgress")}</div>` : null}
                    <div
                      className="chat-msg-body markdown-body"
                      dangerouslySetInnerHTML=${{ __html: renderMarkdownToHtml(message.text || "") }}
                    ></div>
                  </div>
                `
              )}
            </div>
            <div className="chat-input">
              <textarea
                value=${chatInput}
                placeholder=${t("askPlaceholder")}
                onChange=${(e) => setChatInput(e.target.value)}
                onKeyDown=${(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
              ></textarea>
              <div className="chat-actions">
                <span className="overlay-muted">${t("ctrlEnter")}</span>
                <button onClick=${sendChat} disabled=${!sessionId || chatSending || !chatInput.trim()}>
                  ${chatSending ? t("sending") : t("send")}
                </button>
              </div>
            </div>
          </section>
        </aside>
      </section>

      ${hoverTip
        ? html`
            <div className="hover-tooltip" style=${{ left: hoverTip.x + "px", top: hoverTip.y + "px" }}>
              <div className="hover-tooltip-title">${hoverTip.title}</div>
              ${Array.isArray(hoverTip.lines)
                ? hoverTip.lines.map((line) => html`<div className="hover-tooltip-line">${line}</div>`)
                : null}
            </div>
          `
        : null}
    </main>
  `;
}

const rootElement = document.getElementById("appRoot");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(html`<${App} />`);
}

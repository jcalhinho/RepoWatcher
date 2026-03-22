import path from "node:path";
import { LocalRepository } from "@repo-watcher/core";

type GraphNode = {
  id: string;
  type: "file";
  position: { x: number; y: number };
  data: {
    label: string;
    path: string;
    directory: string;
    extension: string;
    role: string;
    importance: number;
    riskLevel: "low" | "medium" | "high";
  };
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  data: {
    kind: "import" | "flow" | "config" | "api";
  };
};

type RepoGraphSummary = {
  rootPath: string;
  nodeCount: number;
  edgeCount: number;
  importEdgeCount: number;
  flowEdgeCount: number;
  configEdgeCount: number;
  apiEdgeCount: number;
  directories: number;
  keyFiles: string[];
  riskFiles: string[];
};

export type RepoGraph = {
  summary: RepoGraphSummary;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const PYTHON_EXTENSION = ".py";
const JVM_EXTENSIONS = [".java", ".kt", ".kts", ".scala", ".groovy"];
const GO_EXTENSION = ".go";
const RUST_EXTENSION = ".rs";
const DOTNET_EXTENSIONS = [".cs", ".fs", ".vb"];
const C_FAMILY_EXTENSIONS = [
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".m",
  ".mm"
];
const SCRIPT_EXTENSIONS = [".php", ".rb", ".lua", ".pl", ".pm", ".sh", ".bash", ".zsh"];
const MOBILE_EXTENSIONS = [".swift", ".dart"];
const FUNC_EXTENSIONS = [".ex", ".exs", ".erl", ".hrl", ".hs", ".ml", ".mli", ".clj", ".cljs"];
const DATA_LANG_EXTENSIONS = [".r", ".jl"];
const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".env",
  ".xml"
]);
const CONFIG_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "composer.json",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "application.yml",
  "application.yaml",
  "application.properties",
  "appsettings.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "dockerfile",
  "gemfile",
  "pipfile",
  "pyproject.toml",
  "requirements.txt",
  ".env",
  ".env.example",
  ".env.local",
  ".env.production",
  ".env.development",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.cjs",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "rollup.config.js",
  "next.config.js",
  "nuxt.config.ts",
  "svelte.config.js",
  "angular.json",
  "firebase.json",
  "vercel.json",
  "netlify.toml"
]);
const CONFIG_PATH_HINT =
  /(config|settings|env|application|appsettings|docker|compose|k8s|helm|vite|webpack|rollup|babel|eslint|prettier|tailwind|postcss|tsconfig|gradle|pom|cargo|requirements|pyproject|pipfile|gemfile|firebase|vercel|netlify|nginx|traefik|jest|vitest)/i;
const CONFIG_KEYS_IGNORE = new Set([
  "TRUE",
  "FALSE",
  "NULL",
  "DEFAULT",
  "VERSION",
  "NAME",
  "TYPE",
  "VALUE"
]);
const SUPPORTED_EXTENSIONS = new Set([
  ...JS_EXTENSIONS,
  PYTHON_EXTENSION,
  ...JVM_EXTENSIONS,
  GO_EXTENSION,
  RUST_EXTENSION,
  ...DOTNET_EXTENSIONS,
  ...C_FAMILY_EXTENSIONS,
  ...SCRIPT_EXTENSIONS,
  ...MOBILE_EXTENSIONS,
  ...FUNC_EXTENSIONS,
  ...DATA_LANG_EXTENSIONS
]);

function extensionOf(filePath: string): string {
  return path.posix.extname(filePath).toLowerCase();
}

function isSourceFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extensionOf(filePath));
}

function isConfigFilePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const fileName = path.posix.basename(normalized);
  const ext = extensionOf(normalized);

  if (normalized.includes("/.angular/cache/")) {
    return false;
  }
  if (/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(normalized)) {
    return false;
  }
  if (fileName.endsWith(".min.json")) {
    return false;
  }
  if (CONFIG_FILE_NAMES.has(fileName)) {
    return true;
  }
  if (SUPPORTED_EXTENSIONS.has(ext) && /(config|settings|env)/i.test(fileName)) {
    return true;
  }
  if (ext === ".env" || fileName.startsWith(".env")) {
    return true;
  }
  if (CONFIG_EXTENSIONS.has(ext) && CONFIG_PATH_HINT.test(normalized)) {
    return true;
  }
  return false;
}

function isGraphFile(filePath: string): boolean {
  return isSourceFile(filePath) || isConfigFilePath(filePath);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function normalizeConfigKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function extractConfigKeys(content: string): Set<string> {
  const rawKeys: string[] = [];
  const patterns = [
    /^\s*["']?([a-zA-Z_][a-zA-Z0-9_.-]{2,})["']?\s*[:=]/gm,
    /^\s*([A-Z][A-Z0-9_]{2,})\s*=/gm,
    /\b([A-Z][A-Z0-9_]{3,})\b/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      if (match[1]) {
        rawKeys.push(match[1]);
      }
      match = pattern.exec(content);
    }
  }

  const normalized = new Set<string>();
  for (const key of rawKeys) {
    const token = normalizeConfigKey(key);
    if (!token || token.length < 3 || CONFIG_KEYS_IGNORE.has(token)) {
      continue;
    }
    normalized.add(token);
    if (normalized.size >= 220) {
      break;
    }
  }
  return normalized;
}

function configZone(filePath: string): "backend" | "frontend" | "shared" {
  const normalized = filePath.toLowerCase();
  const segment = normalized.split("/")[0] ?? "";
  if (/(backend|server|api|services?)/.test(segment)) {
    return "backend";
  }
  if (/(frontend|web|client|ui|mobile|app)/.test(segment)) {
    return "frontend";
  }
  return "shared";
}

function classifyRole(filePath: string): string {
  const normalized = filePath.toLowerCase();
  const fileName = path.posix.basename(normalized);

  if (isConfigFilePath(filePath)) {
    return "config";
  }

  if (/^(main|index|app|server)\.(ts|tsx|js|jsx|py)$/.test(fileName)) {
    return "entry";
  }
  if (/(route|router|controller|endpoint|handler)/.test(normalized)) {
    return "routing";
  }
  if (/(page|view|screen|component|layout)/.test(normalized)) {
    return "ui";
  }
  if (/(service|usecase|manager|provider|client)/.test(normalized)) {
    return "service";
  }
  if (/(repo|repository|dao|model|entity|schema|migration|database|db)/.test(normalized)) {
    return "data";
  }
  if (/(config|settings|env)/.test(normalized)) {
    return "config";
  }
  if (/(test|spec|__tests__)/.test(normalized)) {
    return "test";
  }
  return "module";
}

function fileRiskLevel(filePath: string): "low" | "medium" | "high" {
  const normalized = filePath.toLowerCase();

  if (
    /(auth|security|token|secret|password|permission|acl|payment|billing|crypto|encrypt|decrypt|db|database|migration|sql|shell|exec|child_process)/.test(
      normalized
    )
  ) {
    return "high";
  }

  if (/(config|env|service|client|api|router|controller|upload|storage|gateway)/.test(normalized)) {
    return "medium";
  }

  return "low";
}

function isEntryCandidate(filePath: string): boolean {
  const role = classifyRole(filePath);
  return role === "entry" || role === "routing" || role === "ui";
}

function computeImportance(
  filePaths: string[],
  importEdges: GraphEdge[],
  flowEdges: GraphEdge[]
): Map<string, number> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const flowUsage = new Map<string, number>();

  for (const filePath of filePaths) {
    incoming.set(filePath, 0);
    outgoing.set(filePath, 0);
    flowUsage.set(filePath, 0);
  }

  for (const edge of importEdges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }

  for (const edge of flowEdges) {
    flowUsage.set(edge.source, (flowUsage.get(edge.source) ?? 0) + 1);
    flowUsage.set(edge.target, (flowUsage.get(edge.target) ?? 0) + 1);
  }

  const importance = new Map<string, number>();
  for (const filePath of filePaths) {
    const base =
      (incoming.get(filePath) ?? 0) * 3 +
      (outgoing.get(filePath) ?? 0) * 2 +
      (flowUsage.get(filePath) ?? 0);
    const role = classifyRole(filePath);
    const roleBoost = role === "entry" ? 8 : role === "routing" ? 6 : role === "service" ? 4 : 0;
    importance.set(filePath, base + roleBoost);
  }

  return importance;
}

function buildFlowEdges(filePaths: string[], importEdges: GraphEdge[]): GraphEdge[] {
  const adjacency = new Map<string, string[]>();
  const edgeByPair = new Map<string, GraphEdge>();

  for (const filePath of filePaths) {
    adjacency.set(filePath, []);
  }

  for (const edge of importEdges) {
    const list = adjacency.get(edge.source);
    if (list) {
      list.push(edge.target);
    }
    edgeByPair.set(`${edge.source}->${edge.target}`, edge);
  }

  const sortedByDegree = filePaths
    .map((filePath) => ({
      filePath,
      degree:
        importEdges.filter((edge) => edge.source === filePath || edge.target === filePath).length
    }))
    .sort((a, b) => b.degree - a.degree || a.filePath.localeCompare(b.filePath))
    .map((item) => item.filePath);

  const entryCandidates = filePaths.filter(isEntryCandidate);
  const entryRoots = entryCandidates.length > 0 ? entryCandidates : sortedByDegree.slice(0, 3);

  const flowEdges: GraphEdge[] = [];
  const flowEdgeIds = new Set<string>();
  const maxDepth = 5;
  const maxFlowEdges = Math.max(40, Math.min(filePaths.length * 3, 600));

  for (const root of entryRoots) {
    const queue: Array<{ filePath: string; depth: number }> = [{ filePath: root, depth: 0 }];
    const visitedAtDepth = new Set<string>([`${root}@0`]);

    while (queue.length > 0 && flowEdges.length < maxFlowEdges) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      if (current.depth >= maxDepth) {
        continue;
      }

      const neighbors = adjacency.get(current.filePath) ?? [];
      for (const neighbor of neighbors) {
        const flowId = `flow:${current.filePath}->${neighbor}`;
        if (!flowEdgeIds.has(flowId)) {
          flowEdgeIds.add(flowId);
          flowEdges.push({
            id: flowId,
            source: current.filePath,
            target: neighbor,
            data: { kind: "flow" }
          });
        }

        const visitKey = `${neighbor}@${current.depth + 1}`;
        if (!visitedAtDepth.has(visitKey)) {
          visitedAtDepth.add(visitKey);
          queue.push({ filePath: neighbor, depth: current.depth + 1 });
        }
      }
    }
  }

  return flowEdges;
}

async function buildConfigInteractionEdges(
  repository: LocalRepository,
  filePaths: string[]
): Promise<GraphEdge[]> {
  const configFiles = filePaths.filter(isConfigFilePath);
  if (configFiles.length < 2) {
    return [];
  }

  const keyMap = new Map<string, Set<string>>();
  for (const filePath of configFiles) {
    const content = await repository.readTextFile(filePath, 90_000).catch(() => "");
    if (!content) {
      continue;
    }
    keyMap.set(filePath, extractConfigKeys(content));
  }

  const pairs: Array<{ source: string; target: string; score: number }> = [];
  for (let i = 0; i < configFiles.length; i += 1) {
    for (let j = i + 1; j < configFiles.length; j += 1) {
      const a = configFiles[i];
      const b = configFiles[j];
      const aKeys = keyMap.get(a);
      const bKeys = keyMap.get(b);
      if (!aKeys || !bKeys || aKeys.size === 0 || bKeys.size === 0) {
        continue;
      }

      let overlap = 0;
      const smaller = aKeys.size <= bKeys.size ? aKeys : bKeys;
      const larger = smaller === aKeys ? bKeys : aKeys;
      for (const key of smaller) {
        if (larger.has(key)) {
          overlap += 1;
        }
      }

      const crossFrontendBackend =
        (configZone(a) === "backend" && configZone(b) === "frontend") ||
        (configZone(a) === "frontend" && configZone(b) === "backend");
      const minOverlap = crossFrontendBackend ? 1 : 2;
      if (overlap < minOverlap) {
        continue;
      }

      const score = overlap + (crossFrontendBackend ? 3 : 0);
      const source = a.localeCompare(b) <= 0 ? a : b;
      const target = source === a ? b : a;
      pairs.push({ source, target, score });
    }
  }

  pairs.sort((left, right) => right.score - left.score || left.source.localeCompare(right.source));
  const limit = Math.max(20, Math.min(configFiles.length * 4, 140));
  return pairs.slice(0, limit).map((pair) => ({
    id: `config:${pair.source}->${pair.target}`,
    source: pair.source,
    target: pair.target,
    data: { kind: "config" }
  }));
}

function joinRouteSegments(basePath: string, leafPath: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const leaf = leafPath.startsWith("/") ? leafPath : `/${leafPath}`;
  return `${base}${leaf}`;
}

function normalizeApiPathCandidate(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  let normalized = value.replace(/^https?:\/\/[^/]+/i, "");
  const qIndex = normalized.indexOf("?");
  if (qIndex >= 0) {
    normalized = normalized.slice(0, qIndex);
  }
  const hashIndex = normalized.indexOf("#");
  if (hashIndex >= 0) {
    normalized = normalized.slice(0, hashIndex);
  }

  if (!normalized.startsWith("/")) {
    return null;
  }
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.length < 2 || normalized.length > 220) {
    return null;
  }
  if (/^\/(?:assets?|static|images?|img|css|js|fonts?|favicon)/i.test(normalized)) {
    return null;
  }
  if (/\/[^/]+\.[a-z0-9]{1,8}$/i.test(normalized) && !/^\/(?:api|v\d+)\//i.test(normalized)) {
    return null;
  }

  return normalized;
}

function canonicalizeApiPath(apiPath: string): string {
  const normalized = apiPath.toLowerCase();
  const parts = normalized.split("/").filter((part) => part.length > 0);
  const canonical = parts.map((part) => {
    if (
      part.startsWith(":") ||
      part.includes("{") ||
      part.includes("}") ||
      part.includes("${") ||
      part.includes("[") ||
      part.includes("]")
    ) {
      return ":param";
    }
    if (/^\d+$/.test(part)) {
      return ":param";
    }
    if (/^[0-9a-f]{8,}$/i.test(part) || /^[0-9a-f-]{8,}$/i.test(part)) {
      return ":param";
    }
    return part;
  });
  return `/${canonical.join("/")}`;
}

function extractFrontendApiCalls(content: string): Set<string> {
  const rawPaths: string[] = [];
  const aliasMap = new Map<string, Set<string>>();
  const patterns = [
    /(?:fetch|axios\.(?:get|post|put|delete|patch)|http(?:Client)?\.(?:get|post|put|delete|patch)(?:<[^>]+>)?)\(\s*["'`]([^"'`]+)["'`]/g,
    /["'`]((?:https?:\/\/[^"'`]+)?\/(?:api|v\d+)\/[^"'`?#]+)["'`]/gi
  ];

  const aliasPattern =
    /^\s*(?:const|let|var|private|public|protected|readonly)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::[^=\n;]+)?=\s*[^\n;]*?["'`](\/[^"'`?#]+)["'`]/gm;
  let aliasMatch = aliasPattern.exec(content);
  while (aliasMatch) {
    const alias = aliasMatch[1];
    const maybePath = aliasMatch[2];
    const normalizedPath = normalizeApiPathCandidate(maybePath);
    if (alias && normalizedPath) {
      const bucket = aliasMap.get(alias) ?? new Set<string>();
      bucket.add(normalizedPath);
      aliasMap.set(alias, bucket);
    }
    aliasMatch = aliasPattern.exec(content);
  }

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      if (match[1]) {
        rawPaths.push(match[1]);
      }
      match = pattern.exec(content);
    }
  }

  const normalized = new Set<string>();
  for (const rawPath of rawPaths) {
    const pathValue = normalizeApiPathCandidate(rawPath);
    if (pathValue) {
      normalized.add(canonicalizeApiPath(pathValue));
    } else {
      const refs = new Set<string>();
      const templateRefPattern = /\$\{(?:this\.)?([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
      let templateRef = templateRefPattern.exec(rawPath);
      while (templateRef) {
        if (templateRef[1]) {
          refs.add(templateRef[1]);
        }
        templateRef = templateRefPattern.exec(rawPath);
      }
      const thisRefPattern = /\bthis\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
      let thisRef = thisRefPattern.exec(rawPath);
      while (thisRef) {
        if (thisRef[1]) {
          refs.add(thisRef[1]);
        }
        thisRef = thisRefPattern.exec(rawPath);
      }

      for (const ref of refs) {
        const mapped = aliasMap.get(ref);
        if (!mapped) {
          continue;
        }
        for (const mappedPath of mapped) {
          normalized.add(canonicalizeApiPath(mappedPath));
        }
      }
    }

    if (normalized.size >= 80) {
      break;
    }
  }
  return normalized;
}

function extractBackendRoutePaths(content: string): Set<string> {
  const rawRoutes = new Set<string>();
  const springMappings: Array<{ annotation: string; route: string }> = [];
  const springPattern =
    /@((?:Get|Post|Put|Delete|Patch|Request)Mapping)\(\s*(?:path|value)?\s*=?\s*["'`]([^"'`]+)["'`]/g;
  let springMatch = springPattern.exec(content);
  while (springMatch) {
    const annotation = springMatch[1] ?? "";
    const route = springMatch[2] ?? "";
    if (route) {
      springMappings.push({ annotation, route });
      rawRoutes.add(route);
    }
    springMatch = springPattern.exec(content);
  }

  const springBase = springMappings
    .filter((item) => item.annotation === "RequestMapping")
    .map((item) => item.route);
  const springLeaf = springMappings
    .filter((item) => item.annotation !== "RequestMapping")
    .map((item) => item.route);
  for (const base of springBase) {
    for (const leaf of springLeaf) {
      rawRoutes.add(joinRouteSegments(base, leaf));
    }
  }

  const aspMappings: Array<{ annotation: string; route: string }> = [];
  const aspPattern =
    /\[((?:Route|HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch))\(\s*["'`]([^"'`]+)["'`]\s*\)\]/g;
  let aspMatch = aspPattern.exec(content);
  while (aspMatch) {
    const annotation = aspMatch[1] ?? "";
    const route = aspMatch[2] ?? "";
    if (route) {
      aspMappings.push({ annotation, route });
      rawRoutes.add(route);
    }
    aspMatch = aspPattern.exec(content);
  }

  const aspBase = aspMappings.filter((item) => item.annotation === "Route").map((item) => item.route);
  const aspLeaf = aspMappings
    .filter((item) => item.annotation.startsWith("Http"))
    .map((item) => item.route);
  for (const base of aspBase) {
    for (const leaf of aspLeaf) {
      rawRoutes.add(joinRouteSegments(base, leaf));
    }
  }

  const directPatterns = [
    /\b(?:app|router|server|fastify)\.(?:get|post|put|delete|patch|all|use)\(\s*["'`]([^"'`]+)["'`]/g,
    /@(?:\w+\.)?(?:get|post|put|delete|patch|route)\(\s*["'`]([^"'`]+)["'`]/g
  ];
  for (const pattern of directPatterns) {
    let match = pattern.exec(content);
    while (match) {
      if (match[1]) {
        rawRoutes.add(match[1]);
      }
      match = pattern.exec(content);
    }
  }

  const normalized = new Set<string>();
  for (const rawRoute of rawRoutes) {
    const route = normalizeApiPathCandidate(rawRoute);
    if (!route) {
      continue;
    }
    normalized.add(canonicalizeApiPath(route));
    if (normalized.size >= 120) {
      break;
    }
  }
  return normalized;
}

function backendCandidatesForCall(
  calledPath: string,
  routeIndex: Map<string, Set<string>>
): Set<string> {
  const direct = routeIndex.get(calledPath);
  if (direct && direct.size > 0) {
    return direct;
  }

  const result = new Set<string>();
  for (const [routePath, files] of routeIndex.entries()) {
    if (
      (calledPath.startsWith(`${routePath}/`) && routePath.length > 5) ||
      (routePath.startsWith(`${calledPath}/`) && calledPath.length > 5) ||
      (routePath.endsWith(calledPath) && calledPath.length > 4)
    ) {
      for (const filePath of files) {
        result.add(filePath);
      }
    }
  }
  return result;
}

async function buildApiInteractionEdges(
  repository: LocalRepository,
  filePaths: string[]
): Promise<GraphEdge[]> {
  const frontendFiles = filePaths.filter(
    (filePath) => isSourceFile(filePath) && configZone(filePath) === "frontend"
  );
  const backendFiles = filePaths.filter(
    (filePath) => isSourceFile(filePath) && configZone(filePath) === "backend"
  );

  if (frontendFiles.length === 0 || backendFiles.length === 0) {
    return [];
  }

  const routeIndex = new Map<string, Set<string>>();
  for (const backendFile of backendFiles) {
    const content = await repository.readTextFile(backendFile, 120_000).catch(() => "");
    if (!content) {
      continue;
    }
    const routes = extractBackendRoutePaths(content);
    for (const route of routes) {
      const bucket = routeIndex.get(route) ?? new Set<string>();
      bucket.add(backendFile);
      routeIndex.set(route, bucket);
    }
  }

  if (routeIndex.size === 0) {
    return [];
  }

  const edgeIds = new Set<string>();
  const apiEdges: GraphEdge[] = [];
  const limit = Math.max(30, Math.min(filePaths.length * 4, 240));
  for (const frontendFile of frontendFiles) {
    if (apiEdges.length >= limit) {
      break;
    }
    const content = await repository.readTextFile(frontendFile, 120_000).catch(() => "");
    if (!content) {
      continue;
    }

    const calledPaths = extractFrontendApiCalls(content);
    for (const calledPath of calledPaths) {
      const backendTargets = backendCandidatesForCall(calledPath, routeIndex);
      for (const backendTarget of backendTargets) {
        if (frontendFile === backendTarget) {
          continue;
        }
        const edgeId = `api:${frontendFile}->${backendTarget}`;
        if (edgeIds.has(edgeId)) {
          continue;
        }
        edgeIds.add(edgeId);
        apiEdges.push({
          id: edgeId,
          source: frontendFile,
          target: backendTarget,
          data: { kind: "api" }
        });
        if (apiEdges.length >= limit) {
          break;
        }
      }
      if (apiEdges.length >= limit) {
        break;
      }
    }
  }

  return apiEdges;
}

function parseJsLikeImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^"']*from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^"']*from\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      if (match[1]) {
        imports.push(match[1]);
      }
      match = pattern.exec(content);
    }
  }

  return unique(imports);
}

function parsePythonImports(content: string): string[] {
  const imports: string[] = [];

  const fromPattern = /^\s*from\s+([a-zA-Z0-9_\.]+)\s+import\s+/gm;
  let fromMatch = fromPattern.exec(content);
  while (fromMatch) {
    imports.push(fromMatch[1]);
    fromMatch = fromPattern.exec(content);
  }

  const importPattern = /^\s*import\s+([a-zA-Z0-9_.,\s]+)/gm;
  let importMatch = importPattern.exec(content);
  while (importMatch) {
    const segment = importMatch[1];
    for (const item of segment.split(",")) {
      const base = item.trim().split(/\s+as\s+/i)[0]?.trim();
      if (base) {
        imports.push(base);
      }
    }
    importMatch = importPattern.exec(content);
  }

  return unique(imports);
}

function parseJavaImports(content: string): string[] {
  const imports: string[] = [];
  const importPattern = /^\s*import\s+(?:static\s+)?([a-zA-Z_][a-zA-Z0-9_\.]*)(\.\*)?\s*;/gm;

  let importMatch = importPattern.exec(content);
  while (importMatch) {
    const target = importMatch[1];
    const wildcard = importMatch[2] === ".*";
    if (target) {
      imports.push(wildcard ? `${target}.*` : target);
    }
    importMatch = importPattern.exec(content);
  }

  return unique(imports);
}

function resolveJsImport(source: string, specifier: string, files: Set<string>): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const sourceDir = path.posix.dirname(source);
  const base = path.posix.normalize(path.posix.join(sourceDir, specifier));
  const candidates = new Set<string>();

  candidates.add(base);
  for (const ext of JS_EXTENSIONS) {
    candidates.add(`${base}${ext}`);
    candidates.add(path.posix.join(base, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (files.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function moduleCandidatesForFile(filePath: string): string[] {
  const normalized = filePath.endsWith(PYTHON_EXTENSION)
    ? filePath.slice(0, -PYTHON_EXTENSION.length)
    : filePath;

  const parts = normalized.split("/");
  const withoutInit =
    parts[parts.length - 1] === "__init__" ? parts.slice(0, parts.length - 1) : parts;

  const modules: string[] = [];
  for (let index = 0; index < withoutInit.length; index += 1) {
    modules.push(withoutInit.slice(index).join("."));
  }
  return unique(modules);
}

function buildPythonModuleIndex(files: string[]): Map<string, string[]> {
  const mapping = new Map<string, string[]>();

  for (const filePath of files.filter((item) => item.endsWith(PYTHON_EXTENSION))) {
    for (const moduleName of moduleCandidatesForFile(filePath)) {
      const existing = mapping.get(moduleName) ?? [];
      existing.push(filePath);
      mapping.set(moduleName, existing);
    }
  }

  return mapping;
}

function javaClassNameForPath(filePath: string): string | null {
  const ext = extensionOf(filePath);
  if (!JVM_EXTENSIONS.includes(ext)) {
    return null;
  }

  const withoutExt = filePath.slice(0, -ext.length);
  const javaRootMarker = "/java/";
  const markerIndex = withoutExt.indexOf(javaRootMarker);

  const classPath =
    markerIndex >= 0 ? withoutExt.slice(markerIndex + javaRootMarker.length) : withoutExt;
  if (!classPath || classPath.startsWith(".")) {
    return null;
  }

  return classPath.split("/").join(".");
}

function buildJavaClassIndex(files: string[]): Map<string, string[]> {
  const mapping = new Map<string, string[]>();

  for (const filePath of files.filter((item) => JVM_EXTENSIONS.includes(extensionOf(item)))) {
    const className = javaClassNameForPath(filePath);
    if (!className) {
      continue;
    }
    const existing = mapping.get(className) ?? [];
    existing.push(filePath);
    mapping.set(className, existing);
  }

  return mapping;
}

function resolveJavaImport(
  specifier: string,
  index: Map<string, string[]>,
  files: Set<string>
): string | null {
  if (
    specifier.startsWith("java.") ||
    specifier.startsWith("javax.") ||
    specifier.startsWith("jakarta.") ||
    specifier.startsWith("org.springframework.")
  ) {
    return null;
  }

  if (specifier.endsWith(".*")) {
    const packagePrefix = specifier.slice(0, -2);
    const candidates: string[] = [];
    for (const [className, paths] of index.entries()) {
      if (!className.startsWith(`${packagePrefix}.`)) {
        continue;
      }
      for (const classPath of paths) {
        if (files.has(classPath)) {
          candidates.push(classPath);
        }
      }
    }
    const uniqueCandidates = unique(candidates);
    return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
  }

  let candidate = specifier;
  while (candidate.includes(".")) {
    const targets = index.get(candidate) ?? [];
    const existingTargets = targets.filter((item) => files.has(item));
    if (existingTargets.length === 1) {
      return existingTargets[0];
    }
    const nextCandidate = candidate.split(".").slice(0, -1).join(".");
    if (nextCandidate === candidate) {
      break;
    }
    candidate = nextCandidate;
  }

  return null;
}

function chooseUniqueModuleTarget(
  moduleName: string,
  index: Map<string, string[]>,
  files: Set<string>
): string | null {
  const targets = index.get(moduleName) ?? [];
  const existingTargets = targets.filter((item) => files.has(item));
  if (existingTargets.length === 1) {
    return existingTargets[0];
  }
  return null;
}

function pythonSourcePackages(filePath: string): string[] {
  const normalized = filePath.endsWith(PYTHON_EXTENSION)
    ? filePath.slice(0, -PYTHON_EXTENSION.length)
    : filePath;
  const parts = normalized.split("/");
  const packageParts = parts.slice(0, Math.max(0, parts.length - 1));

  const result: string[] = [];
  for (let index = 0; index < packageParts.length; index += 1) {
    result.push(packageParts.slice(index).join("."));
  }
  return result;
}

function resolvePythonRelativeImport(source: string, specifier: string): string | null {
  const match = /^(\.+)(.*)$/.exec(specifier);
  if (!match) {
    return null;
  }

  const dots = match[1]?.length ?? 0;
  const suffix = (match[2] ?? "").replace(/^\./, "");
  const sourceParts = moduleCandidatesForFile(source)[0]?.split(".") ?? [];
  if (sourceParts.length === 0) {
    return null;
  }

  const packageParts = sourceParts.slice(0, Math.max(0, sourceParts.length - 1));
  const goUp = Math.max(0, dots - 1);
  const kept = packageParts.slice(0, Math.max(0, packageParts.length - goUp));
  const base = kept.join(".");
  if (!suffix) {
    return base || null;
  }
  return base ? `${base}.${suffix}` : suffix;
}

function resolvePythonImport(
  source: string,
  specifier: string,
  index: Map<string, string[]>,
  files: Set<string>
): string | null {
  if (specifier.startsWith(".")) {
    const absoluteModule = resolvePythonRelativeImport(source, specifier);
    if (absoluteModule) {
      return chooseUniqueModuleTarget(absoluteModule, index, files);
    }
    return null;
  }

  const exact = chooseUniqueModuleTarget(specifier, index, files);
  if (exact) {
    return exact;
  }

  for (const candidatePrefix of pythonSourcePackages(source)) {
    const candidate = `${candidatePrefix}.${specifier}`;
    const resolved = chooseUniqueModuleTarget(candidate, index, files);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function layoutNodes(
  filePaths: string[],
  edges: GraphEdge[],
  importance: Map<string, number>
): GraphNode[] {
  const byDirectory = new Map<string, string[]>();
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const allFiles = new Set(filePaths);

  for (const filePath of filePaths) {
    const directory = path.posix.dirname(filePath);
    const normalizedDirectory = directory === "." ? "" : directory;
    const bucket = byDirectory.get(normalizedDirectory) ?? [];
    bucket.push(filePath);
    byDirectory.set(normalizedDirectory, bucket);
    incoming.set(filePath, new Set());
    outgoing.set(filePath, new Set());
  }

  for (const edge of edges) {
    if (!allFiles.has(edge.source) || !allFiles.has(edge.target)) {
      continue;
    }
    outgoing.get(edge.source)?.add(edge.target);
    incoming.get(edge.target)?.add(edge.source);
  }

  const degree = (filePath: string): number =>
    (incoming.get(filePath)?.size ?? 0) + (outgoing.get(filePath)?.size ?? 0);

  let directories = [...byDirectory.keys()];
  directories = directories.sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    const depthDiff = a.split("/").length - b.split("/").length;
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  });

  const yScores = new Map<string, number>();
  for (const directory of directories) {
    const files = byDirectory.get(directory) ?? [];
    files.sort(
      (a, b) =>
        (importance.get(b) ?? 0) - (importance.get(a) ?? 0) || degree(b) - degree(a) || a.localeCompare(b)
    );
    files.forEach((filePath, index) => {
      yScores.set(filePath, index * 102);
    });
  }

  for (let pass = 0; pass < 4; pass += 1) {
    const nextScores = new Map(yScores);
    for (const filePath of filePaths) {
      const neighbors = [
        ...(incoming.get(filePath) ?? new Set<string>()),
        ...(outgoing.get(filePath) ?? new Set<string>())
      ];
      if (neighbors.length === 0) {
        continue;
      }

      const averageNeighborY =
        neighbors.reduce((sum, neighbor) => sum + (yScores.get(neighbor) ?? 0), 0) /
        neighbors.length;
      const currentY = yScores.get(filePath) ?? 0;
      nextScores.set(filePath, currentY * 0.4 + averageNeighborY * 0.6);
    }
    for (const [filePath, score] of nextScores.entries()) {
      yScores.set(filePath, score);
    }
  }

  const nodes: GraphNode[] = [];
  for (const [directoryIndex, directory] of directories.entries()) {
    const files = (byDirectory.get(directory) ?? []).sort((a, b) => {
      const yDiff = (yScores.get(a) ?? 0) - (yScores.get(b) ?? 0);
      if (Math.abs(yDiff) > 1) return yDiff;
      return (importance.get(b) ?? 0) - (importance.get(a) ?? 0) || degree(b) - degree(a) || a.localeCompare(b);
    });

    files.forEach((filePath, index) => {
      nodes.push({
        id: filePath,
        type: "file",
        position: {
          x: 340 * directoryIndex,
          y: 94 * index
        },
        data: {
          label: path.posix.basename(filePath),
          path: filePath,
          directory,
          extension: extensionOf(filePath),
          role: classifyRole(filePath),
          importance: importance.get(filePath) ?? 0,
          riskLevel: fileRiskLevel(filePath)
        }
      });
    });
  }

  return nodes.sort((a, b) => a.data.path.localeCompare(b.data.path));
}

export async function buildRepoGraph(
  repository: LocalRepository,
  rootPath = ".",
  maxNodes = 180
): Promise<RepoGraph> {
  const scanBudget = Math.min(12_000, Math.max(maxNodes * 20, 600));
  const listedFiles = await repository.listFiles(rootPath, scanBudget);
  const sourceFiles = listedFiles.filter(isGraphFile).slice(0, maxNodes);
  const filesSet = new Set(sourceFiles);
  const pythonModuleIndex = buildPythonModuleIndex(sourceFiles);
  const javaClassIndex = buildJavaClassIndex(sourceFiles);
  const edgeSet = new Set<string>();
  const importEdges: GraphEdge[] = [];

  for (const sourcePath of sourceFiles) {
    const content = await repository.readTextFile(sourcePath, 120_000).catch(() => "");
    if (!content) {
      continue;
    }

    const ext = extensionOf(sourcePath);
    let imports: string[] = [];
    if (JS_EXTENSIONS.includes(ext)) {
      imports = parseJsLikeImports(content);
      for (const specifier of imports) {
        const target = resolveJsImport(sourcePath, specifier, filesSet);
        if (!target || target === sourcePath) {
          continue;
        }

        const edgeId = `${sourcePath}->${target}`;
        if (edgeSet.has(edgeId)) {
          continue;
        }
        edgeSet.add(edgeId);
        importEdges.push({
          id: edgeId,
          source: sourcePath,
          target,
          data: { kind: "import" }
        });
      }
      continue;
    }

    if (ext === PYTHON_EXTENSION) {
      imports = parsePythonImports(content);
      for (const specifier of imports) {
        const target = resolvePythonImport(sourcePath, specifier, pythonModuleIndex, filesSet);
        if (!target || target === sourcePath) {
          continue;
        }
        const edgeId = `${sourcePath}->${target}`;
        if (edgeSet.has(edgeId)) {
          continue;
        }
        edgeSet.add(edgeId);
        importEdges.push({
          id: edgeId,
          source: sourcePath,
          target,
          data: { kind: "import" }
        });
      }
      continue;
    }

    if (JVM_EXTENSIONS.includes(ext)) {
      imports = parseJavaImports(content);
      for (const specifier of imports) {
        const target = resolveJavaImport(specifier, javaClassIndex, filesSet);
        if (!target || target === sourcePath) {
          continue;
        }
        const edgeId = `${sourcePath}->${target}`;
        if (edgeSet.has(edgeId)) {
          continue;
        }
        edgeSet.add(edgeId);
        importEdges.push({
          id: edgeId,
          source: sourcePath,
          target,
          data: { kind: "import" }
        });
      }
    }
  }

  const flowEdges = buildFlowEdges(sourceFiles, importEdges);
  const configEdges = await buildConfigInteractionEdges(repository, sourceFiles);
  const apiEdges = await buildApiInteractionEdges(repository, sourceFiles);
  const importance = computeImportance(sourceFiles, importEdges, [...flowEdges, ...configEdges, ...apiEdges]);
  const nodes = layoutNodes(
    sourceFiles,
    [...importEdges, ...flowEdges, ...configEdges, ...apiEdges],
    importance
  );
  const directories = new Set(nodes.map((node) => node.data.directory || ".")).size;
  const keyFiles = [...sourceFiles]
    .sort((a, b) => (importance.get(b) ?? 0) - (importance.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, 10);
  const riskFiles = [...sourceFiles]
    .filter((filePath) => fileRiskLevel(filePath) !== "low")
    .sort((a, b) => {
      const riskWeight = (level: "low" | "medium" | "high") =>
        level === "high" ? 3 : level === "medium" ? 2 : 1;
      const riskDiff = riskWeight(fileRiskLevel(b)) - riskWeight(fileRiskLevel(a));
      if (riskDiff !== 0) {
        return riskDiff;
      }
      return (importance.get(b) ?? 0) - (importance.get(a) ?? 0) || a.localeCompare(b);
    })
    .slice(0, 10);
  const edges = [...importEdges, ...apiEdges, ...flowEdges, ...configEdges];

  return {
    summary: {
      rootPath: toPosix(rootPath),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      importEdgeCount: importEdges.length,
      flowEdgeCount: flowEdges.length,
      configEdgeCount: configEdges.length,
      apiEdgeCount: apiEdges.length,
      directories,
      keyFiles,
      riskFiles
    },
    nodes,
    edges: edges.sort(
      (a, b) =>
        ((a.data.kind === "import"
          ? 0
          : a.data.kind === "api"
            ? 1
            : a.data.kind === "config"
              ? 2
              : 3) -
          (b.data.kind === "import"
            ? 0
            : b.data.kind === "api"
              ? 1
              : b.data.kind === "config"
                ? 2
                : 3)) ||
        a.id.localeCompare(b.id)
    )
  };
}

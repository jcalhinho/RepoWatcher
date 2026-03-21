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
    kind: "import" | "flow";
  };
};

type RepoGraphSummary = {
  rootPath: string;
  nodeCount: number;
  edgeCount: number;
  importEdgeCount: number;
  flowEdgeCount: number;
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
const SUPPORTED_EXTENSIONS = new Set([...JS_EXTENSIONS, PYTHON_EXTENSION]);

function extensionOf(filePath: string): string {
  return path.posix.extname(filePath).toLowerCase();
}

function isSourceFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extensionOf(filePath));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function classifyRole(filePath: string): string {
  const normalized = filePath.toLowerCase();
  const fileName = path.posix.basename(normalized);

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
  const listedFiles = await repository.listFiles(rootPath, Math.max(maxNodes, 40));
  const sourceFiles = listedFiles.filter(isSourceFile).slice(0, maxNodes);
  const filesSet = new Set(sourceFiles);
  const pythonModuleIndex = buildPythonModuleIndex(sourceFiles);
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
    }
  }

  const flowEdges = buildFlowEdges(sourceFiles, importEdges);
  const importance = computeImportance(sourceFiles, importEdges, flowEdges);
  const nodes = layoutNodes(sourceFiles, importEdges, importance);
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
  const edges = [...importEdges, ...flowEdges];

  return {
    summary: {
      rootPath: toPosix(rootPath),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      importEdgeCount: importEdges.length,
      flowEdgeCount: flowEdges.length,
      directories,
      keyFiles,
      riskFiles
    },
    nodes,
    edges: edges.sort(
      (a, b) =>
        (a.data.kind === b.data.kind ? 0 : a.data.kind === "import" ? -1 : 1) ||
        a.id.localeCompare(b.id)
    )
  };
}

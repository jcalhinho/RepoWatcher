import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "../src/path-guard.js";

describe("resolveInsideRoot", () => {
  it("resolves paths inside the repository root", () => {
    const root = path.resolve("/tmp/project");
    const resolved = resolveInsideRoot(root, "src/index.ts");
    expect(resolved).toBe(path.resolve("/tmp/project/src/index.ts"));
  });

  it("throws when path escapes repository root", () => {
    const root = path.resolve("/tmp/project");
    expect(() => resolveInsideRoot(root, "../secrets.txt")).toThrow(
      /Path escapes repository root/
    );
  });
});

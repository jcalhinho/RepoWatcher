import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalRepository } from "../src/local-repository.js";
import { parseRipgrepJsonOutput } from "../src/local-repository.js";

describe("LocalRepository", () => {
  it("parses ripgrep JSON paths containing Windows drive letters and colons", () => {
    const output = [
      JSON.stringify({ type: "match", data: {
        path: { text: "C:\\work\\repo\\src\\main.ts" },
        lines: { text: "const url = 'https://example.test/a:b';\n" },
        line_number: 12
      } })
    ].join("\n");

    expect(parseRipgrepJsonOutput("C:\\work\\repo", output)).toEqual([
      {
        path: "src/main.ts",
        line: 12,
        preview: "const url = 'https://example.test/a:b';"
      }
    ]);
  });

  it("lists, reads, writes, and searches files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-test-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.ts"), "export const value = 42;\n", "utf8");

    const repo = await LocalRepository.open(root);
    const files = await repo.listFiles();
    expect(files).toContain("src/main.ts");

    const content = await repo.readTextFile("src/main.ts");
    expect(content).toContain("value = 42");

    await repo.writeTextFile("src/main.ts", "export const value = 43;\n");
    const updatedContent = await repo.readTextFile("src/main.ts");
    expect(updatedContent).toContain("value = 43");

    const results = await repo.search("value = 43");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toBe("src/main.ts");
  });

  it("ignores noisy virtualenv and cache directories while listing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-test-"));
    await mkdir(path.join(root, "backend", "venv", "bin"), { recursive: true });
    await mkdir(path.join(root, "backend", "__pycache__"), { recursive: true });
    await mkdir(path.join(root, "backend", "app"), { recursive: true });
    await mkdir(path.join(root, "frontend", ".angular", "cache", "18", "vite", "deps"), {
      recursive: true
    });

    await writeFile(path.join(root, "backend", "venv", "bin", "activate"), "source ...", "utf8");
    await writeFile(path.join(root, "backend", "__pycache__", "main.cpython-314.pyc"), "binary", "utf8");
    await writeFile(path.join(root, "backend", "app", "routes.py"), "print('ok')\n", "utf8");
    await writeFile(
      path.join(root, "frontend", ".angular", "cache", "18", "vite", "deps", "chunk-AAA.js"),
      "export default 1;\n",
      "utf8"
    );

    const repo = await LocalRepository.open(root);
    const files = await repo.listFiles(".", 200);

    expect(files).toContain("backend/app/routes.py");
    expect(files.some((file) => file.includes("venv"))).toBe(false);
    expect(files.some((file) => file.includes("__pycache__"))).toBe(false);
    expect(files.some((file) => file.includes(".angular"))).toBe(false);
  });

  it("does not read or write through a symlink that escapes the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "outside secret", "utf8");
    await symlink(outside, path.join(root, "external"), "junction");
    const missingTarget = path.join(outside, "removed-target");
    await mkdir(missingTarget);
    await symlink(missingTarget, path.join(root, "broken"), "junction");
    await rm(missingTarget, { recursive: true });

    const repo = await LocalRepository.open(root);
    await expect(repo.readTextFile("external/secret.txt")).rejects.toThrow(
      /Path escapes repository root/
    );
    await expect(repo.writeTextFile("external/secret.txt", "changed")).rejects.toThrow(
      /Path escapes repository root/
    );
    await expect(repo.writeTextFile("broken/new.txt", "changed")).rejects.toThrow(
      /Path escapes repository root/
    );
    await expect(repo.listFiles()).resolves.not.toContain("external/secret.txt");
    await expect(readFile(path.join(outside, "secret.txt"), "utf8")).resolves.toBe("outside secret");
  });
});

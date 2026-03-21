import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalRepository } from "../src/local-repository.js";

describe("LocalRepository", () => {
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

    await writeFile(path.join(root, "backend", "venv", "bin", "activate"), "source ...", "utf8");
    await writeFile(path.join(root, "backend", "__pycache__", "main.cpython-314.pyc"), "binary", "utf8");
    await writeFile(path.join(root, "backend", "app", "routes.py"), "print('ok')\n", "utf8");

    const repo = await LocalRepository.open(root);
    const files = await repo.listFiles(".", 200);

    expect(files).toContain("backend/app/routes.py");
    expect(files.some((file) => file.includes("venv"))).toBe(false);
    expect(files.some((file) => file.includes("__pycache__"))).toBe(false);
  });
});

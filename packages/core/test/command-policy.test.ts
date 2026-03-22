import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDefaultCommandPolicy,
  ExactCommandPolicy,
  runAllowedCommand
} from "../src/command-policy.js";

describe("ExactCommandPolicy", () => {
  it("matches only exact command tokens", () => {
    const policy = new ExactCommandPolicy([
      ["npm", "test"],
      ["npm", "run", "lint"]
    ]);

    expect(policy.isAllowed(["npm", "test"])).toBe(true);
    expect(policy.isAllowed(["npm", "run", "lint"])).toBe(true);
    expect(policy.isAllowed(["npm", "test", "--", "--watch"])).toBe(false);
    expect(policy.isAllowed(["npm", "run", "build"])).toBe(false);
  });
});

describe("createDefaultCommandPolicy", () => {
  it("allows core verification commands and blocks others", () => {
    const policy = createDefaultCommandPolicy();
    const isWindows = process.platform === "win32";

    expect(policy.isAllowed(["ls", "-la"])).toBe(true);
    expect(policy.isAllowed(["npm", "test"])).toBe(true);
    expect(policy.isAllowed(["npm", "run", "lint"])).toBe(true);
    expect(policy.isAllowed(["npm", "run", "build"])).toBe(true);
    expect(policy.isAllowed(["tail", "-n", "20", "README.md"])).toBe(true);
    expect(policy.isAllowed(["head", "-n", "30", "docs/intro.md"])).toBe(true);
    expect(policy.isAllowed(["cat", "package.json"])).toBe(true);
    expect(policy.isAllowed(["head", "-n", "400", "README.md", "|", "tail", "-n", "50"])).toBe(
      true
    );
    expect(policy.isAllowed(["cat", "README.md", "|", "tail", "-n", "20"])).toBe(true);
    expect(policy.isAllowed(["tail", "-n", "9999", "README.md"])).toBe(false);
    expect(policy.isAllowed(["tail", "-n", "20", "../secret.txt"])).toBe(false);
    expect(policy.isAllowed(["cat", "/etc/passwd"])).toBe(false);
    expect(policy.isAllowed(["head", "-n", "20", "README.md", "|", "grep", "todo"])).toBe(false);
    expect(policy.isAllowed(["bash", "-lc", "rm -rf /"])).toBe(false);

    expect(policy.isAllowed(["cmd", "/c", "dir"])).toBe(isWindows);
    expect(policy.isAllowed(["cmd", "/c", "dir", "docs"])).toBe(isWindows);
    expect(policy.isAllowed(["cmd", "/c", "type", "README.md"])).toBe(isWindows);
    expect(
      policy.isAllowed([
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-Content",
        "-Path",
        "README.md",
        "-Tail",
        "20"
      ])
    ).toBe(isWindows);
    expect(policy.isAllowed(["cmd", "/c", "type", "../secret.txt"])).toBe(false);
  });

  it("runs safe read pipelines without shell", async () => {
    const policy = createDefaultCommandPolicy();
    const root = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-policy-test-"));
    const lines = Array.from({ length: 120 }, (_item, index) => `line-${index + 1}`).join("\n");
    await writeFile(path.join(root, "sample.txt"), `${lines}\n`, "utf8");

    const result = await runAllowedCommand(
      root,
      ["head", "-n", "80", "sample.txt", "|", "tail", "-n", "5"],
      policy
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "line-76",
      "line-77",
      "line-78",
      "line-79",
      "line-80"
    ]);
  });
});

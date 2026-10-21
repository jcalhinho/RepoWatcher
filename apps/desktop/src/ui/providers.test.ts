import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { providers, raceProviders } from "./providers";

// Provider::key() in the session-events crate is what the backend serializes in SessionEvent.provider.
const backendSource = readFileSync(new URL("../../../../crates/session-events/src/lib.rs", import.meta.url), "utf8");
const keyFn = backendSource.slice(backendSource.indexOf("pub const fn key"));
const backendKeys = [...keyFn.slice(0, keyFn.indexOf("\n    }\n")).matchAll(/=> "([a-z_]+)"/g)].map((match) => match[1]);

describe("provider table", () => {
  it("uses exactly the backend provider keys as event keys", () => {
    expect(backendKeys.length).toBeGreaterThan(0);
    expect(providers.map((provider) => provider.eventKey).sort()).toEqual([...backendKeys].sort());
  });

  it("only races providers that have a local connector", () => {
    expect(raceProviders.every((provider) => provider.connector)).toBe(true);
  });
});

describe("active providers", () => {
  it("shows only Claude Code, Codex, OpenCode, Qwen Code and Gemini CLI for now", () => {
    expect(raceProviders.map((provider) => provider.name).sort()).toEqual(["Claude Code", "Codex", "Gemini CLI", "OpenCode", "Qwen Code"]);
  });
});

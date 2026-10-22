import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeAgents, activeProviders, normalizeEvent, providerFor, providers, setCustomProviders } from "./providers";

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
    expect(activeProviders.every((provider) => provider.connector)).toBe(true);
  });
});

describe("active providers", () => {
  it("shows only Claude Code, Codex, OpenCode, Qwen Code and Gemini CLI for now", () => {
    expect(activeProviders.map((provider) => provider.name).sort()).toEqual(["Claude Code", "Codex", "Gemini CLI", "OpenCode", "Qwen Code"]);
  });
});

describe("custom connectors", () => {
  it("become agents keyed custom:<id> and events are rekeyed to them", () => {
    setCustomProviders([{ id: "my-bot", name: "My Bot", color: "#c98500" }]);
    expect(activeAgents().map((provider) => provider.eventKey)).toContain("custom:my-bot");
    expect(providerFor("custom:my-bot")?.name).toBe("My Bot");
    expect(normalizeEvent({ provider: "custom", agent: "my-bot" }).provider).toBe("custom:my-bot");
    expect(normalizeEvent({ provider: "codex", agent: null }).provider).toBe("codex");
    setCustomProviders([]);
    expect(providerFor("custom:my-bot")).toBeUndefined();
  });
});

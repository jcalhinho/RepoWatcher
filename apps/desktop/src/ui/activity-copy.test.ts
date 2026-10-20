import { describe, expect, it } from "vitest";
import { describeAgentAction } from "./activity-copy";

describe("human-readable runner activity", () => {
  it("summarizes observed file reads without showing raw commands", () => {
    expect(describeAgentAction({
      kind: "tool_started",
      tool_name: "Read",
      file_path: "C:/work/RepoWatcher/apps/desktop/src/ui/App.tsx",
      command: "type secret.txt"
    })).toBe("Examine apps/desktop/src/ui/App.tsx");
  });

  it("summarizes shell tools without exposing command text", () => {
    expect(describeAgentAction({
      kind: "tool_started",
      tool_name: "PowerShell",
      command: "Remove-Item important.txt"
    })).toBe("Lance une commande");
  });

  it("uses human-readable copy for failures and completion events", () => {
    expect(describeAgentAction({ kind: "tool_failed", tool_name: "Edit", file_path: "src/App.tsx" }))
      .toBe("Bloqué pendant la modification de src/App.tsx");
    expect(describeAgentAction({ kind: "checkpoint" })).toBe("Termine une étape");
  });

  it("omits events that do not describe an agent action", () => {
    expect(describeAgentAction({ kind: "model_usage" })).toBeNull();
  });
});

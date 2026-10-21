import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { narrateEvent } from "./activity-copy";

const describeAgentAction = (event: Parameters<typeof narrateEvent>[0]) => narrateEvent(event)?.text ?? null;

beforeAll(() => setLang("fr"));

describe("human-readable agent narration", () => {
  it("names the file an agent reads or edits, keeping only the end of the path", () => {
    expect(describeAgentAction({ kind: "tool_started", tool_name: "Read", file_path: "C:/work/RepoWatcher/apps/desktop/src/ui/App.tsx" }))
      .toBe("Lit src/ui/App.tsx");
    expect(describeAgentAction({ kind: "tool_started", tool_name: "edit", file_path: "/work/demo/src/main.rs" }))
      .toBe("Modifie demo/src/main.rs");
    expect(describeAgentAction({ kind: "tool_started", tool_name: "write_file" })).toBe("Écrit un fichier");
  });

  it("shows only the program name of a captured command, never its arguments", () => {
    const text = describeAgentAction({ kind: "tool_started", tool_name: "Bash", command: "rm -rf ./secret-folder --force" });
    expect(text).toBe("Lance « rm … »");
    expect(text).not.toContain("secret");
    expect(describeAgentAction({ kind: "tool_started", tool_name: "PowerShell" })).toBe("Lance une commande");
  });

  it("explains failures, completions and model calls with their reported details", () => {
    expect(narrateEvent({ kind: "tool_failed", tool_name: "Edit", file_path: "src/App.tsx", outcome: "error" }))
      .toEqual({ text: "✗ Échec de Edit sur src/App.tsx", detail: "statut : error", tone: "failure" });
    expect(narrateEvent({ kind: "tool_finished", tool_name: "read_file", file_path: "src/a.ts", duration_ms: { value: 1250 } }))
      .toEqual({ text: "✓ A lu src/a.ts", detail: "read_file · 1,3 s", tone: "success" });
    expect(narrateEvent({ kind: "checkpoint", duration_ms: { value: 34_000 } })).toEqual({ text: "Tour terminé", detail: "en 34 s", tone: "success" });
    expect(narrateEvent({ kind: "checkpoint", outcome: "turn-error" })?.tone).toBe("failure");
    const usage = narrateEvent({ kind: "model_usage", model: { value: "qwen3-coder" }, input_tokens: { value: 12_400 }, output_tokens: { value: 800 } });
    expect(usage?.text).toBe("Réfléchit avec le modèle");
    expect(usage?.detail).toContain("qwen3-coder");
  });

  it("quotes a prompt only when its text was captured", () => {
    expect(narrateEvent({ kind: "user_message" })?.detail).toBe("texte du prompt non capturé");
    expect(narrateEvent({ kind: "user_message", content: "Ajoute   un test\npour le parser" })?.detail).toBe("« Ajoute un test pour le parser »");
  });

  it("omits events that do not describe an agent action", () => {
    expect(narrateEvent({ kind: "something_else" })).toBeNull();
  });
});

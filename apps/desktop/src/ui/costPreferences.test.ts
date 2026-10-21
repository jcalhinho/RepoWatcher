import { afterEach, describe, expect, it, vi } from "vitest";
import { costLabel, isOnSubscription, subscriptionPreferenceKey } from "./costPreferences";
import { writePreference } from "./preferences";

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key)
    }
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cost preferences", () => {
  it("stores the subscription choice per agent", () => {
    const store = stubStorage();
    writePreference(subscriptionPreferenceKey("codex"), true);
    expect(store.get("repowatcher.subscription.codex")).toBe("true");
    expect(isOnSubscription("codex")).toBe(true);
    expect(isOnSubscription("gemini_cli")).toBe(false);
  });

  it("labels the amount as a cost, or as consumed value on a subscription", () => {
    stubStorage();
    expect(costLabel("claude_code")).toBe("Coût estimé");
    writePreference(subscriptionPreferenceKey("claude_code"), true);
    expect(costLabel("claude_code")).toBe("Valeur consommée");
    expect(costLabel("claude_code", false)).toBe("Coût estimé");
  });

  it("falls back to pay-per-use when storage is unavailable or holds a stale value", () => {
    expect(costLabel("qwen_code")).toBe("Coût estimé");
    const store = stubStorage();
    store.set("repowatcher.subscription.qwen_code", "\"yes\"");
    expect(isOnSubscription("qwen_code")).toBe(false);
  });
});

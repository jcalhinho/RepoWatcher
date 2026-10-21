import { t } from "./i18n";
import { isBoolean, readPreference, usePreference } from "./preferences";

// Many people use these agents through a subscription (Claude Max, ChatGPT,
// Gemini, Qwen…) rather than paying per token. The amount computed from the
// API price list stays the same either way; only what it means changes: a
// bill on the API, or the value of what the subscription covered.

export type CostLabel = "Coût estimé" | "Valeur consommée";

export function subscriptionPreferenceKey(eventKey: string) {
  return `subscription.${eventKey}`;
}

/** Whether the person said this agent runs on a subscription (`eventKey` from `providers.ts`). */
export function isOnSubscription(eventKey: string) {
  return readPreference(subscriptionPreferenceKey(eventKey), false, isBoolean);
}

/** "Je suis au forfait" for one agent, remembered across launches. */
export function useSubscription(eventKey: string) {
  return usePreference(subscriptionPreferenceKey(eventKey), false, isBoolean);
}

/** Heading for the API-price amount of this agent. */
export function costLabel(eventKey: string, onSubscription = isOnSubscription(eventKey)): CostLabel {
  return onSubscription ? "Valeur consommée" : "Coût estimé";
}

/** The label shown to the user, in their language. */
export function costLabelText(eventKey: string, onSubscription = isOnSubscription(eventKey)) {
  return onSubscription ? t("Valeur consommée", "Value consumed") : t("Coût estimé", "Estimated cost");
}

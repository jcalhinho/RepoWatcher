import { useCallback, useState } from "react";

/** Reads a value stored by `usePreference`; storage can be unavailable (private mode, preview). */
export function readPreference<T>(key: string, fallback: T, accept: (value: unknown) => value is T): T {
  try {
    const stored = window.localStorage.getItem(`repowatcher.${key}`);
    if (stored === null) return fallback;
    const value: unknown = JSON.parse(stored);
    return accept(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(`repowatcher.${key}`);
    else window.localStorage.setItem(`repowatcher.${key}`, JSON.stringify(value));
  } catch {
    /* preferences are a convenience: the app works without them */
  }
}

/** State remembered across launches in local storage. `accept` rejects stale or malformed values. */
export function usePreference<T>(key: string, fallback: T, accept: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => readPreference(key, fallback, accept));
  const update = useCallback((next: T) => {
    setValue(next);
    writePreference(key, next);
  }, [key]);
  return [value, update] as const;
}

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isString = (value: unknown): value is string => typeof value === "string";
export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const oneOf = <T extends string>(...options: T[]) => (value: unknown): value is T => typeof value === "string" && (options as string[]).includes(value);

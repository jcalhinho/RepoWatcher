import { useEffect, useState } from "react";

/** Current timestamp refreshed every `intervalMs`; only the calling component re-renders. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

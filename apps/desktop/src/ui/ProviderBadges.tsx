import type { CSSProperties } from "react";
import type { Provider } from "./providers";

export function ProviderMark({ provider, small = false }: { provider: Provider; small?: boolean }) {
  return <span className={`provider-mark ${small ? "small" : ""}`} style={{ "--provider-color": provider.color, "--provider-surface": provider.surface } as CSSProperties}>{provider.initials}</span>;
}

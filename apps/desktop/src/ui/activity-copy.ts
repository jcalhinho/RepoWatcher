type ActivityEvent = {
  kind: string;
  tool_name?: string | null;
  file_path?: string | null;
  command?: string | null;
};

function displayPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").split("/").slice(-5).join("/");
}

export function describeAgentAction(event: ActivityEvent): string | null {
  const tool = (event.tool_name || "").toLowerCase();
  const file = event.file_path ? displayPath(event.file_path) : "";
  if (event.kind === "tool_failed") {
    if (file && /edit|write|patch|create/.test(tool)) return `Bloqué pendant la modification de ${file}`;
    return "Rencontre un blocage";
  }
  if (event.kind === "checkpoint") return "Termine une étape";
  if (event.kind === "session_ended") return "Termine sa session";
  if (event.kind !== "tool_started") return null;
  if (/read|glob|grep|search|list|find/.test(tool)) return file ? `Examine ${file}` : "Explore le projet";
  if (/edit|write|patch|create/.test(tool)) return file ? `Modifie ${file}` : "Modifie un fichier";
  if (/bash|shell|command|powershell|terminal/.test(tool)) return "Lance une commande";
  return "Travaille sur le projet";
}

export function extractFirstJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error("No JSON object found in LLM output");
  }

  let depth = 0;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unterminated JSON object in LLM output");
}

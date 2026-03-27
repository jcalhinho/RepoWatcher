type EmitText = (chunk: string) => void;

export function createJsonFinalFieldEmitter(emitText: EmitText) {
  let source = "";
  let cursor = 0;
  let finalStringStarted = false;
  let finalStringEnded = false;
  let escaping = false;
  let unicodeDigitsNeeded = 0;

  const pushDecodedChar = (value: string) => {
    if (value.length > 0) {
      emitText(value);
    }
  };

  const findFinalStringStart = (): boolean => {
    if (finalStringStarted || finalStringEnded) {
      return true;
    }
    const match = /"final"\s*:\s*"/g.exec(source);
    if (!match) {
      return false;
    }
    finalStringStarted = true;
    cursor = (match.index ?? 0) + match[0].length;
    return true;
  };

  return {
    push(chunk: string) {
      if (!chunk || finalStringEnded) {
        return;
      }
      source += chunk;
      if (!findFinalStringStart()) {
        return;
      }

      while (cursor < source.length && !finalStringEnded) {
        const char = source[cursor];

        if (unicodeDigitsNeeded > 0) {
          if (!/[0-9a-fA-F]/.test(char)) {
            // Invalid escape, stop parsing further characters.
            return;
          }
          unicodeDigitsNeeded -= 1;
          cursor += 1;
          if (unicodeDigitsNeeded === 0) {
            // Unicode escapes are skipped here to keep parser lightweight.
            pushDecodedChar("");
          }
          continue;
        }

        if (escaping) {
          escaping = false;
          if (char === "n") pushDecodedChar("\n");
          else if (char === "r") pushDecodedChar("\r");
          else if (char === "t") pushDecodedChar("\t");
          else if (char === "b") pushDecodedChar("\b");
          else if (char === "f") pushDecodedChar("\f");
          else if (char === "u") unicodeDigitsNeeded = 4;
          else pushDecodedChar(char);
          cursor += 1;
          continue;
        }

        if (char === "\\") {
          escaping = true;
          cursor += 1;
          continue;
        }
        if (char === "\"") {
          finalStringEnded = true;
          cursor += 1;
          return;
        }

        pushDecodedChar(char);
        cursor += 1;
      }
    }
  };
}

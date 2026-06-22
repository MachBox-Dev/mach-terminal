/** True when a composer draft or sanitized line is a shell exit/logout command. */
export function isShellExitCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(exit|logout)(\s+\d+)?$/.test(normalized);
}

/** True when PTY payload is a lone exit/logout command (composer or terminal Enter). */
export function isShellExitPayload(data: string): boolean {
  const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    return false;
  }
  return isShellExitCommand(lines[0]!);
}

/** Track a PTY keystroke buffer; returns the submitted line when Enter is pressed. */
export function appendTerminalInputLine(currentLine: string, data: string): { line: string; submitted: string | null } {
  let line = currentLine;
  for (const char of data) {
    if (char === "\r" || char === "\n") {
      const submitted = line.trim();
      return { line: "", submitted: submitted.length > 0 ? submitted : null };
    }
    if (char === "\u007f" || char === "\b") {
      line = line.slice(0, -1);
      continue;
    }
    if (char === "\u0015") {
      line = "";
      continue;
    }
    if (char >= " " || char === "\t") {
      line += char;
    }
  }
  return { line, submitted: null };
}

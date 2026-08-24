export type LineEnding = "\r\n" | "\n";

function countLineEndings(content: string): { crlf: number; lf: number } {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }
    if (index > 0 && content[index - 1] === "\r") {
      crlf += 1;
    } else {
      lf += 1;
    }
  }
  return { crlf, lf };
}

/** Picks the ending the file already uses, so a rewrite does not flip the rest of it. */
export function detectDominantLineEnding(content: string): LineEnding {
  const { crlf, lf } = countLineEndings(content);
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * Answers only when the file speaks one dialect. A file that mixes them holds
 * lines this extension does not own, and converting those is not its call.
 */
export function detectUniformLineEnding(
  content: string,
): LineEnding | undefined {
  const { crlf, lf } = countLineEndings(content);
  if (crlf > 0 && lf > 0) {
    return undefined;
  }
  if (crlf > 0) {
    return "\r\n";
  }
  return lf > 0 ? "\n" : undefined;
}

export function applyLineEnding(text: string, lineEnding: LineEnding): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return lineEnding === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

/** Leaves the text untouched when the target file has no single ending to match. */
export function matchLineEnding(text: string, reference: string): string {
  const lineEnding = detectUniformLineEnding(reference);
  return lineEnding ? applyLineEnding(text, lineEnding) : text;
}

/** A long paste kept as a card and sent after the prompt, as in Synara's composerPastedText.ts. */
export const PASTE_MINIMUM_CHARACTERS = 4_000;
export const PASTE_MINIMUM_LINES = 25;

export const normalizePaste = (text: string) => text.replace(/\r\n?/g, "\n");

export function shouldCollapsePaste(text: string): boolean {
  const normalized = normalizePaste(text);
  return normalized.length >= PASTE_MINIMUM_CHARACTERS || normalized.split("\n").length >= PASTE_MINIMUM_LINES;
}

export function pasteTitle(text: string): string {
  return (text.split("\n").map((l) => l.trim()).find(Boolean) ?? "").slice(0, 140);
}

export function pasteSizeLabel(text: string): string {
  const lines = text.split("\n").length;
  return lines > 1 ? `${lines} righe` : `${text.length} caratteri`;
}

/** `prompt`, a blank line and the pastes as a JSON array inside <pasted_text>. */
export function serializePastes(prompt: string, pastes: string[]): string {
  const trimmed = prompt.trim();
  if (!pastes.length) return trimmed;
  return `${trimmed}\n\n<pasted_text>\n${JSON.stringify(pastes.map((text) => ({ text })))}\n</pasted_text>`;
}

export function extractPastes(text: string): { prompt: string; pastes: string[] } {
  const match = text.match(/\n*<pasted_text>\n([\s\S]*?)\n<\/pasted_text>\s*$/);
  if (!match) return { prompt: text, pastes: [] };
  try {
    const items = JSON.parse(match[1]!) as { text?: string }[];
    return { prompt: text.slice(0, match.index).trim(), pastes: items.map((i) => i.text ?? "").filter(Boolean) };
  } catch {
    return { prompt: text, pastes: [] };
  }
}

/** Short identifiers as Trama shows them: a prefix and the first 8 hex characters of a UUID. */
export function shortId(prefix: "D" | "M" | "Q", uuid: string): string {
  return `${prefix}-${uuid.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

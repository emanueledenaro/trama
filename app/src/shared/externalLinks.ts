/**
 * The links Trama opens in the person's browser: an https address, or a local preview of the project on this Mac
 * (http on localhost, 127.0.0.1 or [::1]), which the Coordinator links when the person asks to see the site. Any
 * other scheme or host stays plain text.
 */
export function opensInBrowser(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
}

import { describe, expect, it } from "vitest";
import { opensInBrowser } from "./externalLinks";

describe("the links Trama opens in the browser", () => {
  it("opens https addresses and the local preview of the project", () => {
    expect(opensInBrowser("https://example.com/page")).toBe(true);
    expect(opensInBrowser("http://127.0.0.1:4321")).toBe(true);
    expect(opensInBrowser("http://localhost:3000/notizie/")).toBe(true);
    expect(opensInBrowser("http://[::1]:8080/")).toBe(true);
  });

  it("keeps other schemes and hosts as plain text", () => {
    expect(opensInBrowser("http://example.com")).toBe(false);
    expect(opensInBrowser("http://127.0.0.1.example.com")).toBe(false);
    expect(opensInBrowser("file:///etc/hosts")).toBe(false);
    expect(opensInBrowser("javascript:alert(1)")).toBe(false);
    expect(opensInBrowser("not a url")).toBe(false);
  });
});

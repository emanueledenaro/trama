import { describe, expect, it } from "vitest";
import { interfaceFiles, isInterfaceFile, touchesInterface } from "./interfaceChange";

describe("interface change (issue #247)", () => {
  it("recognizes components, markup, styles, views and their assets from the paths", () => {
    for (const path of [
      "app/src/renderer/components/chat/Cards.tsx",
      "web/index.html",
      "src/styles/theme.css",
      "src/pages/checkout.vue",
      "Sources/Checkout/CartView.swift",
      "app/src/renderer/lib/store.ts",
      "public/logo.svg",
      "tailwind.config.ts",
      "src/components/Button.ts",
    ]) {
      expect(isInterfaceFile(path), path).toBe(true);
    }
  });

  it("leaves out tests, logic, documentation and data, also under an interface folder", () => {
    for (const path of [
      "app/src/renderer/components/chat/Cards.test.tsx",
      "src/components/__tests__/Button.ts",
      "app/src/main/core/merge.ts",
      "Sources/Orders/CancelPaidOrder.swift",
      "docs/images/readme/chat.png",
      "src/components/README.md",
      "public/manifest.json",
      "NOTE.md",
      "package.json",
    ]) {
      expect(isInterfaceFile(path), path).toBe(false);
    }
  });

  it("says a candidate changes the interface when one of its files does, and lists only those", () => {
    expect(touchesInterface(["NOTE.md", "Sources/Orders/Order.swift"])).toBe(false);
    expect(touchesInterface(["NOTE.md", "web/index.css"])).toBe(true);
    expect(interfaceFiles(["NOTE.md", "web/index.css", "web/app.tsx"])).toEqual(["web/index.css", "web/app.tsx"]);
  });
});

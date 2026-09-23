import { afterEach, describe, expect, it } from "vitest";
import { CoordinatorToolServer, toolSuccess } from "./toolServer";

let server: CoordinatorToolServer | null = null;
afterEach(() => server?.stop());

async function post(url: string, token: string | null, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: response.status === 200 ? await response.json() : null };
}

describe("CoordinatorToolServer", () => {
  it("rejects calls without the session token and serves tools with it", async () => {
    server = new CoordinatorToolServer(
      [{ name: "read_pact", description: "d", properties: {}, required: [], readOnly: true }],
      async (name) => toolSuccess({ tool: name }),
      "instructions",
    );
    const url = await server.start();
    expect((await post(url, null, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    expect((await post(url, "wrong", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    const init = await post(url, server.token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init.json.result.serverInfo.name).toBe("trama");
    expect((await post(url, server.token, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await post(url, server.token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.json.result.tools[0].name).toBe("read_pact");
    const call = await post(url, server.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_pact", arguments: {} } });
    expect(JSON.parse(call.json.result.content[0].text)).toEqual({ tool: "read_pact" });
    const unknown = await post(url, server.token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rm" } });
    expect(unknown.json.error.code).toBe(-32602);
  });
});

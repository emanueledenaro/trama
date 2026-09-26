/**
 * Stdio transport for Trama's MCP server. Antigravity and the ACP agents without HTTP MCP support (issue #228) spawn
 * this proxy, which forwards JSON-RPC lines to Trama's loopback server. The bearer token stays in a private file:
 * never in argv or in the agent's environment.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostToolServer } from "./types";

// The names predate the ACP use; the Antigravity plugin already installed on disk refers to them.
export const MCP_URL_ENV = "TRAMA_ANTIGRAVITY_MCP_URL";
export const MCP_TOKEN_FILE_ENV = "TRAMA_ANTIGRAVITY_MCP_TOKEN_FILE";

/**
 * Stdio-to-HTTP MCP proxy. It forwards JSON-RPC lines to Trama's loopback server with the bearer read
 * from a private file; without a URL or a token (outside a Trama turn) it serves an empty tool list.
 */
export function mcpProxyScriptSource(): string {
  return `const fs = require("node:fs");
const clean = (value) => (typeof value === "string" && value && !value.startsWith("$") ? value : undefined);
const url = clean(process.env.${MCP_URL_ENV});
const tokenFile = clean(process.env.${MCP_TOKEN_FILE_ENV});
let token;
try { token = tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : undefined; } catch { token = undefined; }
const active = Boolean(url && token);
let output = Promise.resolve();
const write = (message) => { output = output.then(() => { process.stdout.write(JSON.stringify(message) + "\\n"); }); return output; };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function inactive(message) {
  if (!isRecord(message) || !("id" in message)) return [];
  const id = message.id;
  if (message.method === "initialize") {
    return [{ jsonrpc: "2.0", id, result: { protocolVersion: (message.params && message.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "trama", version: "1.0.0" } } }];
  }
  if (message.method === "ping") return [{ jsonrpc: "2.0", id, result: {} }];
  if (message.method === "tools/list") return [{ jsonrpc: "2.0", id, result: { tools: [] } }];
  return [{ jsonrpc: "2.0", id, error: { code: -32601, message: "Trama is not active for this Antigravity session." } }];
}
async function forward(message) {
  if (!active) return inactive(message);
  const hasId = isRecord(message) && "id" in message;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + token },
      body: JSON.stringify(message),
    });
    if (response.status === 202) return [];
    const payload = await response.json();
    return (Array.isArray(payload) ? payload : [payload]).filter(isRecord);
  } catch (error) {
    return hasId ? [{ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "Trama tool server request failed: " + String(error) } }] : [];
  }
}
async function handle(line) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const responses = (await Promise.all(messages.map(forward))).flat();
  if (responses.length === 0) return;
  return write(Array.isArray(parsed) ? responses : responses[0]);
}
const inflight = new Set();
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) { const task = handle(line).catch(() => undefined); inflight.add(task); task.finally(() => inflight.delete(task)); }
  }
});
process.stdin.on("end", async () => {
  await Promise.allSettled([...inflight]);
  await output.catch(() => undefined);
  process.exit(0);
});
`;
}

/** A stdio MCP server spawned with Trama's runtime as Node; `dispose` removes the script and the token file. */
export interface StdioHostToolServer {
  command: string;
  args: string[];
  env: Record<string, string>;
  dispose(): Promise<void>;
}

export async function prepareStdioHostToolServer(server: HostToolServer): Promise<StdioHostToolServer> {
  const dir = await mkdtemp(join(tmpdir(), "trama-mcp-"));
  const script = join(dir, "mcp-proxy.cjs");
  const tokenFile = join(dir, "token");
  await writeFile(script, mcpProxyScriptSource(), { mode: 0o600 });
  await writeFile(tokenFile, server.token, { mode: 0o600 });
  return {
    command: process.execPath,
    args: [script],
    env: { [MCP_URL_ENV]: server.url, [MCP_TOKEN_FILE_ENV]: tokenFile, ELECTRON_RUN_AS_NODE: "1" },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export const TOOL_SERVER_NAME = "trama";
export const TOKEN_ENVIRONMENT_VARIABLE = "TRAMA_COORDINATOR_TOKEN";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAXIMUM_BODY_BYTES = 1_048_576;

export interface ToolDefinition {
  name: string;
  description: string;
  properties: Record<string, JsonObject>;
  required: string[];
  readOnly: boolean;
}

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export const toolSuccess = (value: string | JsonObject): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

export const toolFailure = (code: string, message: string): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
  isError: true,
});

export type ToolHandler = (name: string, args: JsonObject) => Promise<ToolResult>;

/**
 * Streamable-HTTP MCP endpoint on the loopback interface. Codex reaches it with a bearer token
 * that only the Coordinator's app-server process receives.
 */
export class CoordinatorToolServer {
  private server: Server | null = null;
  readonly token = `trama_session_${randomBytes(24).toString("hex")}`;

  constructor(
    private readonly tools: ToolDefinition[],
    private readonly handler: ToolHandler,
    private readonly instructions: string,
  ) {}

  async start(): Promise<string> {
    if (this.server) return this.url;
    this.server = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return this.url;
  }

  get url(): string {
    const address = this.server?.address() as AddressInfo | null;
    return `http://127.0.0.1:${address?.port ?? 0}/mcp`;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? "";
    const presented = Buffer.from(header.replace(/^Bearer\s+/i, ""));
    const expected = Buffer.from(this.token);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (!this.authorized(request)) {
      response.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAXIMUM_BODY_BYTES) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    let body: Json;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
    } catch {
      this.json(response, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const messages = Array.isArray(body) ? body : [body];
    const replies: Json[] = [];
    for (const message of messages) {
      const reply = await this.dispatch(message);
      if (reply) replies.push(reply);
    }
    if (replies.length === 0) {
      response.writeHead(202).end();
      return;
    }
    this.json(response, Array.isArray(body) ? replies : replies[0]!);
  }

  private json(response: ServerResponse, value: Json): void {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  }

  private async dispatch(message: Json): Promise<Json | null> {
    if (!message || typeof message !== "object" || Array.isArray(message)) return null;
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : null;
    if (id === undefined || id === null || !method) return null; // notifications
    const params = (message.params && typeof message.params === "object" && !Array.isArray(message.params) ? message.params : {}) as JsonObject;
    const ok = (result: Json) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize": {
        const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
        return ok({
          protocolVersion: requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0]!,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: TOOL_SERVER_NAME, title: "Trama", version: "0.1.0" },
          instructions: this.instructions,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: { type: "object", properties: tool.properties, required: tool.required, additionalProperties: false },
            annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly, openWorldHint: false },
          })),
        });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!this.tools.some((tool) => tool.name === name)) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown or missing tool name" } };
        }
        const args = (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {}) as JsonObject;
        try {
          return ok((await this.handler(name, args)) as unknown as Json);
        } catch (error) {
          return ok(toolFailure("operation_failed", (error as Error).message) as unknown as Json);
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }
}

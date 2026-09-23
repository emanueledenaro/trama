#!/usr/bin/env node
// Minimal stand-in for `codex app-server --stdio`, used by tests and local UI checks only.
import { createInterface } from "node:readline";

if (process.argv[2] === "mcp" && process.argv[3] === "list") {
  process.stdout.write(JSON.stringify([{ name: "github", transport: { type: "stdio" } }]));
  process.exit(0);
}

const account = process.env.FAKE_CODEX_ACCOUNT ?? "chatgpt";
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let threads = 0;
const toolServers = new Map();

async function callTool(threadId, name, args) {
  const server = toolServers.get(threadId);
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env[server.bearer_token_env_var]}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (await response.json()).result;
}
let turns = 0;

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  switch (method) {
    case "initialize":
      return send({ id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" } });
    case "initialized":
      return;
    case "account/read":
      if (account === "none") return send({ id, result: { account: null } });
      if (account === "apikey") return send({ id, result: { account: { type: "apiKey" } } });
      return send({ id, result: { account: { type: "chatgpt", email: "persona@example.com", planType: "plus" } } });
    case "model/list":
      return send({
        id,
        result: {
          data: [
            { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "Modello di prova", isDefault: true, hidden: false, supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" },
          ],
        },
      });
    case "thread/resume":
      return send({ id, error: { code: -32000, message: "thread not found" } });
    case "thread/start": {
      const threadId = `thread-${++threads}`;
      const server = params.config?.["mcp_servers.trama"];
      if (server) toolServers.set(threadId, server);
      return send({ id, result: { thread: { id: threadId } } });
    }
    case "turn/start": {
      const turnId = `turn-${++turns}`;
      const threadId = params.threadId;
      send({ id, result: { turn: { id: turnId } } });
      const text = params.input[0].text;
      if (text.includes("[chiedi-decisione]")) {
        callTool(threadId, "request_decision", {
          category: "product",
          question: "Cosa succede a un ordine pagato annullato?",
          concreteCase: "Ordine 42, già pagato, annullato dal cliente",
          alternatives: [
            { behavior: "Va in revisione", example: "Lo stato diventa review" },
            { behavior: "Rimborso automatico", example: "Il pagamento viene stornato" },
          ],
        }).then((result) => {
          send({ method: "item/completed", params: { threadId, turnId, item: { id: "tool", type: "mcpToolCall", server: "trama", tool: "request_decision", status: "completed", result } } });
          const reply = "Ho chiesto la tua decisione.";
          send({ method: "item/completed", params: { threadId, turnId, item: { id: "msg", type: "agentMessage", phase: "final_answer", text: reply } } });
          send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
        });
        return;
      }
      const reply = text.startsWith("Studio del progetto scritto da Trama")
        ? "Ho letto lo studio: è un progetto Swift con i moduli Catalog, Inventory, Orders, Payments e Users. Vedi Sources/Orders/CancelPaidOrder.swift."
        : `Ho ricevuto: **${text.slice(0, 200)}**. Questa risposta arriva dal server di prova. Vedi Sources/Orders/CancelPaidOrder.swift.`;
      const pieces = reply.match(/.{1,12}/g);
      send({ method: "item/started", params: { threadId, turnId, item: { id: "msg", type: "agentMessage", phase: "final_answer" } } });
      send({ method: "item/completed", params: { threadId, turnId, item: { id: "cmd", type: "commandExecution", command: "git status --short", exitCode: 0, status: "completed", aggregatedOutput: "" } } });
      pieces.forEach((delta, index) =>
        setTimeout(() => send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "msg", delta } }), 20 * index),
      );
      setTimeout(() => {
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "msg", type: "agentMessage", phase: "final_answer", text: reply } } });
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      }, 20 * pieces.length + 20);
      return;
    }
    case "turn/interrupt":
      return send({ id, result: {} });
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `unknown ${method}` } });
  }
});

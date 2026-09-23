#!/usr/bin/env node
// Minimal stand-in for `codex app-server --stdio`, used by tests and local UI checks only.
import { createInterface } from "node:readline";

if (process.argv[2] === "sandbox") {
  // No real sandbox here: run what follows "--" so the plumbing can be tested.
  const { spawnSync } = await import("node:child_process");
  const rest = process.argv.slice(process.argv.indexOf("--") + 1);
  const result = spawnSync(rest[0], rest.slice(1), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

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

createInterface({ input: process.stdin }).on("line", async (line) => {
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
      const finish = (reply) => {
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "msg", type: "agentMessage", phase: "final_answer", text: reply } } });
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      };
      const toolDone = (tool, result) =>
        send({ method: "item/completed", params: { threadId, turnId, item: { id: `tool-${tool}`, type: "mcpToolCall", server: "trama", tool, status: "completed", result } } });
      if (params.sandboxPolicy?.type === "workspaceWrite") {
        // A specialist with its own worktree: write one file there, as Codex would.
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const root = params.sandboxPolicy.writableRoots[0];
        writeFileSync(join(root, "NOTE.md"), "Lavoro dello specialista\n");
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "fc", type: "fileChange", status: "completed", changes: [{ path: "NOTE.md" }] } } });
        if (text.includes("[lento]")) return; // stays running until interrupted
        setTimeout(() => finish("Ho scritto NOTE.md nel worktree."), 30);
        return;
      }
      if (text.includes("[proponi-team]")) {
        callTool(threadId, "propose_team", {
          summary: "Un solo specialista per il modulo Orders",
          specialists: [{ name: "Ada", competence: "Swift", reason: "Il dominio è in Swift", moduleIDs: ["Sources/Orders"] }],
        }).then((result) => {
          toolDone("propose_team", result);
          finish("Ti ho proposto il team.");
        });
        return;
      }
      if (text.includes("[assegna]")) {
        callTool(threadId, "assign_task", {
          specialist: "Ada",
          kind: "agreedTicket",
          objective: "Documenta l'annullamento",
          moduleIDs: ["Sources/Orders"],
          requiredChecks: ["git_status"],
          tools: ["edits"],
          instructions: text.includes("[lento]") ? "[lento] Scrivi una nota" : "Scrivi una nota",
        }).then((result) => {
          toolDone("assign_task", result);
          finish(result.isError ? `Rifiutato: ${result.content[0].text}` : "Ho assegnato il lavoro ad Ada.");
        });
        return;
      }
      if (text.includes("[verifica]")) {
        callTool(threadId, "run_readonly_check", { check: "git_status" }).then((result) => {
          toolDone("run_readonly_check", result);
          finish("Ho eseguito la verifica.");
        });
        return;
      }
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
      send({ id, result: {} });
      return send({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `unknown ${method}` } });
  }
});

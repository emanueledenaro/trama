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
    case "account/rateLimits/read":
      if (process.env.FAKE_CODEX_LIMITS === "none") return send({ id, error: { code: -32601, message: "method not found" } });
      return send({
        id,
        result: {
          ordinaryUsageAllowed: process.env.FAKE_CODEX_LIMITS !== "exhausted",
          rateLimits: { limitId: "codex", primary: { usedPercent: 100, windowDurationMins: 43200, resetsAt: 1792820871 }, planType: process.env.FAKE_CODEX_LIMITS === "exhausted" ? "free" : "plus" },
        },
      });
    case "model/list":
      return send({
        id,
        result: {
          data: [
            { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "Modello di prova", isDefault: true, hidden: false, supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" },
            { id: "gpt-5.5-fast", model: "gpt-5.5-fast", displayName: "GPT-5.5 Fast", description: "Modello con livello veloce", isDefault: false, hidden: false, supportedReasoningEfforts: ["low"], defaultReasoningEffort: "low", additionalSpeedTiers: ["fast"] },
          ],
        },
      });
    case "skills/list":
      return send({
        id,
        result: { data: [{ cwd: params.cwds[0], errors: [], skills: [{ name: "tdd", path: "/skills/tdd/SKILL.md", enabled: true, interface: { shortDescription: "Test-driven development" } }] }] },
      });
    case "thread/resume":
      return send({ id, error: { code: -32000, message: "thread not found" } });
    case "thread/start": {
      const threadId = `thread-${process.pid}-${++threads}`;
      const server = params.config?.["mcp_servers.trama"];
      if (server) toolServers.set(threadId, server);
      return send({ id, result: { thread: { id: threadId } } });
    }
    case "turn/start": {
      const turnId = `turn-${++turns}`;
      const threadId = params.threadId;
      const text = params.input[0].text;
      if (text.includes("[attesa]")) {
        // Answers turn/start late and then keeps running until interrupted.
        setTimeout(() => send({ id, result: { turn: { id: turnId } } }), 150);
        return;
      }
      send({ id, result: { turn: { id: turnId } } });
      const finish = (reply) => {
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "msg", type: "agentMessage", phase: "final_answer", text: reply } } });
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      };
      const toolDone = (tool, result) =>
        send({ method: "item/completed", params: { threadId, turnId, item: { id: `tool-${tool}`, type: "mcpToolCall", server: "trama", tool, status: "completed", result } } });
      if (text.includes("[tier]")) {
        // Echoes the service tier the turn asked for.
        setTimeout(() => finish(`tier:${params.serviceTier ?? "none"}`), 10);
        return;
      }
      if (params.outputSchema?.required?.includes("sourceSnapshotID")) {
        const sources = JSON.parse(text.slice(text.indexOf("Fonti: ") + 7));
        const plan = {
          sourceSnapshotID: sources.sourceSnapshotID,
          summary: "Mandare in revisione gli ordini pagati annullati",
          steps: ["Leggere CancelPaidOrder.swift", "Cambiare lo stato", "Aggiungere un test"],
          affectedModuleIDs: sources.knownModuleIDs.slice(0, 1),
          references: sources.knownFiles.slice(0, 1),
          requiredDecisionIDs: [],
          proposedBehavior: "Un ordine pagato annullato va in revisione",
          acceptedExample: "Ordine 42 pagato e annullato: stato review",
          rationale: "Evita rimborsi automatici errati",
          questions: [
            {
              scenario: "Ordine pagato con carta",
              question: "Il cliente riceve una email?",
              options: [
                { label: "Sì", behavior: "Email immediata", example: "Email alle 10:01", rationale: "Trasparenza" },
                { label: "No", behavior: "Nessuna email", example: "Nessun messaggio", rationale: "Meno rumore" },
              ],
              revisesDecisionID: null,
            },
          ],
        };
        setTimeout(() => finish(JSON.stringify(plan)), 10);
        return;
      }
      if (params.outputSchema) {
        const verdict = text.includes("RIFIUTA") ? "changesRequested" : "approved";
        setTimeout(() => finish(JSON.stringify({ verdict, summary: "Il diff rispetta le decisioni indicate." })), 10);
        return;
      }
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
      if (text.includes("Review the conversation above")) {
        // A learning review: add a profile fact, propose to remove a note, create a skill (ADR 0014).
        const calls = [];
        if (text.includes("[comando]")) {
          // A provider that runs one of its own tools anyway: Trama must stop the review and save nothing.
          send({ method: "item/completed", params: { threadId, turnId, item: { id: "cmd", type: "commandExecution", command: "cat notes.txt", status: "completed", exitCode: 0 } } });
          await new Promise((r) => setTimeout(r, 50));
        }
        if (text.includes("You can only call memory and skill")) {
          calls.push(["memory", { target: "user", action: "add", content: "La persona preferisce risposte brevi in italiano" }]);
          calls.push(["memory", { target: "memory", action: "remove", old_text: "pnpm" }]);
        }
        calls.push([
          "skill_manage",
          { operations: [{ action: "create", name: "release-flow", content: "---\nname: release-flow\ndescription: Use when releasing. Tag, build, publish.\n---\n\n# Release\n\n## When to Use\n- releasing\n" }] },
        ]);
        calls.push(["run_readonly_check", { check: "git_status" }]);
        for (const [tool, args] of calls) toolDone(tool, await callTool(threadId, tool, args));
        finish("Saved what stood out.");
        return;
      }
      if (text.includes("[memoria]")) {
        callTool(threadId, "memory", { target: "memory", action: "add", content: "Il progetto usa pnpm 9" }).then(async (result) => {
          toolDone("memory", result);
          const search = await callTool(threadId, "session_search", { query: "annullamento" });
          toolDone("session_search", search);
          finish(`Salvato. ${search.content[0].text}`);
        });
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
      const candidateMatch = text.match(/\[candidato:(A-[0-9A-F]+):(D-[0-9A-F]+)\]/);
      if (candidateMatch) {
        callTool(threadId, "declare_candidate", { assignment: candidateMatch[1], decisionIDs: [candidateMatch[2]] }).then(async (declared) => {
          toolDone("declare_candidate", declared);
          if (declared.isError) return finish(`Rifiutato: ${declared.content[0].text}`);
          const { candidateID } = JSON.parse(declared.content[0].text);
          const verified = await callTool(threadId, "verify_candidate", { candidate: candidateID, check: "git_status" });
          toolDone("verify_candidate", verified);
          const reviewed = await callTool(threadId, "review_candidate", { candidate: candidateID });
          toolDone("review_candidate", reviewed);
          const cleared = await callTool(threadId, "clear_candidate", { candidate: candidateID });
          toolDone("clear_candidate", cleared);
          finish(cleared.isError ? `Via libera rifiutato: ${cleared.content[0].text}` : `Candidato ${candidateID} verificato e con via libera.`);
        });
        return;
      }
      if (text.includes("[piano]")) {
        callTool(threadId, "prepare_plan", { kind: "agreedTicket", moduleIDs: ["Sources/Orders"], summary: "Revisione degli ordini pagati annullati" }).then((result) => {
          toolDone("prepare_plan", result);
          finish(result.isError ? `Rifiutato: ${result.content[0].text}` : "Ho chiesto un piano al pianificatore.");
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
      if (text.startsWith("Studio del progetto scritto da Trama") && text.includes("propose_goal")) {
        // A project without goals: the study closes with a first goal (UX07).
        const result = await callTool(threadId, "propose_goal", {
          title: "Annullare un ordine pagato senza rimborso automatico",
          outcome: "Un ordine pagato e annullato va in revisione invece di essere rimborsato subito.",
          acceptedExamples: ["Ordine 42 pagato e annullato: lo stato diventa review"],
          refusedExamples: ["Ordine 42 pagato e annullato: il pagamento viene stornato subito"],
        });
        toolDone("propose_goal", result);
      }
      send({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total: { totalTokens: text.includes("[pieno]") ? 230_000 : 12_000 }, modelContextWindow: 258_000 } } });
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

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
const receivedByThread = new Map();

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
      const toolDone = (tool, result) =>
        send({ method: "item/completed", params: { threadId, turnId, item: { id: `tool-${tool}`, type: "mcpToolCall", server: "trama", tool, status: "completed", result } } });
      // "[passo:<move>]" closes the turn with that next step (W01), after the turn's other tools; a refusal ends up in the reply.
      // Only the Coordinator's threads have Trama's tools: a planner or a review quoting the request declares nothing.
      const declareStep = async () => {
        const step = text.match(/\[passo:(\w+)\]/);
        if (!step || !toolServers.has(threadId)) return "";
        const result = await callTool(threadId, "declare_next_step", { move: step[1], reason: "Il lavoro aspetta questo passo." });
        toolDone("declare_next_step", result);
        return result.isError ? ` | Passo rifiutato: ${result.content[0].text}` : "";
      };
      const finish = async (reply) => {
        const step = await declareStep();
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "msg", type: "agentMessage", phase: "final_answer", text: reply + step } } });
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      };
      // Remembers the skill inputs and late-rule sections each thread received (M02).
      const seen = receivedByThread.get(threadId) ?? [];
      seen.push(...params.input.filter((item) => item.type === "skill").map((item) => `skill:${item.name}:${item.path}`));
      if (text.includes("## Regole aggiornate da Trama")) seen.push("rules");
      receivedByThread.set(threadId, seen);
      if (text.includes("[ricevuti]")) {
        setTimeout(() => finish(JSON.stringify(seen)), 10);
        return;
      }
      if (text.includes("[tier]")) {
        // Echoes the service tier the turn asked for.
        setTimeout(() => finish(`tier:${params.serviceTier ?? "none"}`), 10);
        return;
      }
      // The fixed roles' automatic work (W11): each answer names the skill inputs the thread received.
      const required = params.outputSchema?.required ?? [];
      if (required.includes("category") && required.includes("comment")) {
        const number = text.match(/Triage della issue #(\d+)/)?.[1] ?? "?";
        const answer = {
          category: "bug",
          state: "ready-for-agent",
          reasoning: `La issue #${number} descrive un difetto riproducibile.`,
          verification: `Skill ricevute: ${seen.join(", ")}`,
          alreadyImplemented: "",
          comment: "> *This was generated by AI during triage.*\n\n## Agent Brief\nCorreggere il salvataggio.",
        };
        setTimeout(() => finish(JSON.stringify(answer)), 10);
        return;
      }
      if (required.includes("loopCommand")) {
        const modules = (text.match(/Moduli del progetto: (.*)\./)?.[1] ?? "").split(", ").filter((m) => m && m !== "nessuno");
        const answer = {
          loopCommand: "npm test",
          loopOutput: "1 failed",
          reproduced: true,
          hypotheses: ["Il test fallisce per un difetto nel codice", `Skill ricevute: ${seen.join(", ")}`],
          cause: "Lo script di test esce con 1",
          regressionTest: "Un test che fallisce finché lo script esce con 1",
          seamNote: "",
          fix: "Far uscire lo script con 0",
          moduleIDs: [modules.find((m) => m.endsWith("Orders")) ?? modules[0]].filter(Boolean),
          openQuestions: "",
        };
        setTimeout(() => finish(JSON.stringify(answer)), 10);
        return;
      }
      if (required.includes("topRecommendation")) {
        const candidate = (title, strength) => ({
          title,
          files: ["Sources/Orders/CancelPaidOrder.swift"],
          problem: "L'interfaccia è complessa quasi quanto l'implementazione",
          solution: "Un modulo profondo dietro un'interfaccia piccola",
          benefits: "Più località, test sull'interfaccia",
          strength,
          adrConflict: "",
        });
        const answer = { candidates: [candidate("Approfondire l'annullamento", "Strong"), candidate("Unire i pagamenti", "Speculative")], topRecommendation: `Skill ricevute: ${seen.join(", ")}` };
        setTimeout(() => finish(JSON.stringify(answer)), 10);
        return;
      }
      if (params.outputSchema?.required?.includes("seams")) {
        // The planner runs AI Hero's to-spec (M04): the seam turn, then the spec turn with the person's answer.
        // Like a real planner it needs the skills: without both skill inputs it answers no JSON.
        const skills = params.input.filter((item) => item.type === "skill").map((item) => item.name);
        if (!skills.includes("to-spec") || !skills.includes("codebase-design")) {
          setTimeout(() => finish("Mi mancano le skill to-spec e codebase-design."), 10);
          return;
        }
        const sources = JSON.parse(text.slice(text.lastIndexOf("Fonti: ") + 7));
        const seams = [{ seam: "L'interfaccia di CancelPaidOrder: annullare un ordine pagato", existing: true, tests: "Un ordine pagato annullato va in revisione" }];
        if (!params.outputSchema.required.includes("problemStatement")) {
          setTimeout(() => finish(JSON.stringify({ sourceSnapshotID: sources.sourceSnapshotID, seams })), 10);
          return;
        }
        const answer = text.match(/## Risposta della persona sui seam\n(.*)/)?.[1] ?? "nessuna";
        const spec = {
          sourceSnapshotID: sources.sourceSnapshotID,
          title: "Ordini pagati annullati in revisione",
          problemStatement: "Un ordine pagato e annullato viene rimborsato subito, senza che nessuno lo controlli.",
          solution: "L'ordine pagato e annullato va in revisione e il supporto decide il rimborso.",
          userStories: [
            "Come persona del supporto, voglio vedere gli ordini pagati annullati in revisione, così che possa decidere il rimborso",
            "Come cliente, voglio sapere che il mio ordine è in revisione, così che non mi aspetti un rimborso immediato",
          ],
          implementationDecisions: ["Lo stato review si aggiunge agli stati dell'ordine"],
          testingDecisions: ["Si prova l'annullamento attraverso l'interfaccia di CancelPaidOrder, il seam esistente"],
          outOfScope: "Le email al cliente.",
          furtherNotes: `Skill ricevute: ${skills.join(", ")}. Risposta sui seam: ${answer}`,
          seams: answer.startsWith("Correzione") ? [...seams, { seam: "Il rimborso manuale del supporto", existing: false, tests: "Il supporto rimborsa l'ordine 42" }] : seams,
          affectedModuleIDs: sources.knownModuleIDs.slice(0, 1),
          references: sources.knownFiles.slice(0, 1),
          requiredDecisionIDs: [],
        };
        setTimeout(() => finish(JSON.stringify(spec)), 10);
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
      if (text.includes("[chiedi-mandato")) {
        // [chiedi-mandato] or [chiedi-mandato:<reason>]: a mandate request, which supersedes a pending one (W14).
        const reason = text.match(/\[chiedi-mandato:([^\]]+)\]/)?.[1] ?? "Serve un piano per gli ordini";
        callTool(threadId, "request_mandate", {
          reason,
          objectives: ["Documentare l'annullamento degli ordini"],
          scopeModuleIDs: ["Sources/Orders"],
          authorizedActions: ["plan"],
        }).then((result) => {
          toolDone("request_mandate", result);
          finish(result.isError ? `Rifiutato: ${result.content[0].text}` : result.content[0].text);
        });
        return;
      }
      if (text.includes("[proponi-team]")) {
        callTool(threadId, "propose_team", {
          summary: "Un solo specialista per il modulo Orders",
          specialists: [{ name: "Ada", tag: "Ordini", competence: "Swift", reason: "Il dominio è in Swift", moduleIDs: ["Sources/Orders"] }],
        }).then((result) => {
          toolDone("propose_team", result);
          finish("Ti ho proposto il team.");
        });
        return;
      }
      const renameMatch = text.match(/\[rinomina:([^:\]]+):([^\]]+)\]/);
      if (renameMatch) {
        callTool(threadId, "rename_specialist", { specialist: renameMatch[1], name: renameMatch[2] }).then((result) => {
          toolDone("rename_specialist", result);
          finish(result.isError ? `Rifiutato: ${result.content[0].text}` : `Ho rinominato ${renameMatch[1]} in ${renameMatch[2]}.`);
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
      const checkMatch = text.match(/\[verifica(?::(\w+))?\]/);
      if (checkMatch) {
        callTool(threadId, "run_readonly_check", { check: checkMatch[1] ?? "git_status" }).then((result) => {
          toolDone("run_readonly_check", result);
          finish("Ho eseguito la verifica.");
        });
        return;
      }
      const grillingMatch = text.match(/\[grilling:(\d+)\]/);
      if (grillingMatch) {
        // A grilling round (M01): round 1 asks two questions of the frontier, later rounds one.
        const round = Number(grillingMatch[1]);
        const questions = round === 1 ? ["Chi vede gli ordini in revisione?", "Il cliente riceve una email?"] : [`Domanda del turno ${round}`];
        const answers = [];
        for (const question of questions) {
          const result = await callTool(threadId, "request_decision", {
            category: "product",
            question,
            concreteCase: "Ordine 42, già pagato, annullato dal cliente",
            alternatives: [
              { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42" },
              { behavior: "Anche il cliente", example: "Il cliente vede lo stato review" },
            ],
            grillingRound: round,
            recommendedAlternative: 1,
          });
          toolDone("request_decision", result);
          answers.push(result.isError ? `Rifiutato: ${result.content[0].text}` : "ok");
        }
        finish(answers.join(" | "));
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
      const reply =
        (text.startsWith("Studio del progetto scritto da Trama")
          ? "Ho letto lo studio: è un progetto Swift con i moduli Catalog, Inventory, Orders, Payments e Users. Vedi Sources/Orders/CancelPaidOrder.swift."
          : `Ho ricevuto: **${text.slice(0, 200)}**. Questa risposta arriva dal server di prova. Vedi Sources/Orders/CancelPaidOrder.swift.`) + (await declareStep());
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

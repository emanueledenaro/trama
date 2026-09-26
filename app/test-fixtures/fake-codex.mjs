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
// Threads opened for "[lento:sempre]" work: the Coordinator's instructions carry the tag, so a resumed turn, whose
// prompt only says to go on, stays running until interrupted like the first one. "[lento]" work ends when resumed.
const slowThreads = new Set();
// The first slice Trama lists as ready in the Coordinator's message (M05), as assign_task's slice argument.
const readySlice = (text) => {
  const id = text.match(/^- (S\d+) «[^»]*»:[^\n]* pronta\./m)?.[1];
  return id ? { slice: id } : {};
};

// The contract of assign_task (W05): the seams to test, by number for a slice whose spec has confirmed seams.
const contract = (slice) => ({
  seams: slice.slice ? ["1"] : ["Il file NOTE.md nel worktree"],
  decisionIDs: [],
  dependencies: [],
});

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
  // FAKE_CODEX_LOG names a file that receives each session and turn request, so tests can read what Trama asked for.
  if (process.env.FAKE_CODEX_LOG && (method === "thread/start" || method === "thread/resume" || method === "turn/start")) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify({ method, params })}\n`);
  }
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
      if (String(params.developerInstructions ?? "").includes("[lento:sempre]")) slowThreads.add(threadId);
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
      if (required.includes("tickets")) {
        // The slicer runs AI Hero's to-tickets (M05): three tracer bullets, the last two blocked only by the first,
        // so they can run in parallel. A new round after the person's correction splits the last one in two.
        const skills = params.input.filter((item) => item.type === "skill").map((item) => item.name);
        if (!skills.includes("to-tickets")) {
          setTimeout(() => finish("Mi manca la skill to-tickets."), 10);
          return;
        }
        const sources = JSON.parse(text.slice(text.lastIndexOf("Fonti: ") + 7));
        const correction = text.match(/## Risposta della persona\n(.*)/)?.[1] ?? null;
        const parent = text.match(/La spec è la issue #(\d+)/)?.[1] ?? null;
        const tickets = [
          {
            title: "Stato in revisione per un ordine pagato annullato",
            whatToBuild: `Un ordine pagato annullato passa in revisione invece di essere rimborsato. Skill ricevute: ${skills.join(", ")}. Issue genitore: ${parent ?? "nessuna"}.`,
            acceptanceCriteria: ["Annullare l'ordine pagato 42 lo porta in revisione", "Un ordine non pagato si annulla come prima"],
            blockedBy: [],
          },
          {
            title: "Il supporto vede gli ordini in revisione",
            whatToBuild: "La persona del supporto apre l'elenco degli ordini in revisione e ne sceglie uno.",
            acceptanceCriteria: ["L'ordine 42 compare nell'elenco in revisione"],
            blockedBy: [1],
          },
          {
            title: "Il cliente sa che l'ordine è in revisione",
            whatToBuild: "Il cliente vede lo stato in revisione nel riepilogo dell'ordine.",
            acceptanceCriteria: ["Il riepilogo dell'ordine 42 dice In revisione"],
            blockedBy: [1],
          },
        ];
        if (correction) {
          tickets.push({ title: "Il supporto rimborsa l'ordine in revisione", whatToBuild: `Correzione ricevuta: ${correction}`, acceptanceCriteria: ["Il rimborso dell'ordine 42 chiude la revisione"], blockedBy: [2] });
        }
        setTimeout(() => finish(JSON.stringify({ sourceSnapshotID: sources.sourceSnapshotID, tickets })), 10);
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
        if (text.includes("## Trama binding for the domain-modeling skill")) {
          // The documentation and domain role (M03): copy the proposed glossary block into CONTEXT.md.
          const glossary = text.match(/sotto `## Language`:\n\n```md\n([\s\S]*?)\n```/)?.[1] ?? "";
          writeFileSync(join(root, "CONTEXT.md"), `# Negozio\n\nGli ordini del negozio.\n\n## Language\n\n${glossary}\n`);
          send({ method: "item/completed", params: { threadId, turnId, item: { id: "fc", type: "fileChange", status: "completed", changes: [{ path: "CONTEXT.md" }] } } });
          setTimeout(() => finish(`Ho scritto CONTEXT.md nel worktree. Skill ricevute: ${seen.join(", ")}`), 30);
          return;
        }
        writeFileSync(join(root, "NOTE.md"), "Lavoro dello specialista\n");
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "fc", type: "fileChange", status: "completed", changes: [{ path: "NOTE.md" }] } } });
        // "[spazi]" leaves trailing whitespace in a tracked file, so git_diff_check fails on the candidate (V05).
        const tracked = join(root, "Sources/Orders/CancelPaidOrder.swift");
        if (text.includes("[spazi]")) {
          const { appendFileSync } = await import("node:fs");
          appendFileSync(tracked, "// Nota dello specialista   \n");
        }
        if (text.includes("[lento]") || slowThreads.has(threadId)) return; // stays running until interrupted
        if (text.includes("## Trama binding for the tdd skill")) {
          // The developer of a slice (M06) runs implement and tdd, and reports the confirmed seams it tested.
          const skills = params.input.filter((item) => item.type === "skill").map((item) => item.name);
          const seam = text.match(/## Seam confermati dalla persona\n1\. /) ? "\n- 1: NOTE.md" : "\n- none";
          // The structured report of W05, which extends M06's tested seams.
          const report = `\n\nFiles touched:\n- NOTE.md\nTests written:\n- NOTE.md\nTested seams:${seam}\nDoubts:\n- Il rimborso manuale resta fuori da questa fetta`;
          setTimeout(() => finish(`Ho scritto NOTE.md nel worktree. Skill ricevute: ${skills.join(", ")}${report}`), 30);
          return;
        }
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
      const automatic = text.match(/Mossa automatica di Trama: (\w+)/);
      if (automatic) {
        // A move Trama started by itself (W04). FAKE_CODEX_AUTOMATIC=wait keeps the turn running until interrupted,
        // =idle answers without making the move; otherwise the fake makes it like a Coordinator that follows the rules.
        if (process.env.FAKE_CODEX_AUTOMATIC === "wait") return;
        const call = async (tool, args) => {
          const result = await callTool(threadId, tool, args);
          toolDone(tool, result);
          return result;
        };
        const json = (result) => JSON.parse(result.content[0].text);
        const done = [];
        if (process.env.FAKE_CODEX_AUTOMATIC !== "idle") {
          if (automatic[1] === "preparePlan") {
            await call("prepare_plan", { kind: "agreedTicket", moduleIDs: ["Sources/Orders"], summary: "Revisione degli ordini pagati annullati" });
            done.push("Ho chiesto il piano al pianificatore.");
          } else if (automatic[1] === "assignWork") {
            const assigned = await call("assign_task", {
              ...readySlice(text),
              ...contract(readySlice(text)),
              specialist: "Ada",
              kind: "agreedTicket",
              objective: "Mandare in revisione gli ordini pagati annullati",
              moduleIDs: ["Sources/Orders"],
              requiredChecks: ["git_status"],
              tools: ["edits"],
              instructions: "Scrivi una nota",
            });
            done.push(assigned.isError ? `Rifiutato: ${assigned.content[0].text}` : "Ho assegnato la fetta ad Ada.");
          } else if (automatic[1] === "verifyCandidate") {
            const team = json(await call("read_team", {}));
            const assignment = team.specialists.map((s) => s.assignment).find((a) => a?.status === "completed");
            const decision = json(await call("read_pact", {})).decisions[0];
            const declared = await call("declare_candidate", { assignment: assignment.id, decisionIDs: [decision.id] });
            const { candidateID } = json(declared);
            await call("verify_candidate", { candidate: candidateID, check: "git_status" });
            await call("review_candidate", { candidate: candidateID });
            done.push(`Ho verificato il candidato ${candidateID}.`);
          }
        }
        finish(done.join(" ") || "Non ho fatto la mossa.");
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
      if (text.includes("[dominio]")) {
        // domain-modeling in the Coordinator (M03): a Pact decision resolves a term and an ADR.
        const pact = await callTool(threadId, "read_pact", {});
        toolDone("read_pact", pact);
        const decision = JSON.parse(pact.content[0].text).decisions.at(-1);
        const result = await callTool(threadId, "propose_domain_docs", {
          decisionIDs: decision ? [decision.id] : [],
          terms: [{ term: "Ordine in revisione", definition: "Un ordine pagato e annullato che aspetta la decisione di una persona.", avoid: ["Ordine sospeso", "Rimborso in attesa"] }],
          adrs: [
            {
              title: "Gli ordini pagati annullati vanno in revisione",
              body: "Un ordine pagato e annullato non viene rimborsato subito: va in revisione. Lo abbiamo deciso per evitare rimborsi automatici sbagliati.",
              consideredOptions: ["Rimborso automatico"],
            },
          ],
        });
        toolDone("propose_domain_docs", result);
        finish(result.isError ? `Rifiutato: ${result.content[0].text}` : "Ho proposto glossario e ADR dalle decisioni.");
        return;
      }
      if (text.includes("[assegna")) {
        // [assegna] or [assegna:<slice>]: without a slice the fake names the first ready one Trama lists (M05).
        const named = text.match(/\[assegna:(\w+)\]/)?.[1];
        const slice = named ? { slice: named } : readySlice(text);
        callTool(threadId, "assign_task", {
          ...slice,
          // "[senza-contratto]" leaves out the seams and the Pact decisions: Trama refuses the assignment (W05).
          ...(text.includes("[senza-contratto]") ? { dependencies: [] } : contract(slice)),
          specialist: "Ada",
          kind: "agreedTicket",
          objective: "Documenta l'annullamento",
          moduleIDs: ["Sources/Orders"],
          // "[spazi]" leaves trailing whitespace, "[correggi-spazi]" is the correction: both must pass git_diff_check (V05).
          // "[test]" also names the project's build and test suite, as for the work of a slice (M06).
          requiredChecks: text.includes("[spazi]") || text.includes("[correggi-spazi]")
            ? ["git_status", "git_diff_check"]
            : text.includes("[test]")
              ? ["git_status", "swift_build", "swift_test"]
              : ["git_status"],
          tools: ["edits"],
          instructions: `${text.includes("[lento]") ? "[lento] " : ""}${text.includes("[lento:sempre]") ? "[lento:sempre] " : ""}${text.includes("[spazi]") ? "[spazi] " : ""}Scrivi una nota`,
        }).then((result) => {
          toolDone("assign_task", result);
          finish(result.isError ? `Rifiutato: ${result.content[0].text}` : "Ho assegnato il lavoro ad Ada.");
        });
        return;
      }
      // [riverifica:<candidate>:<check>] runs a required check again: new evidence invalidates an earlier green light (V05).
      const recheckMatch = text.match(/\[riverifica:(C-[0-9A-F]+):(\w+)\]/);
      if (recheckMatch) {
        const verified = await callTool(threadId, "verify_candidate", { candidate: recheckMatch[1], check: recheckMatch[2] });
        toolDone("verify_candidate", verified);
        finish(verified.isError ? `Rifiutato: ${verified.content[0].text}` : `Ho eseguito di nuovo ${recheckMatch[2]} su ${recheckMatch[1]}.`);
        return;
      }
      // [candidato:<assignment>:<decision>] verifies git_status; [candidato:<assignment>:<decision>:<check>] that check, and
      // with "tutte" every required check.
      const candidateMatch = text.match(/\[candidato:(A-[0-9A-F]+):(D-[0-9A-F]+)(?::(\w+))?\]/);
      if (candidateMatch) {
        callTool(threadId, "declare_candidate", { assignment: candidateMatch[1], decisionIDs: [candidateMatch[2]] }).then(async (declared) => {
          toolDone("declare_candidate", declared);
          if (declared.isError) return finish(`Rifiutato: ${declared.content[0].text}`);
          const { candidateID, requiredChecks } = JSON.parse(declared.content[0].text);
          const checks = candidateMatch[3] === "tutte" ? requiredChecks : [candidateMatch[3] ?? "git_status"];
          for (const check of checks) toolDone("verify_candidate", await callTool(threadId, "verify_candidate", { candidate: candidateID, check }));
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
      if (text.includes("[presenza]") && toolServers.has(threadId)) {
        // "Chi sta toccando i pagamenti?" (G04): the answer comes from read_presence only, and says whether the turn's
        // message carried the presence section.
        const result = await callTool(threadId, "read_presence", { terms: ["pagament", "payment"] });
        toolDone("read_presence", result);
        const { people } = JSON.parse(result.content[0].text);
        const who = people.map((p) => `${p.who} su ${p.branch} (${p.files.join(", ")})`).join("; ");
        const section = text.includes("## Presenza dei colleghi") ? "Sezione presenza ricevuta." : "Sezione presenza assente.";
        await finish(`${who ? `Sta toccando i pagamenti: ${who}.` : "Nessuno visibile nella presenza sta toccando i pagamenti."} ${section}`);
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
          : `Ho ricevuto: **${text.slice(0, 200)}**. Questa risposta arriva dal server di prova. Vedi Sources/Orders/CancelPaidOrder.swift.`) +
        // "[chiede-conferma]" closes the reply with a generic confirmation question, the habit W04 corrects.
        (text.includes("[chiede-conferma]") ? "\n\nVuoi che prepari il piano?" : "") +
        (await declareStep());
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

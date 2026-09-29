#!/usr/bin/env node
// Minimal stand-in for `codex app-server --stdio`, used by tests and local UI checks only.
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";

if (process.argv[2] === "sandbox") {
  // No real sandbox here: run what follows "--" so the plumbing can be tested.
  const { spawnSync } = await import("node:child_process");
  const rest = process.argv.slice(process.argv.indexOf("--") + 1);
  const result = spawnSync(rest[0], rest.slice(1), { stdio: "inherit" });
  // With FAKE_CODEX_LOG_CHECKS the end of each check joins the request log, so a test can read what ran before what.
  if (process.env.FAKE_CODEX_LOG && process.env.FAKE_CODEX_LOG_CHECKS) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify({ method: "sandbox/ended", params: { command: rest } })}\n`);
  }
  process.exit(result.status ?? 1);
}

if (process.argv[2] === "mcp" && process.argv[3] === "list") {
  process.stdout.write(JSON.stringify([{ name: "github", transport: { type: "stdio" } }]));
  process.exit(0);
}

const account = process.env.FAKE_CODEX_ACCOUNT ?? "chatgpt";
/** Turns answered with a temporary 429 so far; FAKE_CODEX_RATE_LIMITS says how many (default 1). */
let rateLimitedTurns = 0;
/** Turns that met a network outage so far; FAKE_CODEX_OUTAGES says how many (default 1). */
let outageTurns = 0;
/** While the file FAKE_CODEX_QUOTA_FILE exists, the ChatGPT quota is used up: turns fail and the rate limits say so (C11). */
const quotaExhausted = () => Boolean(process.env.FAKE_CODEX_QUOTA_FILE && existsSync(process.env.FAKE_CODEX_QUOTA_FILE));
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let threads = 0;
const toolServers = new Map();
// The permission profiles each thread received (issue #206): turns resolve their profile here, as Codex does.
const threadProfiles = new Map();
const profileRoots = (threadId, id) => {
  const profile = id ? threadProfiles.get(threadId)?.config?.[`permissions.${id}`] : null;
  return profile ? Object.entries(profile.filesystem ?? {}).filter(([path]) => path.startsWith("/")) : null;
};
// The folder a turn may write: from its permission profile, or from the older sandbox policy.
const writableRootOf = (params) => {
  const roots = profileRoots(params.threadId, params.permissions ?? threadProfiles.get(params.threadId)?.permissions);
  if (roots) return roots.find(([, access]) => access === "write")?.[0] ?? null;
  return params.sandboxPolicy?.type === "workspaceWrite" ? params.sandboxPolicy.writableRoots[0] : null;
};
// Like Codex's sandbox: without a profile a read-only turn reads the whole disk; with one only its folders.
const readableIn = (params, path) => {
  const roots = profileRoots(params.threadId, params.permissions ?? threadProfiles.get(params.threadId)?.permissions);
  return !roots || roots.some(([root, access]) => access !== "none" && (path === root || path.startsWith(`${root}/`)));
};
const referencesByThread = new Map();
const receivedByThread = new Map();
// Threads opened for "[lento:sempre]" work: the Coordinator's instructions carry the tag, so a resumed turn, whose
// prompt only says to go on, stays running until interrupted like the first one. "[lento]" work ends when resumed.
const slowThreads = new Set();
const fullThreads = new Set();
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
// Tokens the fake thread has processed so far: Codex reports them as `total`.
let processedTokens = 0;

createInterface({ input: process.stdin }).on("line", async (line) => {
  const { id, method, params } = JSON.parse(line);
  // FAKE_CODEX_LOG names a file that receives each session and turn request, so tests can read what Trama asked for.
  if (process.env.FAKE_CODEX_LOG && (method === "thread/start" || method === "thread/resume" || method === "turn/start" || method === "thread/compact/start")) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify({ method, params })}\n`);
  }
  switch (method) {
    case "initialize": {
      const result = { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" };
      // With FAKE_CODEX_INITIALIZE_GATE the process answers initialize only once the test creates that file, so a test
      // can act while Trama is still starting a Coordinator, as on a slow machine. "<gate>.held" says it is waiting.
      const gate = process.env.FAKE_CODEX_INITIALIZE_GATE;
      if (!gate) return send({ id, result });
      const { existsSync, writeFileSync } = await import("node:fs");
      writeFileSync(`${gate}.held`, "");
      const release = setInterval(() => {
        if (!existsSync(gate)) return;
        clearInterval(release);
        send({ id, result });
      }, 10);
      return;
    }
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
          ordinaryUsageAllowed: process.env.FAKE_CODEX_LIMITS !== "exhausted" && !quotaExhausted(),
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
            // With FAKE_CODEX_LIGHT_MODEL the catalogue has a light model, so the automatic work runs on a cheaper model
            // than the Coordinator's and focus mode has a stronger model to confirm serious findings (F02).
            ...(process.env.FAKE_CODEX_LIGHT_MODEL
              ? [{ id: process.env.FAKE_CODEX_LIGHT_MODEL, model: process.env.FAKE_CODEX_LIGHT_MODEL, displayName: "Modello leggero", description: "Modello economico di prova", isDefault: false, hidden: false, supportedReasoningEfforts: ["low"], defaultReasoningEffort: "low" }]
              : []),
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
      // FAKE_CODEX_FAIL_THREAD_START names a file: while it exists, one new thread fails to open and the file goes away,
      // so a test can make the Coordinator's new session fail once (ADR 0019).
      const failStart = process.env.FAKE_CODEX_FAIL_THREAD_START;
      if (failStart) {
        const { existsSync, rmSync } = await import("node:fs");
        if (existsSync(failStart)) {
          rmSync(failStart);
          return send({ id, error: { code: -32000, message: "thread/start failed: server overloaded" } });
        }
      }
      const threadId = `thread-${process.pid}-${++threads}`;
      const server = params.config?.["mcp_servers.trama"];
      if (server) toolServers.set(threadId, server);
      threadProfiles.set(threadId, { permissions: params.permissions ?? null, config: params.config ?? {} });
      if (String(params.developerInstructions ?? "").includes("[lento:sempre]")) slowThreads.add(threadId);
      // "[specialista-pieno]": a specialist's thread whose turns use most of the context window (ADR 0019).
      if (String(params.developerInstructions ?? "").includes("[specialista-pieno]")) fullThreads.add(threadId);
      return send({ id, result: { thread: { id: threadId } } });
    }
    case "turn/start": {
      // Codex 0.155 rebuilds the configuration of a turn that names a profile without the thread's `config`.
      if (params.permissions && params.permissions === threadProfiles.get(params.threadId)?.permissions) {
        return send({ id, error: { code: -32600, message: "failed to load configuration: default_permissions requires a `[permissions]` table" } });
      }
      const turnId = `turn-${++turns}`;
      const threadId = params.threadId;
      const text = params.input[0].text;
      if (quotaExhausted() || (text.includes("[rete-assente]") && outageTurns < Number(process.env.FAKE_CODEX_OUTAGES ?? 1))) {
        // The ChatGPT usage limit, or a network outage on the way to the provider (C11); both end the turn as failed.
        const quota = quotaExhausted();
        if (!quota) outageTurns += 1;
        send({ id, result: { turn: { id: turnId } } });
        const message = quota
          ? "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again later."
          : "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses): getaddrinfo ENOTFOUND chatgpt.com";
        setTimeout(() => send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error: { message } } } }), 20);
        return;
      }
      if (text.includes("[limite-temporaneo]") && rateLimitedTurns < Number(process.env.FAKE_CODEX_RATE_LIMITS ?? 1)) {
        // A provider that answers 429 with a shared upstream limit (P10), then is available again.
        rateLimitedTurns += 1;
        send({ id, result: { turn: { id: turnId } } });
        const body = {
          message: "Provider returned error",
          code: 429,
          metadata: {
            raw: "qwen/qwen3.8-27b:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
            provider_name: "Chutes",
            limit_source: "upstream_provider_shared_pool",
          },
        };
        setTimeout(
          () => send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error: { message: `429: ${JSON.stringify(body)}` } } } }),
          20,
        );
        return;
      }
      if (text.includes("[attesa]") && !process.env.FAKE_CODEX_NO_WAIT) {
        // Answers turn/start late and then keeps running until interrupted; FAKE_CODEX_NO_WAIT answers it at once.
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
      // Issue #277: the real ids Trama listed for the thread, kept for the turns that do not repeat the listing.
      if (text.includes("## Riferimenti di Trama")) {
        const listed = [...text.split("## Riferimenti di Trama")[1].matchAll(/^- (\S+)(?: \(piano [^)]+\))?: /gm)].map((m) => m[1]);
        referencesByThread.set(threadId, listed);
      }
      if (text.includes("[cita]") && toolServers.has(threadId) && !params.outputSchema) {
        // Issue #277: the Coordinator cites a candidate, its assignment and a decision by id, as the listing gave them, and
        // one id that names nothing. A planner that reads the conversation still writes its JSON. Without a listing (a Trama before issue #277), the ids written in the message.
        const listed = referencesByThread.get(threadId) ?? [...text.matchAll(/\b[ACD]-[0-9A-F]{8}\b/g)].map((m) => m[0]);
        const pick = (prefix) => listed.findLast((id) => id.startsWith(prefix)) ?? `${prefix}-NESSUNO`;
        setTimeout(() => finish(`Il candidato ${pick("C-")} viene dall'incarico ${pick("A-")} e rispetta la decisione ${pick("D-")}. Il candidato C-00000000 invece non c'è.`), 10);
        return;
      }
      if (text.includes("[ricevuti]")) {
        setTimeout(() => finish(JSON.stringify(seen)), 10);
        return;
      }
      if (text.includes("[scelte]") && !text.includes("## Scelta scritta nel testo")) {
        // Issue #228: options to pick written in the reply instead of a request_decision card.
        setTimeout(() => finish("Posso andare avanti in tre modi:\n\n1. Amplio il mandato a docs/\n2. Scrivo solo il codice\n3. Mi fermo qui\n\nRispondimi con 1, 2 o 3."), 10);
        return;
      }
      if (text.includes("[pulsante]")) {
        // Issue #269: the reply names a step button the person does not have; once Trama says so, it names none.
        const reply = text.includes("## Pulsante che non c'è") ? "Scusa: quel pulsante non c'è." : "Ora devi usare la scheda Verifica il candidato.";
        setTimeout(() => finish(reply), 10);
        return;
      }
      if (text.includes("[issue-gh]")) {
        // Issue #228: Codex tries `gh` in the read-only sandbox, which has no network; once Trama names read_issues, that one.
        if (text.includes("read_issues di Trama") && toolServers.has(threadId)) {
          const result = await callTool(threadId, "read_issues", {});
          toolDone("read_issues", result);
          setTimeout(() => finish(`trama: ${result.content[0].text}`), 10);
          return;
        }
        const command = "/bin/bash -lc 'gh issue list'";
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "gh", type: "commandExecution", command, exitCode: 1, status: "failed", aggregatedOutput: "error connecting to api.github.com" } } });
        setTimeout(() => finish("github"), 10);
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
      if (required.includes("confirmed") && required.includes("reason")) {
        // Focus mode (F02): the stronger model confirms a serious finding Trama could not recheck.
        const answer = { confirmed: true, reason: "Nel diff non c'è un test per l'ordine non pagato: il criterio resta scoperto." };
        setTimeout(() => finish(JSON.stringify(answer)), 10);
        return;
      }
      if (required.includes("findings") && required.includes("worst")) {
        // Focus mode (F01): one axis of code-review, named by its binding, or one of Trama's lenses (F05), named by
        // its prompt. An axis without the skill input has no method; a lens carries Trama's brief and no skill.
        const skills = params.input.filter((item) => item.type === "skill").map((item) => item.name);
        const lens = text.match(/lente di Trama "([^"]+)"/)?.[1] ?? null;
        if (!lens && !skills.includes("code-review")) {
          setTimeout(() => finish(JSON.stringify({ report: "", findings: [], worst: "" })), 10);
          return;
        }
        const fixedPoint = text.match(/Punto fisso: ([0-9a-f]+)/)?.[1] ?? "?";
        const file = text.match(/File cambiati: ([^,\n]+?)(?:,|\.\n|\.$)/m)?.[1] ?? "?";
        // Each finding carries a proof of a different kind (F02): a line of a changed file Trama can reread, a
        // reproduction only a stronger model can confirm, and a command outside Trama's own checks.
        // The Standards finding quotes the first line of the changed file, as it reads in the worktree.
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        let firstLine = "";
        try {
          firstLine = readFileSync(join(params.cwd ?? "", file), "utf8").split("\n")[0].trim();
        } catch {
          firstLine = "";
        }
        const proof = (kind, fields) => ({ kind, file: "", line: 0, quote: "", command: "", steps: "", ...fields });
        // The lenses go through the same verification: a serious security finding on a line Trama rereads, a serious
        // test finding only a stronger model can confirm, and a documents finding without a proof.
        const lensAnswers = {
          Sicurezza: {
            report: `### Problemi di sicurezza\n\n- L'annullamento in \`${file}\` non controlla chi lo chiede.\n\nDiff letto con \`git diff ${fixedPoint}\`. Skill ricevute: ${skills.join(", ") || "nessuna"}.`,
            findings: [{ title: `L'annullamento in ${file} non controlla chi lo chiede`, severity: "serious", evidence: proof("fileLine", { file, line: 1, quote: firstLine }) }],
            worst: `L'annullamento in ${file} non controlla chi lo chiede`,
          },
          "Qualità dei test": {
            report: "### Test mancanti o deboli\n\n- Il ramo dell'ordine già annullato non ha un test.",
            findings: [
              {
                title: "Il ramo dell'ordine già annullato non ha un test",
                severity: "serious",
                evidence: proof("reproduction", { steps: "Annullare due volte lo stesso ordine e cercare nel diff un test che lo copra: non ce n'è." }),
              },
            ],
            worst: "Il ramo dell'ordine già annullato non ha un test",
          },
          "Documenti e codice": {
            report: "### Documenti non allineati\n\n- Il README non dice che un ordine pagato annullato va in revisione.",
            findings: [{ title: "Il README non descrive la revisione dopo l'annullamento", severity: "minor", evidence: proof("none", {}) }],
            worst: "Il README non descrive la revisione dopo l'annullamento",
          },
        };
        const answer = lens
          ? (lensAnswers[lens] ?? { report: "", findings: [], worst: "" })
          : text.includes("You are the Spec sub-agent")
          ? {
              report: `### Requisiti mancanti o parziali\n\n- Il criterio \"Un ordine non pagato si annulla come prima\" non ha un test nel diff.\n- Il messaggio di annullamento non cita la revisione.\n\n### Fuori perimetro\n\nNessuno.\n\nFonte: ${text.match(/Spec, fonte: ([^(]+)/)?.[1]?.trim() ?? "?"}. Skill ricevute: ${skills.join(", ")}.`,
              findings: [
                {
                  title: "Il criterio sull'ordine non pagato non ha un test",
                  severity: "serious",
                  evidence: proof("reproduction", { steps: "Annullare un ordine non pagato e cercare nel diff un test che lo copra: non ce n'è." }),
                },
                { title: "Il messaggio di annullamento non cita la revisione", severity: "minor", evidence: proof("command", { command: "make check" }) },
              ],
              worst: "Il criterio sull'ordine non pagato non ha un test",
            }
          : {
              report: `### Violazioni documentate\n\nNessuna.\n\n### Smell (giudizio)\n\n- Possibile Mysterious Name in \`${file}\`.\n\nDiff letto con \`git diff ${fixedPoint}\`. Skill ricevute: ${skills.join(", ")}.`,
              findings: [{ title: `Possibile Mysterious Name in ${file}`, severity: "minor", evidence: proof("fileLine", { file, line: 1, quote: firstLine }) }],
              worst: `Possibile Mysterious Name in ${file}`,
            };
        // With FAKE_CODEX_AUDIT_GATE the axis answers only once the test creates that file, so a test can hold both
        // sessions open at once and act while an examination is still running, without relying on timing.
        const gate = process.env.FAKE_CODEX_AUDIT_GATE;
        if (gate) {
          const { existsSync } = await import("node:fs");
          const release = setInterval(() => {
            if (!existsSync(gate)) return;
            clearInterval(release);
            finish(JSON.stringify(answer));
          }, 10);
          return;
        }
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
        // FAKE_CODEX_MEMORY_PROBE replays the live proof of issue #206: before the review, Clean Code greps Codex's
        // global memory for the project. The file is read only when the thread's sandbox lets it.
        let memory = "";
        if (process.env.FAKE_CODEX_MEMORY_PROBE) {
          const { join } = await import("node:path");
          const { homedir } = await import("node:os");
          const { readFileSync } = await import("node:fs");
          const file = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "memories", "MEMORY.md");
          const command = `/bin/bash -lc 'rg -n -i "ordini|improve-codebase-architecture|architecture review" ${file}'`;
          let output = `rg: ${file}: No such file or directory (os error 2)\n`;
          let exitCode = 2;
          if (readableIn(params, file)) {
            try {
              output = readFileSync(file, "utf8");
              exitCode = 0;
              memory = ` Memoria letta: ${output.trim()}`;
            } catch {
              // No memory file: rg fails as above.
            }
          }
          send({ method: "item/completed", params: { threadId, turnId, item: { id: "rg-memory", type: "commandExecution", command, exitCode, status: exitCode === 0 ? "completed" : "failed", aggregatedOutput: output } } });
        }
        const candidate = (title, strength) => ({
          title,
          files: ["Sources/Orders/CancelPaidOrder.swift"],
          problem: "L'interfaccia è complessa quasi quanto l'implementazione",
          solution: "Un modulo profondo dietro un'interfaccia piccola",
          benefits: "Più località, test sull'interfaccia",
          strength,
          adrConflict: "",
        });
        const answer = { candidates: [candidate("Approfondire l'annullamento", "Strong"), candidate("Unire i pagamenti", "Speculative")], topRecommendation: `${seen.some((item) => item.startsWith("skill:improve-codebase-architecture:") && item.endsWith("/improve-codebase-architecture/SKILL.md")) ? "Partire dall'annullamento: tocca un solo modulo." : `Skill mancante: ${seen.join(", ") || "nessuna"}.`}${memory}` };
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
      if (required.includes("report") && required.includes("findings") && !required.includes("worst")) {
        // The candidate gate (W10): one reviewer per session, named in the turn. Performance blocks a note marked
        // "[rilievo-bloccante]"; the others sign nothing to report. The skill inputs the session received go in the report.
        const role = text.match(/Cancello del candidato C-[0-9A-F]+, revisore: ([^(]+?) \(/)?.[1] ?? "?";
        const skills = params.input.filter((item) => item.type === "skill").map((item) => item.name);
        const blocking = role === "Prestazioni" && /^\+.*\[rilievo-bloccante\]/m.test(text);
        const answer = blocking
          ? {
              report: `### Prestazioni\n\n- \`NOTE.md\` chiede un ciclo senza limite.\n\nSkill ricevute: ${skills.join(", ") || "nessuna"}.`,
              findings: [{ severity: "blocking", title: "Ciclo senza limite in NOTE.md", detail: "La nota chiede di rileggere tutti gli ordini a ogni richiesta.", file: "NOTE.md:2" }],
            }
          : { report: `Revisore ${role}. Skill ricevute: ${skills.join(", ") || "nessuna"}.`, findings: [] };
        // With FAKE_CODEX_GATE_HOLD the reviewer answers only once that file exists: a test sees every session open at once.
        const hold = process.env.FAKE_CODEX_GATE_HOLD;
        if (hold) {
          const { existsSync } = await import("node:fs");
          const release = setInterval(() => {
            if (!existsSync(hold)) return;
            clearInterval(release);
            finish(JSON.stringify(answer));
          }, 10);
          return;
        }
        setTimeout(() => finish(JSON.stringify(answer)), 10);
        return;
      }
      if (params.outputSchema) {
        const verdict = text.includes("RIFIUTA") ? "changesRequested" : "approved";
        // The technical review against Trama's Clean Code standard (Q03) answers with findings, file and line.
        const findings = text.includes("Misure deterministiche di Trama")
          ? [{ severity: "suggestion", rule: "kiss", file: "NOTE.md", line: 1, message: "La nota può dire in una riga sola cosa documenta." }]
          : [];
        setTimeout(() => finish(JSON.stringify({ verdict, summary: "Il diff rispetta le decisioni indicate.", findings })), 10);
        return;
      }
      if (writableRootOf(params)) {
        // A specialist with its own worktree: write one file there, as Codex would.
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const root = writableRootOf(params);
        if (text.includes("## Trama binding for the domain-modeling skill")) {
          // The documentation and domain role (M03): copy the proposed glossary block into CONTEXT.md.
          const glossary = text.match(/sotto `## Language`:\n\n```md\n([\s\S]*?)\n```/)?.[1] ?? "";
          writeFileSync(join(root, "CONTEXT.md"), `# Negozio\n\nGli ordini del negozio.\n\n## Language\n\n${glossary}\n`);
          send({ method: "item/completed", params: { threadId, turnId, item: { id: "fc", type: "fileChange", status: "completed", changes: [{ path: "CONTEXT.md" }] } } });
          setTimeout(() => finish(`Ho scritto CONTEXT.md nel worktree. Skill ricevute: ${seen.join(", ")}`), 30);
          return;
        }
        // "[segreto]" leaves a key in the note, which Trama's scan blocks at the candidate gate (W10); "[bloccante]" leaves
        // a line a reviewer blocks. The turn that resumes with the findings writes the note without either.
        const resumedWithFindings = text.includes("Rilievi bloccanti dei revisori");
        // With FAKE_CODEX_SECRET_FIX_HOLD the developer's fix of the secret waits for that file: a check sees the blocked
        // candidate while the developer is still at work, before Trama declares the corrected one (issue #388).
        const fixHold = process.env.FAKE_CODEX_SECRET_FIX_HOLD;
        if (resumedWithFindings && fixHold && text.includes("Segreto nel diff")) {
          const { existsSync } = await import("node:fs");
          await new Promise((resolve) => {
            const release = setInterval(() => {
              if (!existsSync(fixHold)) return;
              clearInterval(release);
              resolve();
            }, 10);
          });
        }
        const extra = resumedWithFindings ? "" : `${text.includes("[segreto]") ? "chiave: sk-prova-0123456789abcdefghij\n" : ""}${text.includes("[bloccante]") ? "Rileggi tutti gli ordini a ogni richiesta [rilievo-bloccante]\n" : ""}`;
        writeFileSync(join(root, "NOTE.md"), `Lavoro dello specialista\n${extra}`);
        // "[impostazioni]" also changes the code owners, a setting of the repository: its merge runs into a fixed ban (issue #247).
        if (text.includes("[impostazioni]")) {
          writeFileSync(join(root, "CODEOWNERS"), "* @trama-fixture\n");
        }
        // "[cancella]" also deletes a tracked file: a destructive candidate the Coordinator does not merge alone (issue #41).
        if (text.includes("[cancella]")) {
          const { rmSync } = await import("node:fs");
          rmSync(join(root, "README.md"), { force: true });
        }
        // "[interfaccia]" also changes the accent of the shop's page: a candidate that changes the interface (issue #247).
        if (text.includes("[interfaccia]")) {
          const { mkdirSync } = await import("node:fs");
          mkdirSync(join(root, "web"), { recursive: true });
          writeFileSync(join(root, "web/index.css"), ":root { --accent: #cc3300; }\n");
        }
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "fc", type: "fileChange", status: "completed", changes: [{ path: "NOTE.md" }] } } });
        // "[spazi]" leaves trailing whitespace in a tracked file, so git_diff_check fails on the candidate (V05).
        const tracked = join(root, "Sources/Orders/CancelPaidOrder.swift");
        if (text.includes("[spazi]")) {
          const { appendFileSync } = await import("node:fs");
          appendFileSync(tracked, "// Nota dello specialista   \n");
        }
        if (fullThreads.has(threadId)) {
          send({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total: { totalTokens: 230_000 }, last: { totalTokens: 230_000 }, modelContextWindow: 258_000 } } });
        }
        if (text.includes("[lento]") || slowThreads.has(threadId)) return; // stays running until interrupted
        if (text.includes("## Trama binding for the tdd skill")) {
          // The developer of a slice (M06) runs implement and tdd, and reports the confirmed seams it tested.
          const skills = params.input.filter((item) => item.type === "skill").map((item) => item.name);
          const seam = text.match(/## Seam confermati dalla persona\n1\. /) ? "\n- 1: NOTE.md" : "\n- none";
          // The answer to the developer's question reaches the resumed session (W06). It comes first: the slice
          // briefing of the resumed turn can still carry "[domanda]" when the slice itself asks for it (W08).
          const answer = text.match(/^Risposta (?:del Coordinatore|della persona[^:]*): (.*)$/m)?.[1];
          if (answer) {
            const report = `\n\nFiles touched:\n- NOTE.md\nTests written:\n- NOTE.md\nTested seams:${seam}\nDoubts:\n- none`;
            setTimeout(() => finish(`Ripreso con la risposta: ${answer}${report}`), 30);
            return;
          }
          if (text.includes("[domanda]") && toolServers.has(threadId)) {
            // W06: a doubt the spec does not answer goes to the Coordinator with ask_coordinator; the work pauses.
            const question = "Un ordine pagato con un buono va in revisione come uno pagato con la carta?";
            const asked = await callTool(threadId, "ask_coordinator", { question, context: "La spec parla solo di pagamenti con la carta" });
            toolDone("ask_coordinator", asked);
            const report = `\n\nFiles touched:\n- NOTE.md\nTests written:\n- none\nTested seams:\n- none\nDoubts:\n- Domanda al Coordinatore: ${question}`;
            setTimeout(() => finish(`Mi fermo: ho chiesto al Coordinatore. ${asked.content[0].text}${report}`), 30);
            return;
          }
          // The structured report of W05, which extends M06's tested seams.
          const report = `\n\nFiles touched:\n- NOTE.md\nTests written:\n- NOTE.md\nTested seams:${seam}\nDoubts:\n- Il rimborso manuale resta fuori da questa fetta\nStandard exceptions:\n- none`;
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
      // W06: the Coordinator answers the first developer question that waits for it, from facts or on a Pact card.
      const answerDeveloper = async (block) => {
        const id = text.match(/^- (DQ-[0-9A-F]+): [^\n]*aspetta la tua risposta/m)?.[1];
        if (!id) return "Nessuna domanda aspetta una risposta.";
        const result = block
          ? await callTool(threadId, "request_decision", {
              category: "product",
              question: "Un ordine pagato con un buono va in revisione?",
              concreteCase: "Ordine 42, pagato con un buono, annullato dal cliente",
              alternatives: [
                { behavior: "Va in revisione come gli altri", example: "L'ordine 42 va in revisione" },
                { behavior: "Il buono torna subito al cliente", example: "Il buono dell'ordine 42 torna valido" },
              ],
              blocksQuestionID: id,
            })
          : await callTool(threadId, "answer_question", {
              question: id,
              answer: "Sì: un buono è un pagamento, e la spec manda in revisione ogni ordine pagato.",
              sources: ["Sources/Orders/CancelPaidOrder.swift", "spec: Ordini pagati annullati in revisione"],
            });
        toolDone(block ? "request_decision" : "answer_question", result);
        if (result.isError) return `Rifiutato: ${result.content[0].text}`;
        return block ? `La domanda ${id} spetta alla persona: l'ho messa su una scheda del Patto.` : `Ho risposto alla domanda ${id}.`;
      };
      const developerMarker = text.match(/\[(rispondi|blocca)-dubbio\]/);
      if (developerMarker && toolServers.has(threadId)) {
        finish(await answerDeveloper(developerMarker[1] === "blocca"));
        return;
      }
      const automatic = text.match(/Mossa automatica di Trama: (\w+)/);
      if (automatic) {
        // A move Trama started by itself (W04). FAKE_CODEX_AUTOMATIC=wait keeps the turn running until interrupted,
        // =idle answers without making the move; otherwise the fake makes it like a Coordinator that follows the rules.
        const call = async (tool, args) => {
          const result = await callTool(threadId, tool, args);
          toolDone(tool, result);
          return result;
        };
        const json = (result) => JSON.parse(result.content[0].text);
        const done = [];
        // The live run of issue #204: the work that ended has "[luna]" in its objective, and the Coordinator passes the
        // assignment id to verify_candidate. With "[luna]" it tries twice and gives up, as gpt-6-luna did; with
        // "[luna-segue]" it follows what the tool answers: declare the candidate first, then verify it.
        if (automatic[1] === "verifyCandidate" && process.env.FAKE_CODEX_AUTOMATIC !== "idle") {
          const team = json(await callTool(threadId, "read_team", {}));
          const live = team.specialists.map((s) => s.assignment).find((a) => a?.status === "completed" && /\[luna(-segue)?\]/.test(a.objective));
          if (live) {
            const attempt = () => call("verify_candidate", { candidate: live.id, check: "git_status" });
            const refused = await attempt();
            const code = refused.isError ? json(refused).error.code : null;
            if (code === "candidate_not_declared" && live.objective.includes("[luna-segue]")) {
              const decision = json(await call("read_pact", {})).decisions[0];
              const { candidateID } = json(await call("declare_candidate", { assignment: live.id, decisionIDs: [decision.id] }));
              await call("verify_candidate", { candidate: candidateID, check: "git_status" });
              await call("review_candidate", { candidate: candidateID });
              finish(`Ho dichiarato e verificato il candidato ${candidateID}.`);
              return;
            }
            const again = await attempt();
            finish(`Non posso eseguire le verifiche: ${again.isError ? json(again).error.message : "nessun errore"}`);
            return;
          }
        }
        if (process.env.FAKE_CODEX_AUTOMATIC === "wait") return;
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
          } else if (automatic[1] === "decideWithDelegation") {
            // Issue #423: with the full delegation the Coordinator answers the person's questions with its recommendation
            // and gives the ok to the candidates that wait for the person, writing its doubt.
            for (const [, question, recommended] of text.matchAll(/^- (Q-[0-9A-F]{8}): .*?(?:consigliata (\d+))?\)$/gm)) {
              const decided = await call("decide_with_delegation", { question, alternative: Number(recommended ?? 0), reason: "È la risposta che consiglio", doubt: "Non so se vale anche per gli ordini pagati con un buono" });
              done.push(decided.isError ? `Rifiutato: ${decided.content[0].text}` : `Ho deciso ${question} con la tua delega.`);
            }
            for (const [, candidate] of text.matchAll(/^- (C-[0-9A-F]{8}): candidato di interfaccia/gm)) {
              const approved = await call("approve_with_delegation", { candidate, reason: "Le schermate prima e dopo sono coerenti" });
              done.push(approved.isError ? `Rifiutato: ${approved.content[0].text}` : `Ho approvato ${candidate} con la tua delega.`);
            }
          } else if (automatic[1] === "takeTicket") {
            const issue = text.match(/issue #(\d+)/)?.[1];
            const noted = await call("note_doubt", { subject: `Issue #${issue}`, choice: "Parto dal caso più semplice descritto nella issue", doubt: "La issue non dice cosa fare con gli ordini vecchi" });
            done.push(noted.isError ? `Rifiutato: ${noted.content[0].text}` : `Ho preso la issue #${issue}.`);
          } else if (automatic[1] === "answerQuestion") {
            done.push(await answerDeveloper(process.env.FAKE_CODEX_QUESTION === "block"));
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
      if (text.includes("[ticket")) {
        // [ticket] reports a partial increment on issue 42 and asks to close it (C10); [ticket:errore] reports another
        // one, for a GitHub that fails the write. Trama keeps the issue open and says what is missing or what failed.
        const failing = text.includes("[ticket:errore]");
        callTool(threadId, "update_ticket", {
          issueNumber: 42,
          summary: failing ? "La prova nell'app è fatta; manca la CI." : "Il riepilogo mostra l'annullo; mancano la prova nell'app e la CI.",
          criteria: [
            { index: 0, outcome: "partial", evidence: [], limits: failing ? "Manca la CI" : "Manca la prova nell'app" },
            { index: 1, outcome: "notMet", evidence: [] },
          ],
          openParts: ["Le verifiche passano"],
          close: true,
        }).then((result) => {
          toolDone("update_ticket", result);
          finish(result.isError ? "Non sono riuscito ad aggiornare la issue #42: il resoconto non è su GitHub." : "Ho registrato l'avanzamento sulla issue #42, che resta aperta.");
        });
        return;
      }
      if (text.includes("[memoria-piena]")) {
        // A model that keeps retrying a note too long for the memory, then pastes the first error (issue #305).
        (async () => {
          const results = [];
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const result = await callTool(threadId, "memory", { target: "memory", action: "add", content: `Nota ${attempt}: ${"dettaglio ".repeat(240)}` });
            toolDone("memory", result);
            results.push(result);
          }
          finish(`Non ho salvato la nota: ${JSON.parse(results[0].content[0].text).error}`);
        })();
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
      const delegation = text.match(/\[(delega|delega-ticket|ritira-delega):([^\]]+)\]/);
      if (delegation) {
        // [delega:<quote>], [delega-ticket:<quote>]: the person gave the full delegation (issue #423); [ritira-delega:<quote>] withdraws it.
        const [, kind, quote] = delegation;
        const tool = kind === "ritira-delega" ? "revoke_full_delegation" : "grant_full_delegation";
        callTool(threadId, tool, kind === "ritira-delega" ? { quote } : { quote, tickets: kind === "delega-ticket" }).then((result) => {
          toolDone(tool, result);
          finish(result.isError ? `Non posso: ${result.content[0].text}` : kind === "ritira-delega" ? "Ho ritirato la delega." : "Da ora faccio tutto io.");
        });
        return;
      }
      const requested = text.match(/\[richiesta:([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/);
      const confirmed = text.match(/\[conferma:([^|\]]+)\|([^\]]+)\]/);
      if (requested || confirmed) {
        // [richiesta:<command>|<quote>|<summary>]: the person asked for an action a fixed ban stops (issue #422);
        // [conferma:<actionID>|<quote>]: the person confirmed in the chat an action that waits for their yes.
        const args = requested
          ? { command: requested[1], quote: requested[2], summary: requested[3] }
          : { actionID: confirmed[1], quote: confirmed[2] };
        callTool(threadId, "run_requested_action", args).then((result) => {
          toolDone("run_requested_action", result);
          if (result.isError && !result.content[0].text.includes("\"status\"")) return finish(`Non posso farlo: ${result.content[0].text}`);
          const answer = JSON.parse(result.content[0].text);
          finish(answer.status === "waiting_for_confirmation" ? "Aspetto la tua conferma in Aspetta te; intanto vado avanti con il resto." : `Fatto: ${answer.status}.`);
        });
        return;
      }
      if (text.includes("[vietato:")) {
        // [vietato:<command>]: the model starts a command a fixed ban covers (issue #244); Trama interrupts the turn.
        const command = text.match(/\[vietato:([^\]]+)\]/)[1];
        send({ method: "item/started", params: { threadId, turnId, item: { id: "banned", type: "commandExecution", command } } });
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
      // A11: the person asks the Coordinator to merge a squad into another.
      const squadMergeMatch = text.match(/\[unisci-squadre:([^:\]]+):([^\]]+)\]/);
      if (squadMergeMatch) {
        callTool(threadId, "merge_squads", { squad: squadMergeMatch[1], into: squadMergeMatch[2] }).then((result) => {
          toolDone("merge_squads", result);
          const waiting = !result.isError && JSON.parse(result.content[0].text).status === "waiting_for_person";
          finish(
            result.isError
              ? `Rifiutato: ${result.content[0].text}`
              : waiting
                ? `Unire ${squadMergeMatch[1]} a ${squadMergeMatch[2]}: scegli chi resta nella vista Squadre.`
                : `Ho unito ${squadMergeMatch[1]} a ${squadMergeMatch[2]}.`,
          );
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
        // "[segreto]" and "[bloccante]" are work outside the plan: they never take the ready slice.
        const slice = named ? { slice: named } : text.includes("[segreto]") || text.includes("[bloccante]") ? {} : readySlice(text);
        callTool(threadId, "assign_task", {
          ...slice,
          // "[senza-contratto]" leaves out the seams and the Pact decisions: Trama refuses the assignment (W05).
          ...(text.includes("[senza-contratto]") ? { dependencies: [] } : contract(slice)),
          specialist: "Ada",
          kind: "agreedTicket",
          // "[luna]" and "[luna-segue]" mark the work whose automatic verification replays the live run of issue #204.
          objective: `${text.match(/\[luna(?:-segue)?\]/)?.[0]?.concat(" ") ?? ""}Documenta l'annullamento`,
          moduleIDs: ["Sources/Orders"],
          // "[spazi]" leaves trailing whitespace, "[correggi-spazi]" is the correction: both must pass git_diff_check (V05).
          // "[test]" also names the project's build and test suite, as for the work of a slice (M06).
          requiredChecks: text.includes("[spazi]") || text.includes("[correggi-spazi]")
            ? ["git_status", "git_diff_check"]
            : text.includes("[test]")
              ? ["git_status", "swift_build", "swift_test"]
              : text.includes("[test-node]")
                ? ["git_status", "node_test"]
                : ["git_status"],
          tools: ["edits"],
          instructions: `${text.includes("[segreto]") ? "[segreto] " : ""}${text.includes("[bloccante]") ? "[bloccante] " : ""}${text.includes("[lento]") ? "[lento] " : ""}${text.includes("[lento:sempre]") ? "[lento:sempre] " : ""}${text.includes("[specialista-pieno]") ? "[specialista-pieno] " : ""}${text.includes("[spazi]") ? "[spazi] " : ""}${text.includes("[domanda]") ? "[domanda] " : ""}${text.includes("[interfaccia]") ? "[interfaccia] " : ""}${text.includes("[impostazioni]") ? "[impostazioni] " : ""}${text.includes("[cancella]") ? "[cancella] " : ""}Scrivi una nota`,
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
      // [superato:<older>:<newer>] declares the older candidate superseded by the newer one of the same work (issue #421).
      const supersedeMatch = text.match(/\[superato:(C-[0-9A-F]+):(C-[0-9A-F]+)\]/);
      if (supersedeMatch) {
        const superseded = await callTool(threadId, "supersede_candidate", {
          candidate: supersedeMatch[1],
          newerCandidate: supersedeMatch[2],
          reason: "È una versione vecchia dello stesso lavoro, ripresa nel candidato più recente",
        });
        toolDone("supersede_candidate", superseded);
        finish(superseded.isError ? `Rifiutato: ${superseded.content[0].text}` : `Ho chiuso il candidato ${supersedeMatch[1]}: lo sostituisce ${supersedeMatch[2]}.`);
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
          // "[senza-revisione]" asks for the green light without the candidate gate (W10): Trama refuses it.
          if (!text.includes("[senza-revisione]")) {
            const reviewed = await callTool(threadId, "review_candidate", { candidate: candidateID });
            toolDone("review_candidate", reviewed);
          }
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
      if (text.includes("$ask-trama")) {
        // Ask Trama (M07): the skill picks a route and the Coordinator proposes it; "[strumento]" picks a standalone skill
        // behind a new session, "[inventata]" a skill ask-trama does not name.
        const route = text.includes("[strumento]")
          ? { path: "standalone", steps: ["prototype"], boundary: "clear" }
          : text.includes("[riassunto]")
            ? { path: "mainFlow", steps: ["to-spec", "to-tickets", "implement"], boundary: "compact" }
            : { path: "mainFlow", steps: [text.includes("[inventata]") ? "deploy" : "grill-with-docs", "prototype", "to-spec", "to-tickets", "implement", "code-review"], boundary: "continue" };
        const result = await callTool(threadId, "propose_route", {
          situation: "Gli ordini pagati annullati devono andare in revisione invece del rimborso automatico.",
          ...route,
          reason: "È un'idea da costruire in questo repository: si parte dal grilling con i documenti e si scende fino all'implementazione.",
        });
        toolDone("propose_route", result);
        finish(result.isError ? `Rifiutato: ${result.content[0].text}` : "Ti propongo il flusso principale, dal grilling all'implementazione.");
        return;
      }
      const started = text.startsWith("Studio del progetto scritto da Trama") ? null : text.match(/Avvia il percorso (AT-[0-9A-F]+)/);
      if (started && !text.includes("[grilling:")) {
        // The start message of a route (M07): a route that starts with a skill or the spec reports the skills it received,
        // a route that starts with grilling opens round 1.
        if (/Primo passo: (prototype|to-spec)/.test(text)) {
          setTimeout(() => finish(`Percorso ${started[1]} avviato. Skill ricevute: ${seen.join(", ")}`), 10);
          return;
        }
      }
      const grillingMatch = text.match(/\[grilling:(\d+)\]/) ?? (started ? [null, "1"] : null);
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
      if (process.env.FAKE_CODEX_STUDY_GATE && text.startsWith("Studio del progetto scritto da Trama")) {
        // With FAKE_CODEX_STUDY_GATE the study answers only once the test creates that file, so a test can act while
        // the Coordinator is studying (issue #205). "<gate>.held" says it is waiting.
        const gate = process.env.FAKE_CODEX_STUDY_GATE;
        const { existsSync, writeFileSync } = await import("node:fs");
        writeFileSync(`${gate}.held`, "");
        await new Promise((resolve) => {
          const release = setInterval(() => {
            if (!existsSync(gate)) return;
            clearInterval(release);
            resolve();
          }, 10);
        });
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
      if (process.env.FAKE_CODEX_STUDY_GH && text.startsWith("Studio del progetto scritto da Trama")) {
        // Issue #228: the study itself tries `gh`, which the read-only sandbox stops.
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "gh-study", type: "commandExecution", command: "gh issue list", exitCode: 1, status: "failed", aggregatedOutput: "error connecting to api.github.com" } } });
      }
      // Like Codex: `total` adds up every request of the thread and keeps growing, `last` is the request that fills the window (issue #305).
      // A study turn opens a new session: its reading is small even when the summary quotes "[pieno]" (ADR 0019).
      // 13.000 of 258.000 is 5,04%: just past the lowest threshold with the exact share (issue #272).
      const full = text.includes("[pieno]") && !text.startsWith("Studio del progetto scritto da Trama");
      processedTokens += full ? 2_300_000 : 120_000;
      const lastRequest = full ? 230_000 : text.includes("[compattato]") ? 20_000 : 13_000;
      if (text.includes("[compattato]")) {
        send({ method: "item/completed", params: { threadId, turnId, item: { id: "compaction", type: "contextCompaction" } } });
      }
      send({
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId,
          tokenUsage: {
            total: { totalTokens: processedTokens, inputTokens: processedTokens - 1_000, cachedInputTokens: processedTokens / 2, outputTokens: 1_000, reasoningOutputTokens: 200 },
            last: { totalTokens: lastRequest, inputTokens: lastRequest - 500, cachedInputTokens: lastRequest / 2, outputTokens: 500, reasoningOutputTokens: 100 },
            modelContextWindow: 258_000,
          },
        },
      });
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
    case "thread/compact/start":
      // Codex compacts the thread and says so with a notification.
      send({ id, result: {} });
      return send({ method: "thread/compacted", params: { threadId: params.threadId } });
    case "turn/interrupt":
      send({ id, result: {} });
      return send({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `unknown ${method}` } });
  }
});

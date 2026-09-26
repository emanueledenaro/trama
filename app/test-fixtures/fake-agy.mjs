#!/usr/bin/env node
// Stand-in for the Antigravity CLI (`agy`) in the UI check. It answers the health probes and, in print mode,
// calls the installed Trama capture hook the way the real CLI does (the PreToolUse command from hooks.json,
// through a shell), honors its decision and prints a stream-json answer. It never reaches a model.
// With FAKE_AGY_LOG it writes one line per call and per tool the hook denied or allowed.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const log = (line) => {
  if (process.env.FAKE_AGY_LOG) appendFileSync(process.env.FAKE_AGY_LOG, `${line}\n`);
};

if (args[0] === "--version") {
  console.log("agy 1.2.0");
  process.exit(0);
}
if (args[0] === "--help") {
  console.log("Usage: agy [options]\n  -p, --print <prompt>  Print mode\n  --model <label>       Model");
  process.exit(0);
}
if (args[0] === "models") {
  console.log("gemini-3-5-flash\tGemini 3.5 Flash (Medium)\ngemini-3-5-flash-high\tGemini 3.5 Flash (High)");
  process.exit(0);
}
if (args[0] === "plugin") {
  log(`plugin ${args.slice(1).join(" ")}`);
  process.exit(0);
}
const promptIndex = args.indexOf("-p");
if (promptIndex < 0) {
  console.error(`fake agy: ${args.join(" ")} not supported`);
  process.exit(1);
}

log(JSON.stringify({ print: true, sandbox: args.includes("--sandbox"), profile: process.env.TRAMA_ANTIGRAVITY_PROFILE ?? null }));
const hooks = JSON.parse(readFileSync(join(homedir(), ".gemini", "antigravity-cli", "plugins", "trama-capture", "hooks.json"), "utf8"))["trama-capture"];
const run = (entry, payload) =>
  spawnSync(entry.command, { shell: true, input: JSON.stringify({ conversationId: "fake-conversation", ...payload }), env: process.env, encoding: "utf8" }).stdout.trim();
run(hooks.PreInvocation[0], {});
const tool = (stepIdx, name, toolArgs) => {
  const decision = run(hooks.PreToolUse[0].hooks[0], { stepIdx, toolCall: { name, args: toolArgs } });
  log(`${decision === "{}" ? "denied" : "allowed"} ${name}`);
  if (decision !== "{}") run(hooks.PostToolUse[0].hooks[0], { stepIdx, toolCall: { name }, toolOutput: "ok" });
};
tool(1, "view_file", { AbsolutePath: join(process.cwd(), "README.md") });
tool(2, "write_to_file", { TargetFile: join(process.cwd(), "README.md"), CodeContent: "x" });
tool(3, "run_command", { CommandLine: "git status" });
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const answer = "Ho letto il progetto in sola lettura: Antigravity non ha modificato file né eseguito comandi.";
out({ event: "init", session_id: "fake" });
out({ event: "step_update", step_update: { step_index: 4, step_type: "agent_response", state: "DONE", text_delta: answer } });
run(hooks.Stop[0], {});
out({ event: "result", result: { status: "SUCCESS", response: answer } });
process.exit(0);

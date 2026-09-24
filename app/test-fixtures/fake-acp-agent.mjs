// Minimal Agent Client Protocol agent for the ACP runtime tests. It speaks ndjson JSON-RPC on
// stdio and appends every message it receives to FAKE_ACP_LOG, so tests can assert on requests.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = (entry) => {
  if (process.env.FAKE_ACP_LOG) appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify(entry)}\n`);
};
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (sessionId, value) => send({ method: "session/update", params: { sessionId, update: value } });

let nextId = 1000;
let sessions = 0;
const pendingClient = new Map();
const cancelWaiters = new Map();
let modelValue = "m1";
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: modelValue,
    options: [
      { value: "m1", name: "Model One" },
      { value: "m2", name: "Model Two" },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
    ],
  },
];

function askClient(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve) => pendingClient.set(id, resolve));
}

async function prompt(id, params) {
  const sessionId = params.sessionId;
  const text = params.prompt.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (text.includes("silent")) return;
  if (text.includes("hang")) {
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working" } });
    await new Promise((resolve) => cancelWaiters.set(sessionId, resolve));
    send({ id, result: { stopReason: "cancelled" } });
    return;
  }
  const fsWrite = /fswrite (\S+)/.exec(text);
  if (fsWrite) {
    const answer = await askClient("fs/write_text_file", { sessionId, path: fsWrite[1], content: "scritto" });
    const reply = answer.error ? `refused: ${answer.error.message}` : "written";
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } });
    send({ id, result: { stopReason: "end_turn" } });
    return;
  }
  const write = /write (\S+)/.exec(text);
  if (write) {
    const toolCall = { toolCallId: "edit-1", title: "Edit file", kind: "edit", status: "pending", locations: [{ path: write[1] }] };
    update(sessionId, { sessionUpdate: "tool_call", ...toolCall });
    const answer = await askClient("session/request_permission", {
      sessionId,
      toolCall,
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    });
    const allowed = answer.result?.outcome?.outcome === "selected" && answer.result.outcome.optionId === "yes";
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "edit-1", status: allowed ? "completed" : "failed" });
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: allowed ? "allowed" : "rejected" } });
    send({ id, result: { stopReason: "end_turn" } });
    return;
  }
  const images = params.prompt.filter((b) => b.type === "image").length;
  update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Penso " } });
  update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "al da farsi." } });
  update(sessionId, { sessionUpdate: "agent_message_chunk", messageId: "msg-1", content: { type: "text", text: "Ho ricevuto: " } });
  update(sessionId, { sessionUpdate: "tool_call", toolCallId: "cmd-1", title: "Terminal", kind: "execute", status: "in_progress", rawInput: { command: "git status --short" } });
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: "cmd-1",
    status: "completed",
    rawOutput: { exitCode: 0, stdout: "M file.ts" },
  });
  update(sessionId, { sessionUpdate: "agent_message_chunk", messageId: "msg-1", content: { type: "text", text: `${params.prompt.at(-1 - images).text.split("\n")[0]}` } });
  update(sessionId, { sessionUpdate: "usage_update", used: 1234, size: 200000 });
  send({ id, result: { stopReason: "end_turn" } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log(message);
  const { id, method, params } = message;
  if (method === undefined && pendingClient.has(id)) {
    pendingClient.get(id)(message);
    pendingClient.delete(id);
    return;
  }
  switch (method) {
    case "initialize":
      send({
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true },
            mcpCapabilities: { http: process.env.FAKE_ACP_NO_HTTP ? false : true },
          },
          authMethods: [{ id: "cursor_login", name: "Login" }],
        },
      });
      return;
    case "authenticate":
      send({ id, result: {} });
      return;
    case "session/new":
      sessions += 1;
      send({ id, result: { sessionId: `session-${sessions}`, configOptions: configOptions() } });
      return;
    case "session/load":
      if (params.sessionId !== "known") {
        send({ id, error: { code: -32002, message: "Session not found" } });
        return;
      }
      update("known", { sessionUpdate: "user_message_chunk", content: { type: "text", text: "old question" } });
      update("known", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "old answer" } });
      send({ id, result: { configOptions: configOptions() } });
      return;
    case "session/set_config_option":
      if (params.configId === "model") modelValue = params.value;
      send({ id, result: { configOptions: configOptions() } });
      return;
    case "session/prompt":
      void prompt(id, params);
      return;
    case "session/cancel":
      cancelWaiters.get(params.sessionId)?.();
      return;
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});

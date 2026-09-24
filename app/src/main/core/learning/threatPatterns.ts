/**
 * Prompt-injection, promptware and exfiltration patterns, ported from Hermes Agent
 * `tools/threat_patterns.py` (revision 58c896e, MIT, Copyright (c) 2025 Nous Research). Memory and
 * skills re-enter every future prompt, so a poisoned entry would persist: writes are scanned with the
 * strict scope, which includes every pattern.
 */

export const MAX_SCAN_CHARS = 65_536;
const W = "[\\p{L}\\p{N}_]";
const FILLER = `(?:${W}+\\s+){0,8}`;
const SECRET_VAR = `\\$\\{?${W}*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?(?!${W})`;
const MODIFY = "(update|modify|edit|write|change|append|add\\s+to)\\s+[^\\n]{0,2048}";

type Scope = "all" | "context" | "strict";

const PATTERNS: [string, string, Scope][] = [
  [`ignore\\s+${FILLER}(previous|all|above|prior)\\s+${FILLER}instructions`, "prompt_injection", "all"],
  ["system\\s+prompt\\s+override", "sys_prompt_override", "all"],
  [`disregard\\s+${FILLER}(your|all|any)\\s+${FILLER}(instructions|rules|guidelines)`, "disregard_rules", "all"],
  [`act\\s+as\\s+(if|though)\\s+${FILLER}you\\s+${FILLER}(have\\s+no|don't\\s+have)\\s+${FILLER}(restrictions|limits|rules)`, "bypass_restrictions", "all"],
  ["<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->", "html_comment_injection", "all"],
  [`<\\s*div\\s+style\\s*=\\s*["'][^>]{0,2048}display\\s*:\\s*none`, "hidden_div", "all"],
  [`translate\\s+[^\\n]{0,512}\\s+into\\s+${W}+(?:[\\s-]+${W}+){0,2}\\s+and\\s+(execute|run|eval)(?!${W})`, "translate_execute", "all"],
  [`do\\s+not\\s+${FILLER}tell\\s+${FILLER}the\\s+user`, "deception_hide", "all"],
  [`you\\s+are\\s+${FILLER}now\\s+(?:a|an|the)\\s+`, "role_hijack", "context"],
  [`pretend\\s+${FILLER}(you\\s+are|to\\s+be)\\s+`, "role_pretend", "context"],
  [`output\\s+${FILLER}(system|initial)\\s+prompt`, "leak_system_prompt", "context"],
  [`(respond|answer|reply)\\s+without\\s+${FILLER}(restrictions|limitations|filters|safety)`, "remove_filters", "context"],
  [`you\\s+have\\s+been\\s+${FILLER}(updated|upgraded|patched)\\s+to`, "fake_update", "context"],
  [`(?<!${W})name\\s+yourself\\s+${W}+`, "identity_override", "context"],
  ["register\\s+(as\\s+)?a?\\s*node", "c2_node_registration", "context"],
  ["(heartbeat|beacon|check[\\s\\-]?in)\\s+(to|with)\\s+", "c2_heartbeat", "context"],
  [`pull\\s+(down\\s+)?(?:new\\s+)?task(?:ing|s)?(?!${W})`, "c2_task_pull", "context"],
  [`connect\\s+to\\s+the\\s+network(?!${W})`, "c2_network_connect", "context"],
  [`you\\s+must\\s+(?:${W}+\\s+){0,3}(register|connect|report|beacon)(?!${W})`, "forced_action", "context"],
  [`only\\s+use\\s+one[\\s\\-]?liners?(?!${W})`, "anti_forensic_oneliner", "context"],
  [`never\\s+${FILLER}(?:create|write)\\s+${FILLER}(?:script|file)\\s+${FILLER}disk`, "anti_forensic_disk", "context"],
  [`unset\\s+${W}*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)${W}*`, "env_var_unset_agent", "context"],
  [`(?<!${W})(?:cobalt\\s*strike|sliver|havoc|mythic|metasploit|brainworm)(?!${W})`, "known_c2_framework", "context"],
  [`(?<!${W})c2\\s+(?:server|channel|infrastructure|beacon)(?!${W})`, "c2_explicit", "context"],
  [`(?<!${W})command\\s+and\\s+control(?!${W})`, "c2_explicit_long", "context"],
  [`curl\\s+[^\\n]{0,2048}${SECRET_VAR}`, "exfil_curl", "all"],
  [`wget\\s+[^\\n]{0,2048}${SECRET_VAR}`, "exfil_wget", "all"],
  ["cat\\s+[^\\n]{0,2048}(\\.env|credentials|\\.netrc|\\.pgpass|\\.npmrc|\\.pypirc)", "read_secrets", "all"],
  ["(send|post|upload|transmit)\\s+[^\\n]{0,2048}\\s+(to|at)\\s+https?://", "send_to_url", "strict"],
  [`(include|output|print|share)\\s+${FILLER}(conversation|chat\\s+history|previous\\s+messages|full\\s+context|entire\\s+context)`, "context_exfil", "strict"],
  ["authorized_keys", "ssh_backdoor", "strict"],
  [
    `(?:(?<!${W})(?:echo|cat|cp|mv|dd|tee|install|printf|rsync|scp|ln|append|add|write|sed|chmod|chown|truncate|rm|touch|curl|wget|git)(?!${W})|(?<!${W})open\\s*\\(|>>?)[^\\n]{0,512}(?:\\$HOME/\\.ssh|~/\\.ssh)`,
    "ssh_access",
    "strict",
  ],
  ["\\$HOME/\\.hermes/\\.env|~/\\.hermes/\\.env", "hermes_env", "strict"],
  [`${MODIFY}(?:AGENTS\\.md|CLAUDE\\.md|\\.cursorrules|\\.clinerules)`, "agent_config_mod", "strict"],
  [`${MODIFY}\\.hermes/(config\\.yaml|SOUL\\.md)`, "hermes_config_mod", "strict"],
];

// A value that is itself an environment variable NAME (SHOUTY_SNAKE with an underscore segment) says
// where a credential lives and is not one; Hermes checks it case-sensitively inside a case-insensitive
// pattern, which JavaScript expresses here in code.
const SECRET_ASSIGNMENT = /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["']/giu;
const SECRET_VALUE = /^[A-Za-z0-9+/=_-]{20,}/;
const ENV_NAME_VALUE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+["']/;

function hardcodedSecret(text: string): boolean {
  for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
    const rest = text.slice(match.index! + match[0].length);
    if (ENV_NAME_VALUE.test(rest)) continue;
    if (SECRET_VALUE.test(rest)) return true;
  }
  return false;
}

const INVISIBLE_CHARS = [..."​‌‍⁠⁢⁣⁤﻿‪‫‬‭‮⁦⁧⁨⁩"];

const INCLUDED: Record<Scope, Scope[]> = { all: ["all"], context: ["all", "context"], strict: ["all", "context", "strict"] };
const COMPILED = PATTERNS.map(([source, id, scope]) => ({ regex: new RegExp(source, "iu"), id, scope }));

/** Pattern ids found in `content`; invisible code points come first as `invisible_unicode_U+XXXX`. */
export function scanForThreats(content: string, scope: Scope = "context"): string[] {
  if (!content) return [];
  const text = content.slice(0, MAX_SCAN_CHARS);
  const findings = INVISIBLE_CHARS.filter((c) => text.includes(c)).map((c) => `invisible_unicode_U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  const normalized = text.normalize("NFKC");
  for (const pattern of COMPILED) if (INCLUDED[scope].includes(pattern.scope) && pattern.regex.test(normalized)) findings.push(pattern.id);
  if (scope === "strict" && hardcodedSecret(normalized)) findings.push("hardcoded_secret");
  return findings;
}

/** The error for the first threat found, or null. */
export function firstThreatMessage(content: string, scope: Scope = "strict"): string | null {
  const findings = scanForThreats(content, scope);
  if (!findings.length) return null;
  const id = findings[0]!;
  if (id.startsWith("invisible_unicode_")) return `Blocked: content contains invisible unicode character ${id.replace("invisible_unicode_", "")} (possible injection).`;
  return `Blocked: content matches threat pattern '${id}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.`;
}

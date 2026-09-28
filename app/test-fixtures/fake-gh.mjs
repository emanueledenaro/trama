#!/usr/bin/env node
// Stand-in for GitHub CLI in tests and the UI check: one repository with one open issue and no pull requests.
// With FAKE_GH_TEAM a colleague who does not use Trama has one open pull request and there is one more branch,
// for the Gruppo view (G02). With FAKE_GH_MERGED_PULL the issues list also holds a merged pull request that names #7,
// as GitHub lists pull requests with the issues (issue #231).
// It never reaches GitHub; anything it does not know fails like a gh error. With FAKE_GH_LOG it writes every call,
// one JSON array per line, to that file, and it answers the issue writes Trama makes when it publishes a spec (M04)
// and its slices with their blocking links (M05). With FAKE_GH_ISSUE_BASE as well, a new issue takes the next number
// after that base and the issues list holds the issues created so far, as the Coordinator opens them for the problems
// it finds (A08); the label writes of the triage are answered.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const reply = (value) => {
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  process.exit(0);
};
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (args[0] === "auth" && args[1] === "status") reply("github.com\n  ✓ Logged in to github.com account trama-ui (keyring)\n");
if (args[0] !== "api") fail(`fake gh: ${args.join(" ")} not supported`);

const endpoint = args.slice(1).find((arg, index, list) => !arg.startsWith("-") && list[index - 1] !== "--method" && list[index - 1] !== "--jq" && list[index - 1] !== "--raw-field" && list[index - 1] !== "--field");
const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
const [path, query = ""] = (endpoint ?? "").split("?");
const firstPage = (new URLSearchParams(query).get("page") ?? "1") === "1";

if (path === "user") reply({ login: "trama-ui" });
if (path === "rate_limit") reply("5000\n");
const repository = path.match(/^repos\/([^/]+\/[^/]+)(\/.*)?$/);
if (!repository) fail(`fake gh: ${endpoint} not supported`);
const [, name, rest = ""] = repository;
/** The issues created so far, from the log, in order. */
const createdIssues = () =>
  process.env.FAKE_GH_LOG
    ? readFileSync(process.env.FAKE_GH_LOG, "utf8")
        .split("\n")
        .filter((line) => line.includes('"POST"') && line.includes('/issues"'))
        .map((line) => JSON.parse(line))
    : [];
const issueBase = process.env.FAKE_GH_ISSUE_BASE ? Number(process.env.FAKE_GH_ISSUE_BASE) : null;
const field = (call, name) =>
  call.flatMap((arg, index) => (call[index - 1] === "--raw-field" && arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []));
if (method === "POST" && rest === "/issues") {
  // With a log, each new issue takes the next number, from 7: the spec first, then its slices (M05).
  // With FAKE_GH_COUNTER and no log, each new issue takes the next number after 40, counted in that file (F04).
  const counter = process.env.FAKE_GH_LOG ? null : process.env.FAKE_GH_COUNTER;
  const counted = counter ? (existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0) + 1 : null;
  if (counter) writeFileSync(counter, String(counted));
  const created = process.env.FAKE_GH_LOG ? createdIssues().length : 1;
  const number = counted !== null ? 40 + counted : (issueBase ?? 6) + created;
  reply({ id: 1000 + number, number, html_url: `https://github.com/${name}/issues/${number}` });
}
if (method === "PATCH" && /^\/issues\/\d+$/.test(rest)) reply({});
if (method === "POST" && /^\/issues\/\d+\/dependencies\/blocked_by$/.test(rest)) reply({});
if (issueBase !== null && method === "POST" && /^\/issues\/\d+\/labels$/.test(rest)) reply([]);
if (issueBase !== null && method === "DELETE" && /^\/issues\/\d+\/labels\/[^/]+$/.test(rest)) reply([]);
if (method !== "GET") fail(`fake gh: ${method} ${endpoint} not supported`);
if (rest === "") reply({ default_branch: "main", full_name: name, private: false, permissions: { pull: true, push: false, admin: false } });
if (rest === "/issues") {
  reply(
    firstPage
      ? [
          {
            number: 7,
            title: "Il pulsante Annulla non fa niente",
            state: "open",
            body: "Nel riepilogo dell'ordine il pulsante **Annulla** non annulla l'ordine.",
            html_url: `https://github.com/${name}/issues/7`,
            user: { login: "collega" },
            labels: [{ name: "bug" }],
            updated_at: "2026-09-25T09:00:00Z",
          },
          ...(process.env.FAKE_GH_MERGED_PULL
            ? [
                {
                  number: 8,
                  title: "Annullo dal riepilogo",
                  state: "closed",
                  body: "Closes #7",
                  html_url: `https://github.com/${name}/pull/8`,
                  user: { login: "collega" },
                  labels: [],
                  updated_at: "2026-09-25T10:00:00Z",
                  pull_request: { merged_at: "2026-09-25T10:00:00Z" },
                },
              ]
            : []),
          ...(issueBase !== null
            ? createdIssues().map((call, index) => ({
                number: issueBase + index + 1,
                title: field(call, "title")[0] ?? "",
                state: "open",
                body: field(call, "body")[0] ?? "",
                html_url: `https://github.com/${name}/issues/${issueBase + index + 1}`,
                user: { login: "trama-ui" },
                labels: field(call, "labels[]").map((label) => ({ name: label })),
                updated_at: "2026-09-28T10:00:00Z",
              }))
            : []),
        ]
      : [],
  );
}
const team = Boolean(process.env.FAKE_GH_TEAM);
const branches = [
  { name: "main", commit: { sha: "0123456789abcdef0123456789abcdef01234567" } },
  ...(team
    ? [
        { name: "feature/annullo-ordini", commit: { sha: "1111111111111111111111111111111111111111" } },
        { name: "spike/vecchio-checkout", commit: { sha: "2222222222222222222222222222222222222222" } },
      ]
    : []),
];
if (rest === "/branches") reply(firstPage ? branches : []);
if (rest === "/pulls") {
  reply(
    team && firstPage
      ? [
          {
            number: 12,
            title: "Annullo degli ordini dal riepilogo",
            user: { login: "collega" },
            head: { ref: "feature/annullo-ordini", sha: "1111111111111111111111111111111111111111", repo: { full_name: name } },
            base: { ref: "main" },
            html_url: `https://github.com/${name}/pull/12`,
            draft: false,
            updated_at: new Date(Date.now() - 40 * 60_000).toISOString(),
          },
        ]
      : [],
  );
}
if (/^\/pulls\/\d+\/reviews$/.test(rest)) reply([]);
if (/^\/commits\/[0-9a-f]+\/check-runs$/.test(rest)) reply({ check_runs: [] });
fail(`fake gh: ${endpoint} not supported`);

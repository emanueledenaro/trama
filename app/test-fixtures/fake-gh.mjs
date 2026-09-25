#!/usr/bin/env node
// A stand-in for GitHub CLI in tests (M04): it answers the `gh api` calls Trama makes for a connected
// repository and writes every call, one JSON array per line, to the file named by FAKE_GH_LOG.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const answer = (value) => {
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  process.exit(0);
};
if (args[0] !== "api") {
  process.stderr.write(`fake gh: unsupported command ${args[0]}`);
  process.exit(1);
}
const withValue = new Set(["--method", "--raw-field", "--field", "--jq"]);
let endpoint = null;
for (let i = 1; i < args.length && endpoint === null; i++) {
  if (withValue.has(args[i])) i++;
  else if (!args[i].startsWith("-")) endpoint = args[i];
}
const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
const repository = /^repos\/([^/?]+\/[^/?]+)/.exec(endpoint ?? "")?.[1] ?? null;

if (endpoint === "user") answer({ login: "persona" });
if (endpoint === "rate_limit") answer("5000\n");
if (method === "POST" && repository && endpoint === `repos/${repository}/issues`) {
  answer({ number: 7, html_url: `https://github.com/${repository}/issues/7` });
}
if (method === "PATCH") answer({});
if (repository && endpoint === `repos/${repository}`) {
  answer({ full_name: repository, private: false, default_branch: "main", permissions: { pull: true, push: true, admin: false } });
}
if (method === "GET") answer([]);
process.stderr.write(`fake gh: unsupported call ${args.join(" ")}`);
process.exit(1);

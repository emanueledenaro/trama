# Security policy

## Supported versions

Trama is in alpha. Security fixes land on `main` and ship in the next release. Only the latest release and the current `main` are supported; older releases do not receive fixes.

| Version | Supported |
| --- | --- |
| latest release | yes |
| `main` | yes |
| older releases | no |

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion for a security problem.

Report it privately through GitHub: open the [Security tab](https://github.com/emanueledenaro/trama/security) of the repository and choose **Report a vulnerability**, or go straight to the [new advisory form](https://github.com/emanueledenaro/trama/security/advisories/new). Only the maintainers can read the report.

Please include:

- what an attacker can do, and under which conditions;
- the steps or a proof of concept to reproduce it;
- the version or commit, the operating system and the provider involved;
- any fix or mitigation you have in mind.

Remove tokens, credentials and private paths from logs before you attach them.

## What to expect

- We aim to acknowledge the report within 7 days.
- We will confirm whether the issue is accepted and keep you informed in the advisory while we work on a fix.
- When the fix is released, we publish the advisory and credit you, unless you prefer to stay anonymous.

These are goals, not guarantees.

## Scope

In scope: the Trama desktop app in `app/`, its IPC bridge, the local MCP tool server, the repository scanner, the check sandbox and the release workflows in this repository.

Out of scope: the provider CLIs and services Trama drives (Codex, Claude, Cursor and the others). Credentials and sign-in belong to each provider's official component, and Trama does not read or store them. Report issues in those components to their vendors.

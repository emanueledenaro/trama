import type { EventContent, ProjectMandate } from "@shared/domain";
import { runProcess } from "./process";
import { type Authorization, authorize } from "./team";

/**
 * The one path by which Trama pushes a branch to the project's remote (issue #273). A push needs a granted mandate
 * with `openPullRequest`, whoever asks for it, the person included: the mandate is the person's standing answer to
 * "may Trama publish?", and a later click does not override it silently. Every attempt, refused, failed or done,
 * reaches `onRecord` so the project keeps a visible trace of what left the machine.
 *
 * Agents never push: their sandboxes have no network and their briefing forbids it. A push command they try anyway is
 * recognised by `isGitPushCommand` and recorded as an error.
 */

type ActivityContent = Extract<EventContent, { type: "activity" }>;

export type PushRecord =
  | { outcome: "refused"; branch: string; remote: string; reason: string }
  | { outcome: "started"; branch: string; remote: string }
  | { outcome: "pushed"; branch: string; remote: string }
  | { outcome: "failed"; branch: string; remote: string; reason: string };

export class PushRefusedError extends Error {}

/** Whether the mandate lets Trama push a branch now. */
export const pushAuthorization = (mandate: ProjectMandate | null): Authorization => authorize(mandate, "openPullRequest");

/** Why the mandate stops a push, in the person's words; empty when it allows one. */
export function pushRefusal(authorization: Authorization): string {
  switch (authorization) {
    case "mandate_missing":
      return "Il progetto non ha un mandato: Trama non pubblica branch su GitHub.";
    case "mandate_revoked":
      return "Il mandato è revocato: Trama non pubblica branch su GitHub.";
    case "authorized":
      return "";
    default:
      return "Il mandato non permette di aprire pull request: Trama non pubblica branch su GitHub.";
  }
}

/**
 * Pushes `branch` from `root` to `remote` when the mandate allows it. The refusal is recorded and thrown before git
 * runs; the attempt is recorded before the push starts, so a push cut short still leaves a trace.
 */
export async function pushBranch(input: {
  root: string;
  branch: string;
  mandate: ProjectMandate | null;
  onRecord: (record: PushRecord) => void;
  remote?: string;
}): Promise<void> {
  const remote = input.remote ?? "origin";
  const reason = pushRefusal(pushAuthorization(input.mandate));
  if (reason) {
    input.onRecord({ outcome: "refused", branch: input.branch, remote, reason });
    throw new PushRefusedError(reason);
  }
  input.onRecord({ outcome: "started", branch: input.branch, remote });
  const push = await runProcess("git", ["-c", "core.hooksPath=/dev/null", "push", "-u", remote, `refs/heads/${input.branch}:refs/heads/${input.branch}`], {
    cwd: input.root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 120_000,
  });
  if (push.exitCode !== 0) {
    const detail = push.stderr.trim().split("\n").at(-1) || `uscita ${push.exitCode ?? "?"}`;
    input.onRecord({ outcome: "failed", branch: input.branch, remote, reason: detail });
    throw new Error(`git push non riuscito: ${detail}`);
  }
  input.onRecord({ outcome: "pushed", branch: input.branch, remote });
}

/** How a push record reads in the conversation: plain Italian, the branch and the remote in the detail. */
export function pushActivity(record: PushRecord): ActivityContent {
  const where = `${record.branch} su ${record.remote}`;
  switch (record.outcome) {
    case "refused":
      return { type: "activity", title: "Pubblicazione fermata dal mandato", detail: `${where}\n${record.reason}`, tone: "error" };
    case "started":
      return { type: "activity", title: "Trama sta pubblicando un branch su GitHub", detail: where, tone: "info" };
    case "pushed":
      return { type: "activity", title: "Trama ha pubblicato un branch su GitHub", detail: where, tone: "tool" };
    case "failed":
      return { type: "activity", title: "Pubblicazione del branch non riuscita", detail: `${where}\n${record.reason}`, tone: "error" };
  }
}

/** A shell command that runs `git push`, however git is invoked (`git -C dir push`, `/usr/bin/git push`, after `&&`). */
export function isGitPushCommand(command: string): boolean {
  return command
    .split(/&&|\|\||[;|\n]/)
    .some((part) => /(?:^|[\s(/'"])git(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b/.test(part));
}

/** What Trama records when an agent's command tried to push: a push outside Trama is never silent. */
export function agentPushActivity(command: string, succeeded: boolean): ActivityContent {
  return {
    type: "activity",
    title: succeeded ? "Un agente ha eseguito git push fuori da Trama" : "Un agente ha provato a pubblicare con git push",
    detail: succeeded
      ? `Richiesta: ${command}\nControlla il remoto: solo Trama pubblica, e solo con un mandato che lo permette.`
      : `Richiesta: ${command}\nIl sandbox l'ha fermato: solo Trama pubblica, e solo con un mandato che lo permette.`,
    tone: "error",
  };
}

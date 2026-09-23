import type { MandateAction } from "./domain";

export const DELEGABLE_ACTIONS: MandateAction[] = ["plan", "executeInWorktree", "openPullRequest", "integrateCandidate", "composeTeam"];

export const ACTION_LABELS: Record<MandateAction, string> = {
  plan: "Preparare piani per ticket concordati e correzioni",
  executeInWorktree: "Eseguire in un worktree separato",
  openPullRequest: "Aprire pull request",
  integrateCandidate: "Integrare candidati verificati",
  composeTeam: "Comporre il team",
};

import type { MandateAction } from "./domain";
import type { Translate } from "./i18n";

export const DELEGABLE_ACTIONS: MandateAction[] = ["plan", "executeInWorktree", "openPullRequest", "integrateCandidate", "composeTeam"];

export const actionLabel = (t: Translate, action: MandateAction): string => t(`shared.action.${action}`);

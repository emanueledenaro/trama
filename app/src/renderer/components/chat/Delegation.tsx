import { IconEye, IconMoon, IconSparkles } from "@tabler/icons-react";
import type { RecapDelegated } from "@shared/domain";
import { activeDelegation, choiceKindLabel, delegationLine } from "@shared/delegation";
import { formatDate } from "@shared/i18n";
import { Button, FilledScope } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { useLanguage, useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { ReferenceText } from "./ReferenceText";

/**
 * The full delegation (issue #423) where the person meets it: one line of the chat when they give or withdraw it, with
 * their words; its state in the Mandate view, with the way to withdraw it; the choices the Coordinator made with it,
 * with the doubts, in the recap.
 */

/** The chat line that gives or withdraws the delegation, quoting the person. */
export function DelegationLine({ delegationId, phase }: { delegationId: string | null; phase: string }) {
  const language = useLanguage();
  const delegation = useUi((s) => s.app?.project?.document.delegations?.find((d) => d.id === delegationId) ?? null);
  if (!delegation) return null;
  // The card of the grant keeps saying the grant after a withdrawal: the withdrawal has its own line.
  const shown = phase === "revoked" ? delegation : { ...delegation, revokedAt: null, revokedBy: null };
  return (
    <div className="my-2 flex min-w-0 items-center gap-2 px-1.5 py-1 text-ui" data-testid="delegation-line" data-phase={phase}>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
        {phase === "revoked" ? <IconSparkles stroke={1.8} /> : <IconMoon stroke={1.8} />}
      </span>
      <span className="min-w-0 flex-1 text-foreground">{delegationLine(shown, language)}</span>
    </div>
  );
}

/** The state of the delegation in the Mandate view, and "Ritira la delega" on the right. */
export function DelegationSection() {
  const t = useT();
  const language = useLanguage();
  const document = useUi((s) => s.app?.project?.document);
  if (!document) return null;
  const delegation = activeDelegation(document);
  const toReview = (document.delegatedChoices ?? []).filter((c) => !c.seenAt).length;
  return (
    <div className="px-4 pt-1 pb-2" data-testid="delegation-section" data-active={delegation ? "true" : "false"}>
      <p className="text-ui text-muted-foreground">
        <span className="font-medium text-foreground">{t("delegation.view.title")}</span>
        {toReview ? (
          <>
            <Sep />
            <span>{t("delegation.view.toReview", { count: toReview })}</span>
          </>
        ) : null}
      </p>
      {delegation ? (
        <div className="mt-1 space-y-1 text-ui-sm text-foreground/90">
          <p>{t("delegation.view.active", { date: formatDate(language, delegation.grantedAt) })}</p>
          {delegation.tickets ? <p>{t("delegation.view.tickets")}</p> : null}
          <p className="text-muted-foreground">{t("delegation.view.quote", { quote: delegation.request.quote })}</p>
          <p className="text-muted-foreground">{t("delegation.view.awake")}</p>
          <div className="cta-row mt-2">
            <Button size="sm" onClick={() => void act("delegation:revoke", undefined)}>
              {t("delegation.view.revoke")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-ui-sm text-muted-foreground">{t("delegation.view.none")}</p>
      )}
    </div>
  );
}

/** "Cosa ho deciso con la tua delega" in the recap: each choice with its doubt, and "Ho visto" while it is to review. */
export function DelegatedChoices({ choices }: { choices: RecapDelegated[] }) {
  const t = useT();
  const language = useLanguage();
  const records = useUi((s) => s.app?.project?.document.delegatedChoices);
  const questions = useUi((s) => s.app?.project?.document.decisionRequests);
  const setInspector = useUi((s) => s.setInspector);
  const seen = new Set((records ?? []).filter((c) => c.seenAt).map((c) => c.id));
  // Reviewing opens what the choice acts on: the Pact decision, the candidate, the goal, the issue.
  const target = (choice: RecapDelegated) => (records ?? []).find((c) => c.id === choice.id)?.targetId ?? null;
  const review = (choice: RecapDelegated): (() => void) | null => {
    const id = target(choice);
    if (!id) return null;
    switch (choice.kind) {
      case "decision": {
        const decisionId = questions?.find((q) => q.id === id)?.outcome?.decisionId;
        return decisionId ? () => setInspector({ kind: "decision", id: decisionId }) : null;
      }
      case "interfaceCandidate":
        return () => setInspector({ kind: "candidate", id });
      case "goal":
        return () => setInspector({ kind: "goal", id });
      case "ticket":
        return () => setInspector({ kind: "issue", number: Number(id) });
      default:
        return null;
    }
  };
  // One filled button for the zone (issue #338): "Ho visto" of the first choice still to review; the others are outlines.
  const firstToReview = choices.find((choice) => !seen.has(choice.id))?.id ?? null;
  return (
    <ul className="divide-y divide-[color:var(--app-surface-divider)]" data-testid="recap-delegated">
      {choices.map((choice) => (
        <li key={choice.id} className="cta-row items-start py-1.5" data-testid="recap-delegated-choice" data-seen={seen.has(choice.id) ? "true" : "false"}>
          <span className="mr-auto min-w-0 flex-1 break-words">
            <span className="text-muted-foreground">{choiceKindLabel(choice.kind, language)}</span>
            <Sep />
            <span className="text-foreground">
              <ReferenceText text={choice.subject} />
            </span>
            <span className="block text-foreground/90">
              <ReferenceText text={choice.choice} />
            </span>
            {choice.doubt ? <span className="block text-muted-foreground">{t("recap.delegated.doubt", { doubt: choice.doubt })}</span> : null}
          </span>
          {/* Opening what the choice acts on is secondary: an icon with its name. */}
          {review(choice) ? <IconButton label={t("recap.delegated.review")} icon={<IconEye />} onClick={review(choice)!} /> : null}
          {seen.has(choice.id) ? (
            <Badge tone="secondary">{t("recap.delegated.reviewed")}</Badge>
          ) : (
            <FilledScope allowed={choice.id === firstToReview}>
              <Button size="xs" onClick={() => void act("delegation:seen", { id: choice.id })}>
                {t("recap.delegated.seen")}
              </Button>
            </FilledScope>
          )}
        </li>
      ))}
    </ul>
  );
}

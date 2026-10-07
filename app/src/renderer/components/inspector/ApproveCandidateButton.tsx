import type { CandidateReport } from "@shared/domain";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { act } from "@/lib/store";
import { approveBlockedReason } from "./candidateVerdict";

/**
 * The person's approval of a candidate. While the candidate has conditions missing the button stays off and says why
 * on hover; the approval itself is decided in the main process and is the same one as before.
 */
export function ApproveCandidateButton({ candidateId, report, size }: { candidateId: string; report: CandidateReport; size?: "sm" }) {
  const t = useT();
  const reason = approveBlockedReason(t, report);
  const button = (
    <Button size={size} variant="outline" disabled={Boolean(reason)} onClick={() => void act("candidate:approve", { candidateId })}>
      {t("chat.card.candidate.approve")}
    </Button>
  );
  if (!reason) return button;
  // A disabled button gets no hover: the wrapper carries the reason, and can take the keyboard's focus.
  return (
    <Tooltip label={reason}>
      <span className="inline-flex" tabIndex={0} data-testid="candidate-approve-blocked" data-reason={reason}>
        {button}
      </span>
    </Tooltip>
  );
}

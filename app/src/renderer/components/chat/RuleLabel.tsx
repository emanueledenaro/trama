import type { CleanCodeRule } from "@shared/cleanCode";

/** A rule of the standard by its label; an acronym ("KISS") says what it stands for on hover. */
export function RuleLabel({ rule }: { rule: CleanCodeRule }) {
  if (!rule.expansion) return <>{rule.label}</>;
  return (
    <abbr title={rule.expansion} className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline" data-testid="rule-acronym">
      {rule.label}
    </abbr>
  );
}

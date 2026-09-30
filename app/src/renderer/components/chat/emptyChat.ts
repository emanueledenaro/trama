/** The one action of an empty chat: the first goal while the person confirmed none, the first message after it. */
export function emptyChatAction(goals: { status: string }[] | undefined): "firstGoal" | "write" {
  return (goals ?? []).some((g) => g.status !== "proposed") ? "write" : "firstGoal";
}

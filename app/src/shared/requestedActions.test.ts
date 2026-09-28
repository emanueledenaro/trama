import { describe, expect, it } from "vitest";
import { activityLog } from "./activity";
import type { RequestedAction } from "./domain";
import { emptyDocument } from "../main/core/document";
import { requestedActionEntries, requestedActionLine, requestedActionStatus } from "./requestedActions";
import { waitingForYou } from "./waitingForYou";

const action = (overrides: Partial<RequestedAction> = {}): RequestedAction => ({
  id: "RA-1",
  ban: "forcePush",
  command: "git push --force origin feature/x",
  summary: "Riscrivo feature/x con la versione pulita",
  request: { eventId: "E1", quote: "sistema tu la situazione al meglio", at: "2026-09-29T08:00:00.000Z" },
  requestedAt: "2026-09-29T08:01:00.000Z",
  confirmation: null,
  status: "running",
  endedAt: null,
  output: null,
  ...overrides,
});

describe("how an action the person asked for reads (issue #422)", () => {
  it("quotes the person's words in the chat line, in both languages", () => {
    expect(requestedActionLine(action())).toBe("Faccio un force push perché me l'hai chiesto: «sistema tu la situazione al meglio»");
    expect(requestedActionLine(action(), "en")).toBe("I'm doing a force push because you asked me: “sistema tu la situazione al meglio”");
    expect(requestedActionLine(action({ status: "waiting" }))).toBe(
      "Prima di fare un force push aspetto la tua conferma. Me l'hai chiesto: «sistema tu la situazione al meglio»",
    );
    expect(requestedActionLine(action({ status: "declined" }))).toMatch(/^Non faccio un force push: non l'hai confermato\./);
    expect(requestedActionStatus(action({ status: "done" }))).toBe("Fatta");
    expect(requestedActionStatus(action({ status: "waiting" }), "en")).toBe("Waiting for your confirmation");
    for (const line of [requestedActionLine(action()), requestedActionLine(action(), "en")]) expect(line).not.toMatch(/[–—]/);
  });

  it("stays in Activity with the reference to the person's message", () => {
    const [entry] = requestedActionEntries([action({ status: "done", endedAt: "2026-09-29T08:02:00.000Z" })]);
    expect(entry).toMatchObject({
      kind: "requested",
      label: "Su tua richiesta: un force push",
      outcome: "done",
      personMessage: { eventId: "E1", quote: "sistema tu la situazione al meglio" },
    });
    expect(entry!.detail).toContain("git push --force origin feature/x");
    const log = activityLog([], [], [], [], [], [], [action({ status: "failed", output: "rejected" })], "en");
    expect(log).toMatchObject([{ kind: "requested", label: "At your request: a force push", outcome: "failed" }]);
    expect(log[0]!.detail).toContain("rejected");
  });

  it("waits in Aspetta te only while the confirmation is due, without stopping the rest of the work", () => {
    const document = emptyDocument("p");
    document.requestedActions = [
      action({ id: "RA-W", status: "waiting", confirmation: { askedAt: "2026-09-29T08:01:00.000Z", confirmedAt: null, by: null, declinedAt: null } }),
      action({ id: "RA-D", status: "done" }),
      action({ id: "RA-N", status: "declined" }),
    ];
    const items = waitingForYou(document).filter((item) => item.kind === "confirmation");
    expect(items).toEqual([
      expect.objectContaining({ key: "confirmation:RA-W", label: "Conferma", title: "Un force push: Riscrivo feature/x con la versione pulita", blocks: 0 }),
    ]);
    expect(waitingForYou(document, { language: "en" }).find((item) => item.kind === "confirmation")?.label).toBe("Confirmation");
  });
});

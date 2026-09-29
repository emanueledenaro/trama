import { afterEach, describe, expect, it } from "vitest";
import type { CoordinatorRequest, ProjectDocument } from "@shared/domain";
import { setPaused } from "./continuousWork";
import { ASSIGNMENT_CRASH_NOTE, ASSIGNMENT_QUIT_NOTE, CRASH_NOTE, closingNote, emptyDocument, QUIT_NOTE } from "./document";
import { grantMandate } from "./pact";
import { setPersonLanguage } from "./personLanguage";
import { providerWaitLine, reopeningResume, stoppedByClosing, untilText } from "./resumeWork";
import { resumeInput } from "./specialistBriefing";
import { statusLine } from "./statusLine";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam, requestStop, resumeAssignment, stopOrphanedAssignments } from "./team";

const at = (minute: number) => new Date(2026, 8, 28, 10, minute);

function request(document: ProjectDocument, id: string, state: CoordinatorRequest["state"], failure: string | null = null): CoordinatorRequest {
  const value: CoordinatorRequest = {
    id,
    text: id,
    moduleId: null,
    state,
    model: "gpt-6-luna",
    effort: "medium",
    createdAt: at(document.requests.length).toISOString(),
    completedAt: null,
    failure,
  };
  document.requests.push(value);
  return value;
}

function granted(): ProjectDocument {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  return document;
}

/** Luca works on a slice, in a turn that started at 10:03. */
function working(document: ProjectDocument) {
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [{ name: "Luca", competence: "TypeScript", reason: "Il negozio è in TypeScript", moduleIds: ["Sources/Orders"] }],
  });
  confirmTeam(document, proposal.id, null, null);
  const assignment = assign(
    document,
    {
      specialist: "Luca",
      kind: "agreedTicket",
      objective: "Fetta S1",
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-6-luna",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Scrivi",
    },
    document.mandate!.version,
    null,
    at(2),
  );
  beginTurn(document, assignment.id, "turn-1", "gpt-6-luna", at(3));
  return assignment;
}

/** Esci stops Luca's turn: the stop is asked, then the interrupted turn confirms it. */
function quit(document: ProjectDocument, assignmentId: string) {
  const specialist = document.team.specialists.find((s) => s.assignments.some((a) => a.id === assignmentId))!;
  requestStop(document, specialist.id, "Trama", ASSIGNMENT_QUIT_NOTE, false, at(4));
  endTurn(document, assignmentId, null, { kind: "interrupted" }, at(4));
}

describe("reopeningResume: what the always active Coordinator takes up after a restart (issue #249)", () => {
  it("takes up the Coordinator turn that Esci or a crash ended, only the latest one", () => {
    const document = granted();
    request(document, "r1", "interrupted", QUIT_NOTE);
    expect(reopeningResume(document, true).turn).toEqual({ requestId: "r1", kind: "resume" });
    request(document, "r2", "interrupted", CRASH_NOTE);
    expect(reopeningResume(document, true).turn).toEqual({ requestId: "r2", kind: "resume" });
    // A newer message replaced the interrupted one: nothing is repeated.
    request(document, "r3", "completed");
    expect(reopeningResume(document, true).turn).toBeNull();
  });

  it("does not resume a turn the person stopped or left", () => {
    const document = granted();
    request(document, "r1", "interrupted", "Hai fermato il turno.");
    expect(reopeningResume(document, true).turn).toBeNull();
    request(document, "r2", "interrupted", "Hai lasciato il progetto mentre il Coordinatore rispondeva.");
    expect(reopeningResume(document, true).turn).toBeNull();
  });

  it("waits for the end of the limit that failed the latest turn, with the time the provider gave", () => {
    const document = granted();
    request(document, "r1", "failed", "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again later.");
    expect(reopeningResume(document, true).turn).toEqual({ requestId: "r1", kind: "wait", reason: "quotaExhausted", until: null });
    const now = at(0);
    request(document, "r2", "failed", "429 Too Many Requests: rate limit reached, try again in 20 minutes");
    const turn = reopeningResume(document, true, now).turn;
    expect(turn).toMatchObject({ requestId: "r2", kind: "wait", reason: "temporaryLimit" });
    expect(turn?.kind === "wait" && turn.until ? Date.parse(turn.until) - now.getTime() : null).toBe(20 * 60_000);
    // A failure that is not a limit or an outage is the person's to handle.
    request(document, "r3", "failed", "Il modello scelto non è disponibile per questo account: model not found");
    expect(reopeningResume(document, true).turn).toBeNull();
  });

  it("resumes the specialists' work Esci or a crash stopped, not the work someone stopped on purpose", () => {
    const document = granted();
    const assignment = working(document);
    quit(document, assignment.id);
    expect(reopeningResume(document, true).assignments).toEqual([assignment.id]);

    const crashed = granted();
    const other = working(crashed);
    stopOrphanedAssignments(crashed, ASSIGNMENT_CRASH_NOTE, at(5));
    expect(reopeningResume(crashed, true).assignments).toEqual([other.id]);

    const stopped = granted();
    const third = working(stopped);
    requestStop(stopped, third.specialistId, "Coordinatore", "Il lavoro non serve più.", false, at(4));
    endTurn(stopped, third.id, null, { kind: "interrupted" }, at(4));
    expect(reopeningResume(stopped, true).assignments).toEqual([]);
  });

  it("resumes nothing in Pause, without a granted mandate or with continuous work turned off", () => {
    const document = granted();
    request(document, "r1", "interrupted", QUIT_NOTE);
    quit(document, working(document).id);
    expect(reopeningResume(document, false)).toEqual({ turn: null, assignments: [] });
    setPaused(document, true, at(6).toISOString());
    expect(reopeningResume(document, true)).toEqual({ turn: null, assignments: [] });
    setPaused(document, false, at(7).toISOString());
    expect(reopeningResume(document, true).turn).not.toBeNull();

    const unmandated = emptyDocument("p");
    request(unmandated, "r1", "interrupted", QUIT_NOTE);
    expect(reopeningResume(unmandated, true)).toEqual({ turn: null, assignments: [] });
  });

  it("tells a resumed specialist to check what is done before repeating an action with effects, only in the turn after closing", () => {
    const document = granted();
    const assignment = working(document);
    quit(document, assignment.id);
    expect(stoppedByClosing(assignment)).toBe(true);
    resumeAssignment(document, assignment.id, at(8));
    expect(resumeInput(assignment)).toContain("Trama si è chiuso durante il tuo turno");
    // Once a new turn started, the closing is behind the work.
    beginTurn(document, assignment.id, "turn-2", "gpt-6-luna", at(9));
    endTurn(document, assignment.id, null, { kind: "failed", message: "errore" }, at(10));
    expect(stoppedByClosing(assignment)).toBe(false);
  });
});

describe("providerWaitLine: the status line while a provider limit holds the work (issue #249)", () => {
  const now = at(0);

  it("says what the Coordinator waits for, until when when the provider says so, and that it resumes by itself", () => {
    const until = new Date(2026, 8, 28, 15, 30).toISOString();
    expect(providerWaitLine({ provider: "ChatGPT", reason: "quotaExhausted", until }, now)).toEqual({
      text: "Aspetto che la quota di ChatGPT si sblocchi alle 15:30.",
      reason: "Fino ad allora non parte nessun turno. Poi riprendo da solo.",
    });
    expect(providerWaitLine({ provider: "ChatGPT", reason: "temporaryLimit", until }, now).text).toBe("Aspetto la fine del limite di ChatGPT, prevista alle 15:30.");
    expect(providerWaitLine({ provider: "ChatGPT", reason: "unreachable", until: null }, now).text).toBe("Aspetto che ChatGPT torni raggiungibile.");
  });

  it("does not invent a time the provider did not give, or one already past", () => {
    expect(providerWaitLine({ provider: "Claude", reason: "quotaExhausted", until: null }, now).text).toBe(
      "Aspetto che la quota di Claude si sblocchi: il provider non dice quando.",
    );
    expect(providerWaitLine({ provider: "Claude", reason: "temporaryLimit", until: at(-5).toISOString() }, now).text).toBe(
      "Aspetto la fine del limite di Claude: il provider non dice quando finisce.",
    );
  });

  it("names the day when the limit ends on another day", () => {
    expect(untilText(new Date(2026, 9, 3, 9, 5).toISOString(), now)).toBe("il 3 ottobre alle 09:05");
  });

  it("holds the status line on the wait, with the developers still at work, and without the person's button", () => {
    const document = granted();
    request(document, "r1", "failed", "You've hit your usage limit.");
    const wait = { provider: "ChatGPT", reason: "quotaExhausted" as const, until: null };
    expect(statusLine(document, null, wait, now)).toMatchObject({
      state: "blocked",
      text: "Aspetto che la quota di ChatGPT si sblocchi: il provider non dice quando.",
      action: null,
      providerWait: { provider: "ChatGPT", until: null },
    });
    working(document);
    expect(statusLine(document, null, wait, now)).toMatchObject({ state: "working", text: expect.stringContaining("Luca lavora.") });
    // In Pause the Pause says it: nothing starts anyway.
    setPaused(document, true, at(1).toISOString());
    expect(statusLine(document, null, wait, now)).toMatchObject({ paused: true, providerWait: null });
  });
});

describe("providerWaitLine in the person's language (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("says what the Coordinator waits for, and until when, in English", () => {
    setPersonLanguage("en");
    const now = at(0);
    const line = providerWaitLine({ provider: "ChatGPT", reason: "temporaryLimit", until: new Date(2026, 8, 28, 15, 30).toISOString() }, now);
    expect(line.text).toMatch(/^Waiting for the ChatGPT limit to end, expected at 03:30\sPM\.$/);
    expect(line.reason).toBe("No turn starts until then. Then I resume on my own.");
    expect(providerWaitLine({ provider: "Claude", reason: "quotaExhausted", until: null }, now).text).toBe("Waiting for the Claude quota to unlock: the provider does not say when.");
    expect(untilText(new Date(2026, 9, 3, 15, 30).toISOString(), now)).toMatch(/^on October 3 at 03:30\sPM$/);
  });
});

describe("closing notes in the person's language (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("writes the notes in English and still takes up the work after a restart", () => {
    setPersonLanguage("en");
    expect(closingNote("quit")).toBe("Trama was closed while the Coordinator was working.");
    const document = granted();
    request(document, "r1", "interrupted", closingNote("quit"));
    expect(reopeningResume(document, true).turn).toEqual({ requestId: "r1", kind: "resume" });
    request(document, "r2", "interrupted", closingNote("crash"));
    expect(reopeningResume(document, true).turn).toEqual({ requestId: "r2", kind: "resume" });
    const assignment = working(document);
    const specialist = document.team.specialists.find((s) => s.assignments.some((a) => a.id === assignment.id))!;
    requestStop(document, specialist.id, "Trama", closingNote("assignmentQuit"), false, at(4));
    endTurn(document, assignment.id, null, { kind: "interrupted" }, at(4));
    expect(stoppedByClosing(assignment)).toBe(true);
  });

  it("recognizes the Italian notes after the person switches to English", () => {
    const document = granted();
    request(document, "r1", "interrupted", QUIT_NOTE);
    const assignment = working(document);
    quit(document, assignment.id);
    setPersonLanguage("en");
    expect(reopeningResume(document, true).turn).toEqual({ requestId: "r1", kind: "resume" });
    expect(stoppedByClosing(assignment)).toBe(true);
  });
});

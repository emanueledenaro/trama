import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import type { ProviderModel } from "@shared/codex";
import type { RepositoryModule } from "@shared/repository";
import { discussionModelSetting, discussionState, discussions, minutesLeft, squadDiscussions } from "@shared/discussions";
import { teamSquads } from "@shared/squads";
import { waitingForYou } from "@shared/waitingForYou";
import { translator } from "@shared/i18n";
import {
  chairOf,
  closeOverdueDiscussions,
  decideDiscussion,
  DiscussionError,
  discussionAnswered,
  discussionModel,
  discussionPrompt,
  escalateDiscussion,
  openDiscussion,
  personWrites,
  postToDiscussion,
  readChairAnswer,
  readParticipantAnswer,
} from "./discussions";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, grantMandate, withdrawDecisionRequest } from "./pact";
import { formSquads } from "./squads";
import { completeTeam, confirmTeam, findSpecialist, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));

const module = (id: string, name: string): RepositoryModule => ({ id, name, summary: "", relativePath: id, files: [], dependencies: [], symbol: "" });
const MODULES = [module("Sources/Catalog", "Catalogo"), module("Sources/Checkout", "Checkout")];

/** A project with two squads: Ada and Carla in Catalogo, Bruno in Checkout. */
function project(): ProjectDocument {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: MODULES.map((m) => m.id), authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Ada", competence: "TypeScript", reason: "Negozio", moduleIds: ["Sources/Catalog"] },
      { name: "Bruno", competence: "TypeScript", reason: "Negozio", moduleIds: ["Sources/Checkout"] },
      { name: "Carla", competence: "TypeScript", reason: "Negozio", moduleIds: ["Sources/Catalog"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null, at(0));
  completeTeam(document.team, at(0));
  formSquads(document, MODULES, at(0));
  return document;
}

const id = (document: ProjectDocument, name: string) => findSpecialist(document, name)!.id;
const productCard = (document: ProjectDocument, now: Date) =>
  createDecisionRequest(
    document,
    {
      requestId: null,
      category: "product",
      question: "Un ordine annullato torna nel carrello?",
      concreteCase: "Ada annulla l'ordine 42 dopo il pagamento.",
      alternatives: [
        { behavior: "Torna nel carrello", example: "Il carrello di Ada ha di nuovo i due libri", consequence: null },
        { behavior: "Il carrello resta vuoto", example: "Ada riparte da zero", consequence: null },
      ],
      revisesDecisionId: null,
    },
    now,
  );

describe("discussions between agents (A12)", () => {
  it("opens a discussion with reason, participants, time box and the squad lead as chair", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "estimate", motive: "Stimare la fetta S2 del catalogo", participants: ["Ada", "Carla"] }, at(1));
    const catalog = teamSquads(document).find((s) => s.name === "Catalogo")!;
    expect(thread.kind).toBe("discussion");
    expect(thread.discussion).toMatchObject({
      reason: "estimate",
      motive: "Stimare la fetta S2 del catalogo",
      squadId: catalog.id,
      chairId: catalog.leadId,
      timeBoxMinutes: 15,
      deadline: at(16).toISOString(),
      status: "open",
      outcome: null,
    });
    // The lead joins the discussion it chairs; the Coordinator does not take part as a member.
    expect(thread.specialistIds).toEqual([id(document, "Ada"), id(document, "Carla"), catalog.leadId]);
    expect(thread.withCoordinator).toBe(false);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ author: { kind: "coordinator" }, event: { kind: "opened" } });
    expect(squadDiscussions(document, catalog.id).map((d) => d.id)).toEqual([thread.id]);
  });

  it("gives a discussion across squads to the Coordinator, and bounds the time box", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "blocker", motive: "Il checkout aspetta il prezzo del catalogo", participants: ["Ada", "Bruno"], timeBoxMinutes: 500 }, at(1));
    expect(thread.discussion.squadId).toBeNull();
    expect(thread.discussion.chairId).toBeNull();
    expect(thread.withCoordinator).toBe(true);
    expect(thread.discussion.timeBoxMinutes).toBe(60);
    expect(chairOf(thread)).toEqual({ kind: "coordinator" });
    expect(squadDiscussions(document, null).map((d) => d.id)).toEqual([thread.id]);
    const short = openDiscussion(document, { reason: "conflict", motive: "Stesso file", participants: ["Ada", "Bruno"], timeBoxMinutes: 1 }, at(1));
    expect(short.discussion.timeBoxMinutes).toBe(5);
  });

  it("refuses a discussion without a motive, with one agent or with an unknown one", () => {
    const document = project();
    expect(() => openDiscussion(document, { reason: "estimate", motive: " ", participants: ["Ada", "Carla"] })).toThrow(DiscussionError);
    expect(() => openDiscussion(document, { reason: "estimate", motive: "Stima", participants: ["Ada", "Ada"] })).toThrow(/at least two/);
    expect(() => openDiscussion(document, { reason: "estimate", motive: "Stima", participants: ["Ada", "Zeno"] })).toThrow(/Unknown specialist/);
    expect(() => openDiscussion(document, { reason: "chat" as never, motive: "Stima", participants: ["Ada", "Carla"] })).toThrow(/reason/);
  });

  it("keeps a discussion open within its time box and closes it at the deadline with the latest proposal", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "estimate", motive: "Stimare S2", participants: ["Ada", "Carla"] }, at(1));
    const model = { provider: "codex" as const, model: "gpt-6-luna" };
    postToDiscussion(document, thread.id, { kind: "specialist", specialistId: id(document, "Ada") }, "Tre giorni.", { model, proposal: "S2 vale 3 punti" }, at(2));
    postToDiscussion(document, thread.id, { kind: "specialist", specialistId: id(document, "Carla") }, "Meglio dividerla.", { model, proposal: "S2 si divide in S2a e S2b" }, at(3));
    expect(discussionState(thread, at(15).getTime())).toBe("open");
    expect(minutesLeft(thread, at(10).getTime())).toBe(6);
    expect(closeOverdueDiscussions(document, at(15))).toEqual([]);
    expect(discussionState(thread, at(16).getTime())).toBe("overdue");
    expect(closeOverdueDiscussions(document, at(16)).map((d) => d.id)).toEqual([thread.id]);
    expect(thread.discussion.status).toBe("decided");
    expect(thread.discussion.outcome).toEqual({ decision: "S2 si divide in S2a e S2b", by: { kind: "specialist", specialistId: thread.discussion.chairId }, how: "timeBox", at: at(16).toISOString() });
    expect(thread.messages.at(-1)).toMatchObject({ event: { kind: "decided", how: "timeBox" }, text: "Tempo scaduto. Decisione: S2 si divide in S2a e S2b" });
    // Each agent's message keeps the model that wrote it.
    expect(thread.messages[1]!.model).toEqual(model);
    // A closed discussion takes no more messages from the agents nor from the person, and closes only once.
    expect(() => postToDiscussion(document, thread.id, { kind: "coordinator" }, "Ancora", {}, at(17))).toThrow(/no longer open/);
    expect(() => personWrites(document, thread.id, "Ci sono anch'io", at(17))).toThrow(/chiusa/);
    expect(closeOverdueDiscussions(document, at(30))).toEqual([]);
  });

  it("closes at the deadline with the reason's fallback when nobody proposed a decision", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "blocker", motive: "Prezzo mancante", participants: ["Ada", "Bruno"] }, at(1));
    closeOverdueDiscussions(document, at(21));
    expect(thread.discussion.outcome).toMatchObject({ by: { kind: "coordinator" }, how: "timeBox" });
    expect(thread.discussion.outcome!.decision).toMatch(/^Nessuna proposta nel tempo massimo/);
  });

  it("closes with the chair's decision before the deadline", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "review", motive: "Rivedere il candidato di Ada", participants: ["Ada", "Carla"] }, at(1));
    decideDiscussion(document, thread.id, { decision: "Il candidato va bene così", by: chairOf(thread), how: "agreed" }, at(4));
    expect(thread.discussion.outcome).toMatchObject({ decision: "Il candidato va bene così", how: "agreed" });
    expect(() => decideDiscussion(document, thread.id, { decision: "Di nuovo", by: chairOf(thread), how: "agreed" }, at(5))).toThrow(/already/);
  });

  it("turns a product choice into an item of Aspetta te and waits for the person's answer, also past the time box", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "conflict", motive: "Carrello dopo l'annullo", participants: ["Ada", "Bruno"] }, at(1));
    const request = productCard(document, at(3));
    escalateDiscussion(document, thread.id, request, at(3));
    expect(request.fromDiscussion).toEqual({ threadId: thread.id });
    expect(thread.discussion).toMatchObject({ status: "waitingPerson", decisionRequestId: request.id });
    expect(thread.messages.at(-1)).toMatchObject({ event: { kind: "toPerson", decisionRequestId: request.id } });
    const item = waitingForYou(translator("it"), document).find((i) => i.targetId === request.id)!;
    expect(item).toMatchObject({ kind: "question", label: "Discussione tra agenti", title: "Un ordine annullato torna nel carrello?", blocks: 0 });
    // Neither the chair nor the time box close it between agents.
    expect(() => decideDiscussion(document, thread.id, { decision: "Torna nel carrello", by: chairOf(thread), how: "agreed" }, at(4))).toThrow(/product choice/);
    expect(closeOverdueDiscussions(document, at(59))).toEqual([]);
    expect(discussionState(thread, at(59).getTime())).toBe("waitingPerson");
    // The person may still write in it; then the answer closes it.
    personWrites(document, thread.id, "Ci penso e rispondo dalla scheda.", at(30));
    expect(thread.messages.at(-1)).toMatchObject({ author: { kind: "person" }, event: { kind: "forwarded" } });
    answerDecisionRequest(document, request.id, { alternativeIndex: 1, freeText: null }, at(40));
    expect(discussionAnswered(document, request, at(40))).toBe(thread);
    expect(thread.discussion.outcome).toMatchObject({ decision: "Il carrello resta vuoto", by: { kind: "person" }, how: "person" });
    expect(waitingForYou(translator("it"), document).some((i) => i.targetId === request.id)).toBe(false);
  });

  it("closes a discussion whose product question the person withdrew, with the reason", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "conflict", motive: "Carrello", participants: ["Ada", "Bruno"] }, at(1));
    const request = productCard(document, at(2));
    escalateDiscussion(document, thread.id, request, at(2));
    withdrawDecisionRequest(document, request.id, "Non serve più: il carrello esce dal lavoro", at(5));
    discussionAnswered(document, request, at(5));
    expect(thread.discussion.outcome).toMatchObject({ how: "withdrawn", decision: "Non serve più: il carrello esce dal lavoro" });
  });

  it("records the person's message in an open discussion and gives it to the agents at their next turn", () => {
    const document = project();
    const thread = openDiscussion(document, { reason: "estimate", motive: "Stimare S3", participants: ["Ada", "Carla"] }, at(1));
    personWrites(document, thread.id, "Tenete conto delle ferie di agosto.", at(2));
    const prompt = discussionPrompt(document, thread, { kind: "specialist", specialistId: id(document, "Carla") });
    expect(prompt).toContain("La persona (tramite il Coordinatore): Tenete conto delle ferie di agosto.");
    expect(prompt).toContain("Tu sei: Carla (sviluppatore)");
    expect(() => personWrites(document, thread.id, "   ")).toThrow(DiscussionError);
  });

  it("lists the open discussions first, then the most recent", () => {
    const document = project();
    const first = openDiscussion(document, { reason: "estimate", motive: "Uno", participants: ["Ada", "Carla"] }, at(1));
    const second = openDiscussion(document, { reason: "estimate", motive: "Due", participants: ["Ada", "Carla"] }, at(2));
    decideDiscussion(document, second.id, { decision: "Fatto", by: chairOf(second), how: "agreed" }, at(3));
    expect(discussions(document).map((d) => d.id)).toEqual([first.id, second.id]);
  });
});

describe("the model of a discussion (A12, Q17)", () => {
  const model = (id: string, displayName = id): ProviderModel => ({ id, model: id, displayName, description: "", isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: null });
  const catalog = [model("gpt-6"), model("gpt-6-luna")];

  it("uses the provider's lightest model by default and the role's when the person chose so", () => {
    expect(discussionModel(catalog, "gpt-6", "light")).toEqual({ model: "gpt-6-luna", light: true });
    expect(discussionModel(catalog, "gpt-6", "role")).toEqual({ model: "gpt-6", light: false });
    // Without a recognisable light model the role's model runs it.
    expect(discussionModel([model("gpt-6")], "gpt-6", "light")).toEqual({ model: "gpt-6", light: false });
    expect(discussionModel([], null, "light")).toBeNull();
  });

  it("reads the setting of the project, the lightest when absent", () => {
    const document = emptyDocument("p");
    expect(discussionModelSetting(document)).toBe("light");
    document.settings = { discussionModel: "role" };
    expect(discussionModelSetting(document)).toBe("role");
  });
});

describe("the turns of a discussion (A12)", () => {
  it("reads a participant's answer and a chair's decision or product question", () => {
    expect(readParticipantAnswer('{"message":"Tre giorni.","proposal":"","productChoice":false}')).toEqual({ message: "Tre giorni.", proposal: null, productChoice: false });
    expect(readChairAnswer('{"message":"Chiudo.","decision":"S2 vale 3 punti","productQuestion":"","concreteCase":"","alternatives":[]}')).toEqual({
      message: "Chiudo.",
      decision: "S2 vale 3 punti",
      product: null,
    });
    const product = readChairAnswer(
      JSON.stringify({ message: "Spetta alla persona.", decision: "", productQuestion: "Il carrello torna?", concreteCase: "", alternatives: [{ behavior: "Sì", example: "Torna" }, { behavior: "No", example: "Vuoto" }] }),
    );
    expect(product).toMatchObject({ decision: null, product: { question: "Il carrello torna?", concreteCase: "Il carrello torna?" } });
    expect(() => readChairAnswer('{"message":"Boh.","decision":"","productQuestion":"","concreteCase":"","alternatives":[]}')).toThrow(DiscussionError);
    expect(() => readParticipantAnswer("niente")).toThrow(DiscussionError);
  });
});

describe("the Coordinator's discussion tools (A12)", () => {
  const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);
  const context = (document: ProjectDocument, opened: string[]) =>
    ({
      document,
      runningRequestId: null,
      changed: () => undefined,
      addCard: () => undefined,
      decisionChanged: () => [],
      models: ["gpt-6"],
      defaultModel: "gpt-6",
      defaultProvider: "codex",
      providers: [{ id: "codex", models: ["gpt-6"] }],
      discussionOpened: (threadId: string) => void opened.push(threadId),
    }) as unknown as ToolContext;

  it("opens a discussion, reads it, and sends its product choice to the person", async () => {
    const document = project();
    const opened: string[] = [];
    const tools = context(document, opened);
    const result = parse(await runCoordinatorTool("open_discussion", { reason: "estimate", motive: "Stimare S2", participants: ["Ada", "Carla"] }, tools));
    expect(opened).toEqual([result.discussionID]);
    expect(result.chair).toBe(teamSquads(document).find((s) => s.name === "Catalogo")!.leadId);
    const listed = parse(await runCoordinatorTool("read_discussions", {}, tools));
    expect(listed.discussions).toMatchObject([{ id: result.discussionID, reason: "estimate", state: "open", participants: ["Ada", "Carla", "Capo Catalogo"] }]);
    const card = parse(
      await runCoordinatorTool(
        "request_decision",
        {
          category: "product",
          question: "Il carrello torna?",
          concreteCase: "Ada annulla l'ordine 42.",
          alternatives: [
            { behavior: "Sì", example: "Torna" },
            { behavior: "No", example: "Vuoto" },
          ],
          blocksDiscussionID: result.discussionID,
        },
        tools,
      ),
    );
    expect(card.blocksDiscussion).toBe(result.discussionID);
    const one = parse(await runCoordinatorTool("read_discussions", { discussionID: result.discussionID }, tools));
    expect(one).toMatchObject({ state: "waitingPerson", decisionRequestID: card.requestID });
    const refused = await runCoordinatorTool("decide_discussion", { discussionID: result.discussionID, decision: "Sì" }, tools);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("waiting_person");
  });

  it("closes a discussion it chairs with decide_discussion, and refuses a discussion with one agent", async () => {
    const document = project();
    const tools = context(document, []);
    const { discussionID } = parse(await runCoordinatorTool("open_discussion", { reason: "blocker", motive: "Prezzo", participants: ["Ada", "Bruno"] }, tools));
    expect(parse(await runCoordinatorTool("decide_discussion", { discussionID, decision: "Bruno usa il prezzo di listino" }, tools))).toEqual({ discussionID, status: "decided" });
    expect(discussions(document)[0]!.discussion.outcome).toMatchObject({ by: { kind: "coordinator" }, how: "agreed" });
    const refused = await runCoordinatorTool("open_discussion", { reason: "blocker", motive: "Prezzo", participants: ["Ada"] }, tools);
    expect(refused.isError).toBe(true);
  });
});

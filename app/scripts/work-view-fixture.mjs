// The records of the Lavoro view in the UI check (issue #332): a goal with its examples, a sprint of four slices with
// who works on them, a candidate with two examples tried, a found problem in the backlog, and the divergence of the
// project's branch from main. The check writes them in the saved state of a copy of the example project.
import { join } from "node:path";

const at = (day, hour) => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const GOAL = "G-5A1E0001";
const PLAN = "P-5A1E0001";

const assignment = (id, specialistId, objective, slice, status, root, head, hour) => ({
  id,
  specialistId,
  requestId: "R-5A1E0001",
  kind: "agreedTicket",
  objective,
  issueNumber: null,
  exercise: null,
  moduleIds: [],
  dependencies: [],
  model: "gpt-6-luna",
  tools: ["commands", "edits"],
  requiredChecks: ["git_status"],
  instructions: "",
  mandateVersion: 1,
  createdAt: at(28, hour),
  status,
  workspace: { sourceRoot: root, worktreeRoot: join(root, "..", `wt-${id}`), branch: `trama/${id.toLowerCase()}`, baseSHA: head },
  threadId: null,
  turns: [],
  stops: [],
  result: status === "completed" ? "Fatto." : null,
  failure: null,
  updatedAt: at(28, hour),
  lastUpdate: "",
  reportedStatus: status,
  goalId: GOAL,
  slice: { planId: PLAN, sliceId: slice },
});

const specialist = (id, name, color, tag, assignments) => ({
  id,
  name,
  competence: tag,
  reason: "",
  moduleIds: [],
  role: "developer",
  origin: "teamProposal",
  color,
  tag,
  createdAt: at(27, 9),
  status: assignments.some((a) => a.status === "running") ? "working" : "available",
  model: "gpt-6-luna",
  tools: ["commands", "edits"],
  updatedAt: at(28, 10),
  lastUpdate: "",
  removal: null,
  assignments,
});

const candidate = (id, of, head, hour, observations) => ({
  id,
  assignmentId: of.id,
  specialistId: of.specialistId,
  snapshotId: `snap-${id}`,
  baseSHA: head,
  diff: "",
  changedFiles: ["src/lib/spedizioni.ts"],
  touchedModules: [],
  requiredDecisionIds: [],
  decisionVersions: {},
  requiredChecks: ["git_status"],
  unresolvedChoices: [],
  externalEffects: [],
  declaredAt: at(28, hour),
  updatedAt: at(28, hour),
  evidence: {},
  technicalReview: null,
  clearance: null,
  humanApproval: null,
  pullRequest: null,
  goalId: GOAL,
  exampleObservations: observations.map((exampleId) => ({
    goalId: GOAL,
    exampleId,
    exampleText: EXAMPLES.find((e) => e.id === exampleId).text,
    snapshotId: `snap-${id}`,
    observed: true,
    actor: "tu",
    at: at(28, hour),
  })),
});

const EXAMPLES = [
  { id: "E-1", kind: "accepted", text: "Spedizione in Italia a 4,90 euro" },
  { id: "E-2", kind: "accepted", text: "Spedizione in Europa a 9,90 euro" },
  { id: "E-3", kind: "accepted", text: "Isole minori con il supplemento" },
  { id: "E-4", kind: "refused", text: "Ritiro in negozio con spese di spedizione" },
];

const ticket = (id, title, blockedBy, issue) => ({
  id,
  title,
  whatToBuild: title,
  acceptanceCriteria: [],
  blockedBy,
  issue: issue ? { number: issue, url: `https://github.com/trama-ui/negozio/issues/${issue}`, at: at(28, 9) } : null,
});

/** Writes the Lavoro records in `document`, the saved state of the project at `root` whose HEAD is `head`. */
export function addWorkView(document, root, head) {
  document.goals = [
    ...(document.goals ?? []),
    { id: GOAL, title: "Spedizioni e pagamenti", outcome: "Il carrello calcola le spese di spedizione per zona e accetta PayPal.", examples: EXAMPLES, status: "open", origin: "person", createdAt: at(27, 9), updatedAt: at(28, 9), decisionIds: [] },
    { id: "G-5A1E0002", title: "Resi più semplici", outcome: "Un reso si chiede da una pagina.", examples: [], status: "proposed", origin: "coordinator", createdAt: at(28, 8), updatedAt: at(28, 8), decisionIds: [] },
    { id: "G-5A1E0003", title: "Apertura controllata di MondoPet", outcome: "Il negozio apre a un gruppo di clienti.", examples: [], status: "open", origin: "person", createdAt: at(20, 9), updatedAt: at(26, 9), decisionIds: [], archivedAt: at(26, 9) },
  ];
  document.requests.push({ id: "R-5A1E0001", text: "Spedizioni e pagamenti", moduleId: null, state: "completed", model: null, effort: null, createdAt: at(28, 8), completedAt: at(28, 9), failure: null, goalId: GOAL });
  document.plans.push({
    id: PLAN,
    requestId: "R-5A1E0001",
    orderedBy: "person",
    kind: "newFeature",
    moduleIds: [],
    summary: "Spedizioni e pagamenti",
    issueNumber: null,
    status: "ready",
    proposal: null,
    slicing: {
      status: "approved",
      tickets: [
        ticket("S1", "Soglie di spedizione gratuita", [], null),
        ticket("S2", "Spese di spedizione per zona", [], null),
        ticket("S3", "Pagamento con PayPal", [], null),
        ticket("S4", "Pagina di stato dell'ordine", ["S2"], 19),
      ],
      feedback: null,
      approvedAt: at(28, 9),
      approvedBy: "coordinator",
      failure: null,
      publishFailure: null,
    },
    failure: null,
    decisionRequestIds: [],
    createdAt: at(28, 8),
    updatedAt: at(28, 9),
  });
  const elena = assignment("A-5A1E00E1", "S-ELENA", "Spese di spedizione per zona", "S2", "completed", root, head, 10);
  const paolo = assignment("A-5A1E00P1", "S-PAOLO", "Pagamento con PayPal", "S3", "paused", root, head, 10);
  const giulia = assignment("A-5A1E00G1", "S-GIULIA", "Soglie di spedizione gratuita", "S1", "completed", root, head, 9);
  document.team.specialists.push(
    specialist("S-ELENA", "Elena", "green", "Checkout", [elena]),
    specialist("S-PAOLO", "Paolo", "orange", "Pagamenti", [paolo]),
    specialist("S-GIULIA", "Giulia", "purple", "Catalogo", [giulia]),
  );
  const merged = candidate("C-5A1E00G1", giulia, head, 10, []);
  merged.pullRequest = { url: "https://github.com/trama-ui/negozio/pull/40", number: 40, branch: "trama/a-5a1e00g1", at: at(28, 10), mergedAt: at(28, 11) };
  document.candidates.push(candidate("C-5A1E00E1", elena, head, 11, ["E-1", "E-2"]), merged);
  document.problems = {
    since: at(27, 9),
    seen: [],
    items: [
      {
        id: "F-5A1E0001",
        key: "check:node_test:carrello",
        title: "Il totale del carrello ignora lo sconto",
        detail: "",
        evidence: { kind: "check", reference: "failure:1", label: "Test Node: non superati" },
        foundAt: at(28, 9),
        issue: { number: 21, url: "https://github.com/trama-ui/negozio/issues/21", at: at(28, 9), opened: true },
        issueFailure: null,
        labelsApplied: null,
        placement: { kind: "backlog", at: at(28, 9), reason: "Nessuna fetta tocca il carrello: resta nel backlog." },
      },
    ],
  };
  return document;
}

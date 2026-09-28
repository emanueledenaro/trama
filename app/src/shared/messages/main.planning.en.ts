// Temporary part of the main catalog (issue #301), merged into main.en.ts.
import type { mainPlanningIt } from "./main.planning.it";

export const mainPlanningEn: Record<keyof typeof mainPlanningIt, string> = {
  // pact.ts
  "main.pact.decisionIncomplete": "A decision needs a behavior, an example and a rationale.",
  "main.pact.mandateIncomplete": "A mandate needs at least one goal, one module and one authorized action.",
  "main.pact.noMandateToRevoke": "There is no active mandate to revoke.",
  "main.pact.revocationReasonMissing": "Give the reason for the revocation.",
  "main.pact.mandateRequestNotFound": "Mandate request {id} not found.",
  "main.pact.mandateRequestSuperseded": "Mandate request {id} was superseded by {newer}: it can no longer be granted.",
  "main.pact.newerRequest": "a newer request",
  "main.pact.mandateRequestAnswered": "Mandate request {id} already has an answer.",
  "main.pact.rejectionReasonMissing": "Say why you turn down the proposal.",
  "main.pact.questionNotFound": "Question not found.",
  "main.pact.questionAlreadyAnswered": "You already answered this question.",
  "main.pact.questionWithdrawn": "You withdrew this question: it no longer waits for an answer.",
  "main.pact.alternativeInvalid": "Invalid alternative.",
  "main.pact.decisionMissing": "Write your decision.",
  "main.pact.answerRationale": "Answer to the question: {question}",
  "main.pact.answeredNotWithdrawable": "You already answered this question: the decision stays, and you revise it with a new decision.",
  "main.pact.questionAlreadyWithdrawn": "You already withdrew this question.",
  "main.pact.withdrawalReasonMissing": "Give the reason for withdrawing it.",
  "main.pact.withdrawalGrilling":
    "I withdrew question {number} of the clarification, round {round}: \"{question}\". Reason: {reason} It no longer counts as an open question.",
  "main.pact.withdrawal": "I withdrew the question \"{question}\". Reason: {reason}",
  "main.pact.mandateGranted": "I granted the mandate (version {version}).",
  "main.pact.mandateCorrected": "I corrected the mandate: it is now at version {version}.",
  "main.pact.mandateRevoked": "I revoked the mandate.",
  "main.pact.mandateRevokedWithReason": "I revoked the mandate. Reason: {reason}",
  "main.pact.mandateRejectedKept":
    "I turned down mandate proposal {id}. The mandate in force stays at version {version}, unchanged. Reason: {reason}",
  "main.pact.mandateRejectedNone": "I turned down mandate proposal {id}. There is still no mandate. Reason: {reason}",
  "main.pact.decisionAnswered": "I answered the question \"{question}\": {value}. It is decision {id}, version {version} of the Pact.",

  // pactDemo.ts
  "main.pactDemo.approvalRequired": "Approve this exact version.",
  "main.pactDemo.runFirst": "Run the scenario first.",
  "main.pactDemo.notVerified": "The scenario is not verified.",

  // projectMandate.ts
  "main.projectMandate.reason":
    "I propose a mandate for the whole work cycle of the project: understanding, squads, spec, slices, assignment, checks and merge with the green light. You grant it once and can narrow it at any time. The fixed bans stay excluded.",
  "main.projectMandate.objective":
    "Carry the project's work cycle forward: understanding, squads, spec, slices, assignment, checks and merge with the green light.",
  "main.projectMandate.noMandateToRestrict": "There is no mandate in force to narrow.",
  "main.projectMandate.restrictionAdds": "A restriction removes modules or actions, it does not add them: to widen the mandate, correct it.",
  "main.projectMandate.restrictionEmpty": "The narrowed mandate keeps at least one module and one action: to remove everything, revoke it.",
  "main.projectMandate.restrictionNothing": "The restriction removes nothing.",
  "main.projectMandate.removedModules": "removed the modules {modules}",
  "main.projectMandate.removedActions": "removed the actions {actions}",
  "main.projectMandate.dependsOn": "{id} (depends on {dependsOn})",
  "main.projectMandate.halted":
    "I stopped {work}: the working copies stay as they were, the diff is not lost. To resume, plan again and delegate again within the narrowed mandate.",
  "main.projectMandate.nothingHalted": "No work in progress was outside the narrowed mandate.",
  "main.projectMandate.restricted":
    "I narrowed the mandate: it is now at version {version}, {parts}. {halted} It applies from your next turn: work outside the narrowed mandate does not restart, the rest goes on.",
  "main.projectMandate.refusalNotFound": "Stopped action not found.",
  "main.projectMandate.refusalTitle": "Action stopped by a fixed ban: {ban}",
  "main.projectMandate.refusalDetail": "{reason} No mandate grants it: you find it in Waiting for you.",

  // goals.ts
  "main.goals.titleMissing": "A goal needs a title.",
  "main.goals.titleTooLong": "The title is longer than {limit} characters.",
  "main.goals.outcomeMissing": "Describe the expected outcome of the goal.",
  "main.goals.outcomeTooLong": "The expected outcome is longer than {limit} characters.",
  "main.goals.exampleKind": "An example is either accepted or refused.",
  "main.goals.exampleTooLong": "An example is longer than {limit} characters.",
  "main.goals.tooManyExamples": "A goal has at most {limit} examples.",
  "main.goals.notFound": "Goal {id} not found.",
  "main.goals.statusInvalid": "Invalid goal status.",
  "main.goals.onlyCoordinatorProposes": "Only the Coordinator proposes a goal.",
  "main.goals.unknownDecisions": "Unknown decisions: {ids}.",
  "main.goals.alreadyArchived": "The goal is already archived.",
  "main.goals.workRunning": "Work on this goal is in progress: stop it or wait for it to end before archiving.",
  "main.goals.notArchived": "The goal is not archived.",
  "main.goals.hasHistory": "This goal already has a history in the chat, which stays. You can archive it.",
  "main.goals.candidateNotFound": "Candidate not found.",
  "main.goals.candidateChanged": "The candidate changed while you were looking at it: check the examples again on the current version.",
  "main.goals.candidateUnlinked": "The candidate is not linked to a goal.",
  "main.goals.exampleNotFound": "Example not found in the goal.",

  // plan.ts
  "main.plan.specIncomplete": "A spec has at least a title, a problem and a solution.",
  "main.plan.specTooLarge": "The spec is larger than the allowed size.",
  "main.plan.invalidJson": "The planner's answer is not valid JSON.",
  "main.plan.otherSnapshot": "The spec refers to another snapshot of the project.",
  "main.plan.noSeams": "The planner proposed no test points.",
  "main.plan.fieldMissing": "The planner's spec has no field {field}.",

  // slices.ts
  "main.slices.noSpec": "The plan has no spec to split into slices yet.",
  "main.slices.tooLarge": "The breakdown is larger than the allowed size.",
  "main.slices.invalidJson": "The slicer's answer is not valid JSON.",
  "main.slices.otherSnapshot": "The breakdown refers to another snapshot of the project.",
  "main.slices.noSlices": "The slicer proposed no slices.",
  "main.slices.tooMany": "The slicer proposed more than 30 slices.",
  "main.slices.sliceIncomplete": "Slice {number} has no title or behavior to deliver.",
  "main.slices.noCriteria": "Slice {number} has no acceptance criteria.",
  "main.slices.blockedByLater": "Slice {number} is blocked by {blocker}: a slice can only be blocked by slices listed before it.",

  // slicePicking.ts
  "main.slicePicking.noModules": "The slice names no modules: the Coordinator assigns it.",
  "main.slicePicking.notCovered": "The mandate does not cover the work of this slice.",
  "main.slicePicking.busy": "Waiting for {ids} to finish: it works on the same modules.",
  "main.slicePicking.occupied": "Someone is touching these modules now: {names}.",
  "main.slicePicking.noDeveloper": "No free developer covers the modules of this slice.",
  "main.slicePicking.noProvider": "No connected provider can work now.",
  "main.slicePicking.modelReason": "Slice taken independently: the same provider and model as the previous work.",

  // developerQuestions.ts
  "main.developerQuestions.asked": "Question {id} to the Coordinator",
  "main.developerQuestions.answeredFromFacts": "The Coordinator answered question {id}",
  "main.developerQuestions.waitingForPerson": "Question {id} waits for the person's answer",
  "main.developerQuestions.personDecision": "{answer} (decision {decision}, version {version} of the Pact)",
  "main.developerQuestions.personWithdrew": "The person withdrew the question without deciding. Reason: {reason}",
  "main.developerQuestions.personAnswered": "The person answered question {id}",

  // focus.ts
  "main.focus.projectWork": "Project work",
  "main.focus.notStarted": "not started",
  "main.focus.taskNotOpen": "Task {id} is not open: it is closed or does not exist.",
  "main.focus.taskAlreadyPaused": "Task {id} is already paused.",
  "main.focus.taskNotPaused": "Task {id} is not paused.",

  // candidates.ts
  "main.candidates.gateRunning": "The candidate's reviewers are at work.",
  "main.candidates.gateFailed": "A reviewer did not finish the review.",
  "main.candidates.unknown": "Unknown candidate: {id}.",
  "main.candidates.superseded": "The candidate was replaced by newer work: review the new one.",
  "main.candidates.notVerified": "The candidate is not verified: {codes}.",
};

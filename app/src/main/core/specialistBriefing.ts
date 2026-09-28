import type { PactDecision, Specialist, SpecialistAssignment } from "@shared/domain";
import { messageStyle } from "./messageStyle";
import { CHECKS, type ReadOnlyCheck } from "./checks";
import { needsWorktree } from "./team";
import { contractBriefing, REPORT_HEADINGS } from "./implementation";
import { answerBriefing, asksCoordinator } from "./developerQuestions";
import { providerToolsRule } from "./providers/toolRefusal";
import { stoppedByClosing } from "./resumeWork";

export function specialistInstructions(projectName: string, specialist: Specialist, assignment: SpecialistAssignment): string {
  const lines = [
    `You are ${specialist.name}, a specialist of the project "${projectName}" in Trama, working under its Coordinator.`,
    `Your competence: ${specialist.competence.replace(/\.$/, "")}.`,
    "Trama owns this thread and runs it for one assignment. Do the work, then answer with what you changed, what you checked and what is left.",
    needsWorktree(assignment)
      ? "You work in your own Git worktree, the working directory of this thread. Write only inside it: the project checkout, its index and every other directory are out of reach, and so is the network. Do not commit, push, or run Git commands that write."
      : "This assignment is read-only: read the project and report. Do not change files and do not use the network.",
    `Stay inside these modules: ${assignment.moduleIds.join(", ")}.`,
    "Do not start other agents and do not ask for broader permissions. If the sandbox stops you, say so in your answer instead of working around it.",
    providerToolsRule(asksCoordinator(specialist, assignment) ? "developer" : "none"),
    messageStyle("the Coordinator"),
    "Name the files you touched with their path relative to the worktree root.",
  ];
  if (asksCoordinator(specialist, assignment)) {
    lines.push(
      "When a doubt stops the work and the code, the spec, the contract and the Pact decisions do not answer it, ask the Coordinator with the ask_coordinator tool instead of guessing. Then stop and end your answer with the report: Trama resumes this session with the answer.",
    );
  }
  if (assignment.requiredChecks.length) {
    const checks = assignment.requiredChecks.map((c) => CHECKS[c as ReadOnlyCheck]?.summary ?? c);
    lines.push(`The work is done when these checks pass: ${checks.join("; ")}. Run them when you can and report their output.`);
  }
  lines.push(`Instructions from the Coordinator:\n${assignment.instructions}`);
  return lines.join("\n");
}

/** The Pact decisions the assignment relies on, at the version it is delegated against. */
function decisionLines(assignment: SpecialistAssignment, decisions: PactDecision[]): string[] {
  const relied = Object.keys(assignment.decisionVersions ?? {});
  if (!relied.length) return [];
  return [
    "Decisioni del Patto su cui si basa il lavoro:",
    ...relied.map((id) => {
      const d = decisions.find((x) => x.id === id);
      return d ? `- ${d.id} v${d.version}: ${d.value} (esempio accettato: ${d.acceptedExample})` : `- ${id}: non più nel Patto`;
    }),
  ];
}

export function openingInput(assignment: SpecialistAssignment, decisions: PactDecision[] = []): string {
  const lines = [`Incarico ${assignment.id}: ${assignment.objective}`];
  if (assignment.issueNumber) lines.push(`Issue #${assignment.issueNumber}.`);
  if (assignment.exercise) lines.push(`Esercizio: ${assignment.exercise}.`);
  lines.push(`Moduli nel perimetro: ${assignment.moduleIds.join(", ")}.`);
  if (assignment.dependencies.length) lines.push(`Dipende da lavori già conclusi: ${assignment.dependencies.join(", ")}.`);
  if (assignment.requiredChecks.length) lines.push(`Verifiche richieste: ${assignment.requiredChecks.join(", ")}.`);
  const relied = decisionLines(assignment, decisions);
  lines.push(...(relied.length || !assignment.seams ? relied : ["Decisioni del Patto su cui si basa il lavoro: nessuna."]));
  lines.push(`Istruzioni del Coordinatore:\n${assignment.instructions}`);
  lines.push("Quando hai finito, riporta le modifiche fatte, i comandi eseguiti con il loro esito e quello che resta aperto.");
  lines.push(...contractBriefing(assignment));
  return lines.join("\n");
}

export function resumeInput(assignment: SpecialistAssignment, decisions: PactDecision[] = []): string {
  const lines = [`Riprendi l'incarico ${assignment.id}: ${assignment.objective}`];
  const stop = assignment.stops.at(-1);
  if (stop?.confirmedAt) lines.push(`Il lavoro era stato fermato (${stop.reason}). Il worktree è come l'hai lasciato.`);
  // Trama closed during the turn (issue #249): its outcome is uncertain, so what is done is checked before it is repeated.
  if (stoppedByClosing(assignment)) {
    lines.push("Trama si è chiuso durante il tuo turno: parte del lavoro può essere già fatta. Prima di ripetere un'azione con effetti, controlla nel worktree cosa c'è già e non rifarlo.");
  }
  if (assignment.failure) lines.push(`Il turno precedente non è riuscito: ${assignment.failure}`);
  const relied = decisionLines(assignment, decisions);
  if (relied.length) lines.push(...relied, "Se una decisione è cambiata rispetto al lavoro fatto, adegua il lavoro alla versione attuale.");
  // The answer to the developer's question (W06) that paused the work.
  const answer = answerBriefing(assignment);
  if (answer.length) lines.push("", ...answer, "");
  // The candidate gate sent the work back (W10): the blocking findings, once, in the first turn after the return.
  const returned = gateReturnBriefing(assignment);
  if (returned.length) lines.push("", ...returned, "");
  lines.push("Continua da dove eri rimasto e riporta cosa hai fatto in questo turno.");
  if (assignment.seams) {
    const headings = Object.values(REPORT_HEADINGS).map((h) => `\`${h}\``).join(", ");
    lines.push(`Chiudi con il rapporto dell'incarico su tutto il lavoro, non solo su questo turno: ${headings}.`);
  }
  return lines.join("\n");
}

/** The blocking findings of the candidate gate (W10), for the first turn after the work came back; empty otherwise. */
export function gateReturnBriefing(assignment: SpecialistAssignment): string[] {
  const returned = assignment.gateReturn;
  if (!returned) return [];
  const last = assignment.turns.at(-1);
  if (last && last.startedAt > returned.at) return [];
  return [
    `Rilievi bloccanti dei revisori sul candidato ${returned.candidateId}: il candidato non arriva alla persona finché non li risolvi.`,
    ...returned.findings.map((f) => `- ${f}`),
    "Correggi il lavoro nel worktree, riesegui le verifiche e riporta cosa hai cambiato per ogni rilievo. Se un rilievo ti sembra sbagliato, dillo con il motivo invece di ignorarlo.",
  ];
}

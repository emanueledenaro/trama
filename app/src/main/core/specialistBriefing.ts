import type { Specialist, SpecialistAssignment } from "@shared/domain";
import { CHECKS, type ReadOnlyCheck } from "./checks";
import { needsWorktree } from "./team";

export function specialistInstructions(projectName: string, specialist: Specialist, assignment: SpecialistAssignment): string {
  const lines = [
    `You are ${specialist.name}, a specialist of the project "${projectName}" in Trama, working under its Coordinator.`,
    `Your competence: ${specialist.competence}.`,
    "Trama owns this thread and runs it for one assignment. Do the work, then answer with what you changed, what you checked and what is left.",
    needsWorktree(assignment)
      ? "You work in your own Git worktree, the working directory of this thread. Write only inside it: the project checkout, its index and every other directory are out of reach, and so is the network. Do not commit, push, or run Git commands that write."
      : "This assignment is read-only: read the project and report. Do not change files and do not use the network.",
    `Stay inside these modules: ${assignment.moduleIds.join(", ")}.`,
    "Do not start other agents and do not ask for broader permissions. If the sandbox stops you, say so in your answer instead of working around it.",
    "Write to the Coordinator in Italian, in plain prose; name the files you touched with their path relative to the worktree root.",
  ];
  if (assignment.requiredChecks.length) {
    const checks = assignment.requiredChecks.map((c) => CHECKS[c as ReadOnlyCheck]?.summary ?? c);
    lines.push(`The work is done when these checks pass: ${checks.join("; ")}. Run them when you can and report their output.`);
  }
  lines.push(`Instructions from the Coordinator:\n${assignment.instructions}`);
  return lines.join("\n");
}

export function openingInput(assignment: SpecialistAssignment): string {
  const lines = [`Incarico ${assignment.id}: ${assignment.objective}`];
  if (assignment.issueNumber) lines.push(`Issue #${assignment.issueNumber}.`);
  if (assignment.exercise) lines.push(`Esercizio: ${assignment.exercise}.`);
  lines.push(`Moduli nel perimetro: ${assignment.moduleIds.join(", ")}.`);
  if (assignment.dependencies.length) lines.push(`Dipende da lavori già conclusi: ${assignment.dependencies.join(", ")}.`);
  if (assignment.requiredChecks.length) lines.push(`Verifiche richieste: ${assignment.requiredChecks.join(", ")}.`);
  lines.push(`Istruzioni del Coordinatore:\n${assignment.instructions}`);
  lines.push("Quando hai finito, riporta le modifiche fatte, i comandi eseguiti con il loro esito e quello che resta aperto.");
  return lines.join("\n");
}

export function resumeInput(assignment: SpecialistAssignment): string {
  const lines = [`Riprendi l'incarico ${assignment.id}: ${assignment.objective}`];
  const stop = assignment.stops.at(-1);
  if (stop?.confirmedAt) lines.push(`Il lavoro era stato fermato (${stop.reason}). Il worktree è come l'hai lasciato.`);
  if (assignment.failure) lines.push(`Il turno precedente non è riuscito: ${assignment.failure}`);
  lines.push("Continua da dove eri rimasto e riporta cosa hai fatto in questo turno.");
  return lines.join("\n");
}

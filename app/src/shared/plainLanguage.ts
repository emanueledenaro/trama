/**
 * The words Trama uses with the person (issue #270): the terms of the interface in plain Italian, and the technical
 * codes and internal phrases that reach a text shown to the person, translated. docs/glossario.md lists the same
 * terms for whoever reads the documentation; a test keeps the two aligned.
 */

export interface GlossaryTerm {
  /** The word the interface shows. */
  term: string;
  /** What it means, in one or two plain sentences. */
  meaning: string;
  /** The technical or English words it replaces, which the interface does not show. */
  insteadOf: string[];
}

export const GLOSSARY: GlossaryTerm[] = [
  { term: "Coordinatore", meaning: "L'agente con cui parli. Organizza il lavoro del team e ti chiede solo le scelte che spettano a te.", insteadOf: [] },
  { term: "Sviluppatore", meaning: "Un agente del team che scrive il codice di una fetta, nella sua copia di lavoro.", insteadOf: ["specialista", "specialist"] },
  { term: "Obiettivo", meaning: "Il risultato che vuoi ottenere, con gli esempi di cosa deve e non deve succedere.", insteadOf: ["goal"] },
  { term: "Piano", meaning: "La descrizione del lavoro da fare per una richiesta, prima che il team cominci.", insteadOf: [] },
  { term: "Fetta", meaning: "Una parte del piano che si può fare, provare e unire da sola.", insteadOf: ["slice", "ticket"] },
  { term: "Incarico", meaning: "Il lavoro che il Coordinatore affida a uno sviluppatore: di solito una fetta.", insteadOf: ["assignment", "task"] },
  { term: "Candidato", meaning: "Il risultato di un incarico, pronto per le verifiche e per essere unito.", insteadOf: ["candidate"] },
  { term: "Verifiche", meaning: "I comandi di prova che Trama esegue davvero sul candidato, come i test.", insteadOf: ["check", "evidence"] },
  { term: "Revisori", meaning: "Gli agenti che leggono il candidato prima dell'unione e segnalano i problemi.", insteadOf: ["gate", "review gate"] },
  { term: "Esame approfondito", meaning: "Una lettura completa di un candidato: prima le verifiche, poi il confronto con le regole del codice e con il piano.", insteadOf: ["Focus mode", "audit"] },
  { term: "Punti di prova", meaning: "I punti del codice da cui i test controllano un comportamento senza toccare il resto.", insteadOf: ["seam"] },
  { term: "Copia di lavoro", meaning: "Una cartella separata del progetto dove uno sviluppatore lavora senza toccare la tua.", insteadOf: ["worktree"] },
  { term: "Patto Vivo", meaning: "Le decisioni che hai preso sul comportamento del prodotto, con la loro versione.", insteadOf: ["pact"] },
  { term: "Mandato", meaning: "Il permesso che dai al Coordinatore per fare da solo alcune cose.", insteadOf: ["mandate"] },
  { term: "Aspetta te", meaning: "L'elenco delle domande, proposte e permessi che aspettano una tua risposta.", insteadOf: ["pending", "waiting"] },
  { term: "Attività", meaning: "Il registro delle mosse che il Coordinatore ha fatto da solo, con l'esito.", insteadOf: ["activity log"] },
  { term: "Riepilogo", meaning: "Cosa ha fatto il Coordinatore, cosa sta facendo e cosa aspetta te.", insteadOf: ["recap"] },
  { term: "Memoria", meaning: "Le note che il Coordinatore conserva sul progetto e su di te, oltre la singola conversazione.", insteadOf: ["memory"] },
  { term: "Lavoro in primo piano", meaning: "Il lavoro su cui il progetto si concentra ora, in cima alla chat.", insteadOf: ["task in focus", "focus"] },
];

/** A candidate's blocker, by code, in the person's words. */
export const BLOCKER_TEXT: Record<string, string> = {
  BASE_CHANGED: "Il codice di partenza è cambiato",
  DECISION_CHANGED: "Una decisione è cambiata",
  UNRESOLVED_CHOICE: "Resta una scelta da fare",
  EXTERNAL_EFFECT_UNSUPPORTED: "Ha un effetto esterno che Trama non sa verificare",
  EVIDENCE_MISSING: "Verifica da eseguire",
  EVIDENCE_STALE: "Verifica da ripetere",
  CHECK_FAILED: "Verifica non superata",
  GATE_BLOCKED: "I revisori hanno trovato un problema da correggere",
  GATE_RUNNING: "I revisori stanno leggendo",
  GATE_FAILED: "La lettura dei revisori va ripetuta",
  REMOTE_CONFLICT: "In conflitto con il lavoro su GitHub",
  WORKTREE_CONFLICT: "Tocca gli stessi file di un altro lavoro",
};

/** What code-review writes when there is no spec to compare with (the skill's own words, kept in the records). */
const NO_SPEC = "no spec available";
export const NO_SPEC_TEXT = "Nessun piano da confrontare";

const CODE = new RegExp(`\\b(${Object.keys(BLOCKER_TEXT).join("|")})\\b`, "g");

/**
 * A text written by Trama or by an agent, made plain for the person: a skill cited with its path shows its name,
 * the technical codes and the skill's fixed phrases read in Italian. What the text says stays the same.
 */
export function plainText(text: string): string {
  return (
    text
      // "skill:improve-codebase-architecture:/home/.../SKILL.md" is how a session names the skill it received.
      .replace(/\bskill:([\w.-]+):(?:[A-Za-z]:)?[/\\][^\s,;)]*/g, "$1")
      .replace(/(?<![\w/.-])(?:[A-Za-z]:)?(?:\/[\w.@ -]+)+\/([\w.-]+)\/SKILL\.md\b/g, "$1")
      .replace(new RegExp(`\\b${NO_SPEC}\\b`, "gi"), (_match: string, offset: number, whole: string) =>
        offset === 0 || /[.!?]\s*$/.test(whole.slice(0, offset)) ? NO_SPEC_TEXT : NO_SPEC_TEXT.toLowerCase(),
      )
      .replace(CODE, (code: string) => BLOCKER_TEXT[code]!.toLowerCase())
  );
}

/** "Approfondire: Approfondire l'annullamento" says the verb once: a label that already starts with it keeps its own. */
export function withoutRepeatedLead(lead: string, text: string): string {
  const clean = text.trim();
  const word = lead.replace(/[:\s]+$/, "");
  return clean.toLowerCase().startsWith(word.toLowerCase()) ? clean : `${word}: ${clean}`;
}

/**
 * The other side of a comparison as a reference: "C-1 di Ada (feature/x)", as records written before issue #270 keep
 * it, becomes "C-1", which the interface shows by name with who made it.
 */
export function plainConflictReference(reference: string): string {
  return reference.replace(/^((?:[A-Z]{1,2})-[0-9A-F]{8}) di .+ \([^()\s]+\)$/, "$1");
}

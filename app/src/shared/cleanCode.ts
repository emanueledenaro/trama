/**
 * Trama's Clean Code standard (Q03, issue #190, ADR 0016). A quality standard of Trama, not a skill: it reaches the
 * developers as Trama's own text next to the AI Hero skills, which keep their original text, and the technical
 * reviewer checks the diff against it. The full text for people is docs/standard-clean-code.md, at the same version.
 */

/** Bump together with docs/standard-clean-code.md when a rule changes. */
export const CLEAN_CODE_VERSION = 1;

export const CLEAN_CODE_SOURCE = "Robert C. Martin, Clean Code: A Handbook of Agile Software Craftsmanship (2008)";

export type CleanCodeRuleId = "names" | "smallFunctions" | "fewArguments" | "noHiddenSideEffects" | "kiss" | "dry" | "yagni" | "solid";

/**
 * How the reviewer weighs a breach: a blocking breach asks for changes (duplicated logic, hidden side effects,
 * misleading names, as the issue lists them); any other breach is a suggestion.
 */
export type CleanCodeSeverity = "blocking" | "suggestion";

export interface CleanCodeRule {
  id: CleanCodeRuleId;
  /** Italian, for the settings page and the review card. */
  label: string;
  /** Italian, one line for the settings page. */
  summary: string;
  /** English, as the developer and the reviewer read it. */
  instruction: string;
  severity: CleanCodeSeverity;
}

export const CLEAN_CODE_RULES: CleanCodeRule[] = [
  {
    id: "names",
    label: "Nomi",
    summary: "Nomi che spiegano lo scopo, pronunciabili e ricercabili, senza abbreviazioni criptiche e senza il tipo nel nome.",
    instruction:
      "Names reveal intent without a comment (`daysSinceLastAccess`, not `d`). They are pronounceable and searchable, with no cryptic abbreviations, and they leave the type out (`users`, not `userList`). A misleading name is a blocking finding.",
    severity: "blocking",
  },
  {
    id: "smallFunctions",
    label: "Funzioni piccole",
    summary: "Ogni funzione fa una sola cosa. Vale dentro un modulo: non autorizza a spezzettare le interfacce.",
    instruction:
      "Functions are small and do one thing (single responsibility). This holds inside a module: it never justifies splitting a deep module's small interface into many shallow ones.",
    severity: "suggestion",
  },
  {
    id: "fewArguments",
    label: "Pochi argomenti",
    summary: "Da 0 a 2 argomenti, al massimo 3. Oltre si raggruppano in un oggetto.",
    instruction: "Functions take few arguments, ideally 0 to 2. Past 3, group them in an object.",
    severity: "suggestion",
  },
  {
    id: "noHiddenSideEffects",
    label: "Nessun effetto nascosto",
    summary: "Una funzione non cambia di nascosto lo stato globale.",
    instruction: "Functions have no hidden side effects on global or shared state: what a function changes shows in its name and signature. A hidden side effect is a blocking finding.",
    severity: "blocking",
  },
  {
    id: "kiss",
    label: "KISS",
    summary: "Niente complessità superflua.",
    instruction: "KISS: no complexity the task does not need.",
    severity: "suggestion",
  },
  {
    id: "dry",
    label: "DRY",
    summary: "La stessa logica non si scrive due volte.",
    instruction: "DRY: the same logic is written once. Duplicated logic is a blocking finding.",
    severity: "blocking",
  },
  {
    id: "yagni",
    label: "YAGNI",
    summary: "Niente funzioni prima che servano.",
    instruction: "YAGNI: no function, option or abstraction before something needs it.",
    severity: "suggestion",
  },
  {
    id: "solid",
    label: "SOLID",
    summary: "Per il codice a oggetti.",
    instruction: "SOLID, for object-oriented code only: leave it aside where the project does not use classes.",
    severity: "suggestion",
  },
];

/** The standard as a project adapts it (Impostazioni, Standard del codice). Absent means every rule is on. */
export interface CleanCodeSettings {
  /** Rules the person switched off for this project. */
  disabledRules: CleanCodeRuleId[];
  /** How the rules apply to this project's language and paradigm, in the person's words; null without one. */
  note: string | null;
}

export const DEFAULT_CLEAN_CODE_SETTINGS: CleanCodeSettings = { disabledRules: [], note: null };

export const isCleanCodeRule = (value: string): value is CleanCodeRuleId => CLEAN_CODE_RULES.some((rule) => rule.id === value);

export function activeRules(settings: CleanCodeSettings | undefined): CleanCodeRule[] {
  const disabled = new Set(settings?.disabledRules ?? []);
  return CLEAN_CODE_RULES.filter((rule) => !disabled.has(rule.id));
}

/** A breach the technical reviewer found (V05): the model's judgement, a finding and never evidence. */
export interface ReviewFinding {
  severity: CleanCodeSeverity;
  /** A rule of the standard, or null for a finding outside it. */
  rule: CleanCodeRuleId | null;
  file: string;
  /** 1-based line in the candidate's version of the file; null when the finding covers the whole file. */
  line: number | null;
  message: string;
}

export type CodeMeasureKind = "arguments" | "functionLength" | "duplication";

/** A number Trama computed on the candidate with a deterministic tool (Q03): evidence, unlike a finding. */
export interface CodeMeasure {
  kind: CodeMeasureKind;
  rule: CleanCodeRuleId;
  file: string;
  line: number;
  /** The function measured, or the other place of a duplicated block. */
  subject: string;
  value: number;
  limit: number;
}

/** The measures and their limits: deterministic, the same on every run. */
export const MEASURE_LIMITS = {
  /** Past 3 arguments, the standard asks for an object. */
  arguments: 3,
  /** Lines of a function body, as a signal that it does more than one thing. */
  functionLength: 40,
  /** Consecutive identical lines, ignoring blank and bracket-only lines, that count as duplicated logic. */
  duplication: 6,
} as const;

import type { MessageKey, Translate } from "./i18n";

/**
 * The names of the code smells that the standards review may write in English (Fowler's catalog, as the code-review
 * skill lists them), with the catalog key of each name. The interface shows the name in the person's language.
 * i18n-exempt: the English names are what Trama reads in the model's text, in both languages.
 */
export const SMELL_NAMES: { english: string; key: MessageKey }[] = [
  { english: "Mysterious Name", key: "smell.mysteriousName" },
  { english: "Duplicated Code", key: "smell.duplicatedCode" },
  { english: "Long Function", key: "smell.longFunction" },
  { english: "Long Parameter List", key: "smell.longParameterList" },
  { english: "Global Data", key: "smell.globalData" },
  { english: "Mutable Data", key: "smell.mutableData" },
  { english: "Divergent Change", key: "smell.divergentChange" },
  { english: "Shotgun Surgery", key: "smell.shotgunSurgery" },
  { english: "Feature Envy", key: "smell.featureEnvy" },
  { english: "Data Clumps", key: "smell.dataClumps" },
  { english: "Primitive Obsession", key: "smell.primitiveObsession" },
  { english: "Repeated Switches", key: "smell.repeatedSwitches" },
  { english: "Lazy Element", key: "smell.lazyElement" },
  { english: "Speculative Generality", key: "smell.speculativeGenerality" },
  { english: "Temporary Field", key: "smell.temporaryField" },
  { english: "Message Chains", key: "smell.messageChains" },
  { english: "Middle Man", key: "smell.middleMan" },
  { english: "Insider Trading", key: "smell.insiderTrading" },
  { english: "Large Class", key: "smell.largeClass" },
  { english: "Alternative Classes with Different Interfaces", key: "smell.alternativeClasses" },
  { english: "Data Class", key: "smell.dataClass" },
  { english: "Refused Bequest", key: "smell.refusedBequest" },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The longest name first, so that "Long Parameter List" is not read as "Long ...".
const SMELL_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...SMELL_NAMES].sort((a, b) => b.english.length - a.english.length).map((smell) => escape(smell.english)).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/** A finding's text with the English smell names written in the person's language: "Possibile Mysterious Name" becomes "Possibile Nome poco chiaro". */
export function plainSmellNames(t: Translate, text: string): string {
  return text.replace(SMELL_PATTERN, (match) => {
    const smell = SMELL_NAMES.find((s) => s.english.toLowerCase() === match.toLowerCase());
    return smell ? t(smell.key) : match;
  });
}

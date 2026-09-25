import { textScore } from "./mentions";

export interface LoadedSkill {
  name: string;
  path: string;
  enabled: boolean;
  description: string | null;
}

/** Shown wherever Trama lists the bundled AI Hero skills (M08, MIT attribution). */
export const AIHERO_ATTRIBUTION = "Basato sulle skill di Matt Pocock, licenza MIT";

const INVOCATION = /(^|\s)([/$])([A-Za-z0-9_:-]+)(?=\s|$|[,.;!?)])/g;

/** Enabled skills matching `query`, by name first and then description. */
export function skillCandidates(query: string, skills: LoadedSkill[]): LoadedSkill[] {
  // The same skill can come from two folders; the person picks a name, so each name appears once.
  const seen = new Set<string>();
  const enabled = skills
    .filter((s) => s.enabled && !seen.has(s.name) && Boolean(seen.add(s.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const text = query.toLowerCase();
  if (!text) return enabled;
  return enabled
    .flatMap((skill) => {
      const scores = [textScore(skill.name, text), skill.description ? textScore(skill.description, text) : null]
        .map((score, index) => (score === null ? null : score + index * 200))
        .filter((s): s is number => s !== null);
      return scores.length ? [{ skill, score: Math.min(...scores) }] : [];
    })
    .sort((a, b) => a.score - b.score || a.skill.name.localeCompare(b.skill.name))
    .map((s) => s.skill);
}

/** Enabled skills written as /name or $name, once each and in text order. */
export function skillInvocations(text: string, skills: LoadedSkill[]): LoadedSkill[] {
  const seen = new Set<string>();
  const result: LoadedSkill[] = [];
  for (const match of text.matchAll(INVOCATION)) {
    const skill = skills.find((s) => s.enabled && s.name === match[3]);
    if (skill && !seen.has(skill.name)) {
      seen.add(skill.name);
      result.push(skill);
    }
  }
  return result;
}

/** `text` with each /name of an enabled skill written $name, the form Codex expects. */
export function codexSkillText(text: string, skills: LoadedSkill[]): string {
  const names = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
  return text.replace(INVOCATION, (whole, before: string, sigil: string, name: string) =>
    sigil === "/" && names.has(name) ? `${before}$${name}` : whole,
  );
}

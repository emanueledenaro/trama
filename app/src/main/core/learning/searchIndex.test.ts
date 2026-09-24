import { describe, expect, it } from "vitest";
import { orRelaxedQuery, parseQuery, sanitizeQuery, searchMessages, type SearchDocument } from "./searchIndex";

const doc = (id: number, text: string, sessionId = "s1", role = "user", timestamp = id): SearchDocument => ({ id, sessionId, role, columns: [text], timestamp });

describe("sanitizeQuery (Hermes _sanitize_fts5_query)", () => {
  it.each([
    ["hello world", "hello world"],
    ["hello AND", "hello"],
    ["OR world", "world"],
    ["***", ""],
    ["deploy*", "deploy*"],
    ["TODO: fix", "TODO  fix"],
  ])("%s", (input, output) => {
    expect(sanitizeQuery(input)).toBe(output);
  });

  it("removes the characters FTS5 treats as syntax", () => {
    expect(sanitizeQuery("C++")).not.toContain("+");
    expect(sanitizeQuery('"unterminated')).not.toContain('"');
    expect(sanitizeQuery("(problem")).not.toContain("(");
    expect(sanitizeQuery("error:timeout")).not.toContain(":");
    expect(sanitizeQuery("50%")).not.toContain("%");
    expect(sanitizeQuery("完成50%")).toContain("%");
  });

  it("keeps quoted phrases and quotes dotted or hyphenated terms", () => {
    expect(sanitizeQuery('"exact phrase" more')).toContain('"exact phrase"');
    expect(sanitizeQuery("open my-app.config.ts")).toBe('open "my-app.config.ts"');
    expect(sanitizeQuery("P2.2")).toBe('"P2.2"');
  });

  it.each(["it's", "gateway/run.py", "user@host", "a,b", "why?", "e=mc2", "a;b", "a!b", "a&b", "a|b", "x~y", "#tag", "$dollar", "[bracket]", "<tag>", "C:\\path\\file"])(
    "%s parses after sanitizing",
    (input) => {
      expect(parseQuery(sanitizeQuery(input))).not.toBeNull();
    },
  );

  it("stays fast on adversarial input", () => {
    const started = Date.now();
    sanitizeQuery('"'.repeat(50_000) + " bounded".repeat(10_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("orRelaxedQuery", () => {
  it.each([
    ["sarah standup scheduled", "sarah OR standup OR scheduled"],
    ["alpha AND beta", "alpha OR beta"],
    ['"docker networking" tls', '"docker networking" OR tls'],
    ["standup", null],
    ['"docker networking"', null],
    ["alpha OR beta", null],
    ["python NOT java", null],
  ])("%s", (input, output) => {
    expect(orRelaxedQuery(input)).toBe(output);
  });
});

describe("searchMessages", () => {
  const documents = [
    doc(1, "We configured the docker networking for the staging cluster"),
    doc(2, "Sarah prefers the standup meeting scheduled early on Thursday mornings"),
    doc(3, "The gateway crashed after the deploy"),
    doc(4, "Perché il test fallisce? Il timeout è troppo basso"),
    doc(5, "docker docker docker compose"),
  ];

  it("ranks with BM25 and marks the matched tokens", () => {
    const hits = searchMessages("docker", documents);
    expect(hits.map((h) => h.id)).toEqual([5, 1]);
    expect(hits[1]!.snippet).toContain(">>>docker<<<");
  });

  it("ANDs terms and retries with OR when nothing matches", () => {
    expect(searchMessages("docker gateway", documents).map((h) => h.id).sort()).toEqual([1, 3, 5]);
    expect(searchMessages("when does Sarah like her standup scheduled", documents)[0]!.id).toBe(2);
  });

  it("never relaxes an explicit NOT", () => {
    expect(searchMessages("standup NOT Thursday", documents)).toEqual([]);
  });

  it("matches prefixes, phrases and words without diacritics", () => {
    expect(searchMessages("gate*", documents).map((h) => h.id)).toEqual([3]);
    expect(searchMessages('"docker networking"', documents).map((h) => h.id)).toEqual([1]);
    expect(searchMessages("perche", documents).map((h) => h.id)).toEqual([4]);
  });

  it("applies roles, filters and time order before the limit", () => {
    const mixed = [...documents, doc(6, "docker in the tool output", "s2", "tool", 6)];
    expect(searchMessages("docker", mixed, { roles: ["user"] }).map((h) => h.id)).toEqual([5, 1]);
    expect(searchMessages("docker", mixed, { roles: ["tool"] }).map((h) => h.id)).toEqual([6]);
    expect(searchMessages("docker", mixed, { sort: "oldest", limit: 1 }).map((h) => h.id)).toEqual([1]);
    expect(searchMessages("docker", mixed, { filter: (d) => d.id !== 5 }).map((h) => h.id)).toEqual([6, 1]);
  });

  it("finds nothing for an empty or unparsable query", () => {
    expect(searchMessages("***", documents)).toEqual([]);
    expect(searchMessages("docker - gateway", documents)).toEqual([]);
  });
});

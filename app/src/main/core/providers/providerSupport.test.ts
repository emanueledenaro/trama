import { afterEach, describe, expect, it } from "vitest";
import { clearUsageLimitsForTests, currentUsageLimit, usageLimitError } from "./providerSupport";

/** Pi's text for OpenRouter's upstream 429 of the report (#185): pi-ai writes "<status>: <body>". */
const OPENROUTER_429 =
  '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"qwen/qwen3.8-27b:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Chutes","limit_source":"upstream_provider_shared_pool"}}';

afterEach(() => clearUsageLimitsForTests());

describe("usageLimitError", () => {
  it("does not block the provider on a temporary upstream limit: the next turn may already pass", () => {
    const error = usageLimitError("pi", "Pi", OPENROUTER_429);
    expect(error).toMatchObject({ code: "rateLimited", message: expect.stringMatching(/^Pi ha un limite temporaneo\. 429: /) });
    expect(currentUsageLimit("pi")).toBeNull();
  });

  it("blocks the provider on a quota, and on a limit that says when it resets", () => {
    expect(usageLimitError("opencode", "OpenCode", "You've hit your usage limit.")).toMatchObject({ code: "blocked" });
    expect(currentUsageLimit("opencode")).toMatchObject({ kind: "blocked", message: expect.stringMatching(/limite di utilizzo/) });
    expect(usageLimitError("pi", "Pi", "429 rate limit exceeded, retry after 2099-01-01T00:00:00Z")).toMatchObject({ code: "blocked" });
    expect(currentUsageLimit("pi")).toMatchObject({ until: "2099-01-01T00:00:00.000Z" });
  });

  it("returns null for any other failure", () => {
    expect(usageLimitError("pi", "Pi", "socket hang up")).toBeNull();
  });
});

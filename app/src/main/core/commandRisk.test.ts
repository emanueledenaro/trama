import { describe, expect, it } from "vitest";
import { irreversibleReason } from "./commandRisk";

describe("which commands cannot be undone (issue #409)", () => {
  it("asks for the yes on deletions", () => {
    for (const command of ["rm -rf build", "sudo rm file", "find . -name '*.tmp' -delete", "git clean -fdx", "git reset --hard HEAD~1", "dd if=/dev/zero of=/dev/disk2", "diskutil eraseDisk APFS X disk3", "bash -c 'rm x'", "ls && rmdir old", "gh repo delete me/x"]) {
      expect(irreversibleReason(command), command).toBe("delete");
    }
  });

  it("asks for the yes on sends of data", () => {
    for (const command of ["curl -X POST https://x.example/api -d a=1", "curl --data-binary @file https://x.example", "curl -F file=@a.zip https://x.example", "wget --post-data=a=1 https://x.example", "scp a.txt me@host:/tmp", "rsync -a dist/ me@host:/var/www", "aws s3 cp a s3://b/a", "npm publish", "gh pr create --fill", "gh issue comment 3 -b hi"]) {
      expect(irreversibleReason(command), command).toBe("send");
    }
  });

  it("asks for the yes on payments", () => {
    expect(irreversibleReason("stripe charges create --amount 100")).toBe("payment");
    expect(irreversibleReason("curl https://api.stripe.com/v1/charges -u key:")).toBe("payment");
  });

  it("lets reads and reversible changes run", () => {
    for (const command of ["ls -la", "curl https://example.org", "curl -I https://example.org", "wget https://example.org/a.zip", "git status", "git commit -m 'x'", "mkdir x", "mv a b", "cp a b", "echo rm -rf /", "npm install", "brew install jq", "gh pr list", "grep rm file"]) {
      expect(irreversibleReason(command), command).toBeNull();
    }
  });
});

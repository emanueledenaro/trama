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
    for (const target of [
      "api.stripe.com/v1/charges",
      "api.stripe.com:443/v1/charges",
      "https://checkout.stripe.com/pay",
      "https://checkout.paypal.com/x",
      "https://api-m.paypal.com/v2/orders",
      "https://www.paypal.com/v1/payments",
      "paypal.com/v1/payments",
      "https://api.adyen.com/v70/payments",
      "https://api.braintreegateway.com/merchants",
      "HTTPS://API.STRIPE.COM/v1",
      "https://user:pw@api.stripe.com/v1",
    ]) expect(irreversibleReason(`curl ${target}`), target).toBe("payment");
    expect(irreversibleReason("curl --url=https://api.stripe.com/v1/charges")).toBe("payment");
    expect(irreversibleReason('curl -H "Host: api.stripe.com" http://10.0.0.1/v1')).toBe("payment");
  });

  it("reads the host of an address, not any text that looks like one", () => {
    expect(irreversibleReason("curl https://checkout.stripe.com/pay/abc")).toBe("payment");
    expect(irreversibleReason("curl https://eu.api.stripe.com/v1/charges")).toBe("payment");
    expect(irreversibleReason("curl https://example.org/?next=api.stripe.com")).toBeNull();
    expect(irreversibleReason("curl https://api.stripe.com.evil.example/x")).toBeNull();
  });

  it("lets reads and reversible changes run", () => {
    for (const command of ["ls -la", "curl https://example.org", "curl -I https://example.org", "wget https://example.org/a.zip", "git status", "git commit -m 'x'", "mkdir x", "mv a b", "cp a b", "echo rm -rf /", "npm install", "brew install jq", "gh pr list", "grep rm file"]) {
      expect(irreversibleReason(command), command).toBeNull();
    }
  });
});

describe("payment hosts are compared by name", () => {
  it("does not take a look-alike host for a payment host", () => {
    for (const target of [
      "https://stripe.com.evil.example/v1",
      "https://api.stripe.com.evil.example/v1",
      "https://evilapi.stripe.com.example/v1",
      "https://notapi.stripe.com/v1",
      "https://evil-paypal.com/v1/x",
      "https://paypal.com.evil.example/v1/x",
      "https://www.paypal.com/signin",
      "https://stripe.com/docs",
    ]) expect(irreversibleReason(`curl ${target}`), target).toBeNull();
  });

  it("keeps a real subdomain of a payment host", () => {
    expect(irreversibleReason("curl https://eu.api.stripe.com/v1")).toBe("payment");
  });
});

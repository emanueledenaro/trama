import { describe, expect, it } from "vitest";
import { commandBan, fixedBans, isSecretPath, needsConfirmation, pathBan, pushBan, runnableCommand, searchFoundNothing } from "./fixedBans";
import { LANGUAGES, translator } from "./i18n";

describe("fixed bans on commands (issue #244)", () => {
  it.each([
    "git push --force origin feature/x",
    "git push -f origin feature/x",
    "git push --force-with-lease origin feature/x",
    "git push origin +feature/x",
    "git -C /tmp/work push --force",
    "/usr/bin/git push -uf origin feature/x",
    "git fetch && git push --force",
    "bash -lc 'git push --force origin feature/x'",
    "GIT_TRACE=1 git push --mirror",
  ])("refuses a force push: %s", (command) => {
    expect(commandBan(command)).toBe("forcePush");
  });

  it.each(["git push origin main", "git push origin HEAD:main", "git push origin feature/x:refs/heads/master", "git push --all origin"])(
    "refuses a direct push to the main branch: %s",
    (command) => {
      expect(commandBan(command)).toBe("pushMainBranch");
    },
  );

  it("sees through wrappers with their own options", () => {
    expect(commandBan("env -u UNUSED git tag v1.0.0")).toBe("tagOrRelease");
    expect(commandBan("sudo -u deploy git push --force")).toBe("forcePush");
    expect(commandBan("command -- git push origin main")).toBe("pushMainBranch");
    expect(commandBan("timeout -s KILL 30 gh release create v1")).toBe("tagOrRelease");
    expect(commandBan("nice -n 10 cat .env")).toBe("secrets");
    expect(commandBan("env -i PATH=/bin git status")).toBeNull();
  });

  it("refuses an implicit push when the branch checked out is the main one", () => {
    const onMain = () => "main";
    const onFeature = () => "feature/x";
    for (const command of ["git push", "git push origin", "git push -u origin HEAD", "git push origin HEAD:refs/heads/main"]) {
      expect(commandBan(command, undefined, onMain), command).toBe("pushMainBranch");
    }
    expect(commandBan("git push", undefined, onFeature)).toBeNull();
    expect(commandBan("git push origin HEAD", undefined, onFeature)).toBeNull();
    // The branch is asked only when the push names none.
    let asked = 0;
    commandBan("git push origin feature/x", undefined, () => {
      asked++;
      return "main";
    });
    expect(asked).toBe(0);
  });

  it("counts the project's own default branch as main", () => {
    expect(commandBan("git push origin trunk", ["trunk"])).toBe("pushMainBranch");
    expect(commandBan("git push origin trunk")).toBeNull();
  });

  it.each([
    "git push origin --delete feature/x",
    "git push origin -d v1.0.0",
    "git push origin :feature/x",
    "gh api -X DELETE repos/o/r/git/refs/heads/feature-x",
    "gh api --method DELETE repos/o/r/git/refs/tags/v1",
  ])("refuses deleting a remote branch or tag: %s", (command) => {
    expect(commandBan(command)).toBe("deleteRemoteRef");
  });

  it.each([
    "git tag v1.2.0",
    "git tag -a v1.2.0 -m release",
    "git push origin --tags",
    "git push origin refs/tags/v1.2.0",
    "git push origin tag v1.2.0",
    "gh release create v1.2.0",
    "gh release delete v1.2.0",
    "gh api repos/o/r/releases -f tag_name=v1",
    "gh api -X POST repos/o/r/git/refs -f ref=refs/tags/v1 -f sha=abc",
  ])("refuses creating tags and releases: %s", (command) => {
    expect(commandBan(command)).toBe("tagOrRelease");
  });

  it.each([
    "cat .env",
    "cat config/.env.production",
    "cp secrets.txt ~/.ssh/id_ed25519",
    "echo TOKEN=x > .env.local",
    "gh auth token",
    "gh auth status --show-token",
    "gh secret set NPM_TOKEN",
    "gh secret list",
    "gh api repos/o/r/actions/secrets",
    "git credential fill",
    "git config --global credential.helper store",
    "security find-generic-password -s github",
    "cat ~/.config/gh/hosts.yml",
    "rm -rf .ssh",
    "ls ~/.aws",
    "openssl rsa -in server.key",
  ])("refuses reading or writing secrets and credentials: %s", (command) => {
    expect(commandBan(command)).toBe("secrets");
  });

  it.each([
    "gh repo edit --visibility public",
    "gh repo delete o/r --yes",
    "gh repo rename nuovo",
    "gh api -X PATCH repos/o/r -f default_branch=dev",
    "gh api -X PUT repos/o/r/branches/main/protection --input rules.json",
    "gh api repos/o/r/hooks -f url=https://x",
    "gh api -X PUT repos/o/r/collaborators/someone",
    "gh ruleset create",
  ])("refuses changing the repository's settings: %s", (command) => {
    expect(commandBan(command)).toBe("repositorySettings");
  });

  it.each([
    "git push -u origin feature/issue-244-mandate",
    "git status && git diff --stat",
    "git tag",
    "git tag -l 'v*'",
    "git tag --contains HEAD",
    // A local tag: nothing changes on the remote.
    "git tag -d v1.0.0",
    "grep -rn 'git push --force' docs",
    'grep "git tag v1" README.md',
    "gh release list",
    "gh release view v1",
    "gh repo view",
    "gh api repos/o/r/issues",
    "gh api repos/o/r",
    "gh api -X POST repos/o/r/issues -f title=Bug",
    "gh api -X POST repos/o/r/pulls/3/reviews",
    "cat .env.example",
    "cat ~/.ssh/id_ed25519.pub",
    "npm test -- --reporter dot",
    "git config user.name",
  ])("lets ordinary work through: %s", (command) => {
    expect(commandBan(command)).toBeNull();
  });
});

describe("fixed bans on files and pushes", () => {
  it("recognises secret and credential files", () => {
    for (const path of [".ssh", "/home/me/.aws", ".env", "app/.env.local", "/home/me/.ssh/id_rsa", "certs/server.pem", "deploy.p12", "/home/me/.aws/credentials", ".npmrc", ".git-credentials"]) {
      expect(isSecretPath(path), path).toBe(true);
      expect(pathBan(path)).toBe("secrets");
    }
    for (const path of [".env.example", "src/env.ts", "docs/secrets-policy.md", "/home/me/.ssh/id_rsa.pub", "keyboard.ts"]) {
      expect(isSecretPath(path), path).toBe(false);
    }
  });

  it("never lets Trama push the main branch itself", () => {
    expect(pushBan("main")).toBe("pushMainBranch");
    expect(pushBan("refs/heads/master")).toBe("pushMainBranch");
    expect(pushBan("develop", ["develop"])).toBe("pushMainBranch");
    expect(pushBan("trama/C-1234")).toBeNull();
  });

  it("lists every ban once, with a reason for the person", () => {
    for (const language of LANGUAGES) {
      const bans = fixedBans(translator(language));
      expect(new Set(bans.map((b) => b.id)).size).toBe(7);
      for (const ban of bans) expect(ban.reason).toMatch(/\.$/);
    }
  });
});

describe("actions the person asks for (issue #422)", () => {
  it("asks a confirmation only for what deletes something or cannot be undone", () => {
    expect(fixedBans(translator("it")).filter((b) => needsConfirmation(b.id)).map((b) => b.id)).toEqual(["forcePush", "deleteRemoteRef", "secrets"]);
  });

  it("runs one plain git or gh command and nothing that could run another program", () => {
    expect(runnableCommand("git push --force origin feature/x")).toEqual(["git", "push", "--force", "origin", "feature/x"]);
    expect(runnableCommand('gh release create v1 --notes "a; b"')).toEqual(["gh", "release", "create", "v1", "--notes", "a; b"]);
    for (const line of ["git fetch; git push -f", "sudo git push -f", "GIT_SSH_COMMAND=x git push -f", "git -c core.sshCommand=x push", "/usr/bin/git push -f", "git", "echo $(git push -f)", "sh -c 'git push -f'"]) {
      expect(runnableCommand(line), line).toBeNull();
    }
  });
});

describe("a search that found nothing (2 October 2026)", () => {
  it("is no failure for a single grep, rg or git grep that ends with 1, also inside a shell", () => {
    expect(searchFoundNothing("rg -n 'Notizia confermata' src", 1)).toBe(true);
    expect(searchFoundNothing(`/bin/zsh -lc "rg --files -g 'AGENTS.md'"`, 1)).toBe(true);
    expect(searchFoundNothing("git grep -n TODO", 1)).toBe(true);
    // Another code, another program or a chain keep their error: a failed cat before rg is not hidden.
    expect(searchFoundNothing("rg -n x", 2)).toBe(false);
    expect(searchFoundNothing("cat AGENTS.md", 1)).toBe(false);
    expect(searchFoundNothing("cat AGENTS.md && rg x", 1)).toBe(false);
  });
});

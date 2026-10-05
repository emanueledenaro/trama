import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SecretLock } from "./secretLock";

const HOME = "/Users/ada";
const lock = new SecretLock({ home: HOME, realpath: () => null });
const check = (command: string, cwd = `${HOME}/projects/app`) => lock.check(command, { cwd });
const placeOf = (command: string, cwd?: string) => {
  const result = check(command, cwd);
  return result && "locked" in result ? result.locked.place : result && "ban" in result ? `ban:${result.ban}` : null;
};

describe("the lock on secrets: direct paths (issue #409)", () => {
  it("stops a command that names a place of secrets, however it is written", () => {
    expect(placeOf("cat ~/.ssh/id_rsa")).toBe("~/.ssh");
    expect(placeOf("cat $HOME/.aws/credentials")).toBe("~/.aws");
    expect(placeOf("cat ${HOME}/.config/gh/hosts.yml")).toBe("~/.config/gh");
    expect(placeOf(`ls ${HOME}/.gnupg`)).toBe("~/.gnupg");
    expect(placeOf("cp ~/Library/Keychains/login.keychain-db /tmp/k")).toBe("~/Library/Keychains");
    expect(placeOf("sqlite3 '~/Library/Application Support/Google/Chrome/Default/Login Data' .dump")).toBe("~/Library/Application Support/Google/Chrome");
    expect(placeOf("tar czf x.tgz /Library/Keychains")).toBe("/Library/Keychains");
    expect(placeOf("cat < ~/.netrc")).toBe("~/.netrc");
    expect(placeOf("echo ok && cat ~/.ssh/config")).toBe("~/.ssh");
    expect(placeOf('bash -c "cat ~/.ssh/id_ed25519"')).toBe("~/.ssh");
  });

  it("stops env files and key files wherever they are, but not the examples", () => {
    expect(placeOf("cat .env")).toBe(".env");
    expect(placeOf("cat app/.env.production")).toBe(".env.production");
    expect(placeOf("cat /srv/site/server.pem")).toBe("server.pem");
    expect(check("cat .env.example")).toBeNull();
    expect(check("cat ~/.ssh/id_rsa.pub")).toMatchObject({ locked: { place: "~/.ssh" } });
  });

  it("stops the Keychain tool and the dump of the environment", () => {
    expect(placeOf("security find-generic-password -s github")).toBe("Keychain");
    expect(placeOf("printenv")).toBe("env");
    expect(placeOf("env")).toBe("env");
    expect(placeOf("echo hi; export -p")).toBe("env");
    expect(check("env FOO=1 node build.js")).toBeNull();
    expect(check("export PATH=/usr/bin")).toBeNull();
  });

  it("applies the fixed bans to the Operator too", () => {
    expect(placeOf("git push --force origin main")).toBe("ban:forcePush");
    expect(placeOf("git tag v1.0.0")).toBe("ban:tagOrRelease");
  });

  it("lets ordinary commands run", () => {
    for (const command of ["ls -la", "npm install", "brew update", "cat ~/Documents/note.txt", "grep -r TODO src", "find . -name '*.ts'", "defaults read com.apple.finder", "cat README.md"]) {
      expect(check(command), command).toBeNull();
    }
  });
});

describe("the lock on secrets: relative paths and globs", () => {
  it("joins a relative path to the folder the command runs in", () => {
    expect(placeOf("cat id_rsa", `${HOME}/.ssh`)).toBe("~/.ssh");
    expect(placeOf("cat id_rsa", `${HOME}/projects`)).toBe("ban:secrets");
    expect(placeOf("ls .", `${HOME}/.ssh`)).toBe("~/.ssh");
    expect(placeOf("cat ../../.aws/credentials", `${HOME}/projects/app`)).toBe("~/.aws");
    expect(placeOf("cat ../.ssh/config", `${HOME}/projects`)).toBe("~/.ssh");
  });

  it("follows cd inside the line", () => {
    expect(placeOf("cd ~/.ssh && ls")).toBe("~/.ssh");
    expect(placeOf("cd ~ && cat .aws/credentials")).toBe("~/.aws");
    expect(placeOf("cd .ssh && cat config", HOME)).toBe("~/.ssh");
    expect(check("cd /tmp && ls", `${HOME}/.ssh`)).toBeNull();
  });

  it("matches globs against the places and the env files", () => {
    expect(placeOf("cat ~/.ss*/id_*")).toBe("~/.ssh");
    expect(placeOf("ls ~/.?sh")).toBe("~/.ssh");
    expect(placeOf("cat ~/.{ssh,aws}/*")).toBe("~/.ssh");
    expect(placeOf("cat .env*", `${HOME}/projects/app`)).toBe(".env");
    // A star does not match a leading dot, as in the shell.
    expect(check("cat ~/*", HOME)).toBeNull();
    expect(check("cat ./*.md")).toBeNull();
  });

  it("stops a search in depth that would reach a place from above", () => {
    expect(placeOf("grep -r password ~")).not.toBeNull();
    expect(placeOf("rg token ~/Library")).toBe("~/Library/Keychains");
    expect(placeOf("find ~ -name x -exec cat {} +")).not.toBeNull();
    expect(check("find ~ -name '*.pdf'")).toBeNull();
    expect(check("ls ~")).toBeNull();
    expect(check("grep -r TODO ~/projects")).toBeNull();
  });

  it("stops a path behind a variable it cannot open when the secret place follows it", () => {
    expect(placeOf("cat $DIR/.ssh/id_rsa")).not.toBeNull();
    expect(check("cat $DIR/readme.md")).toBeNull();
  });
});

describe("the lock on secrets: links", () => {
  it("treats a link that points into a locked place as the place", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "trama-lock-")));
    const home = join(base, "home");
    mkdirSync(join(home, ".ssh"), { recursive: true });
    writeFileSync(join(home, ".ssh", "id_rsa"), "key");
    mkdirSync(join(home, "work"), { recursive: true });
    writeFileSync(join(home, "work", "notes.txt"), "notes");
    symlinkSync(join(home, ".ssh"), join(home, "work", "shortcut"));
    symlinkSync(join(home, ".ssh", "id_rsa"), join(home, "work", "innocent.txt"));
    const real = new SecretLock({ home });
    const run = (command: string) => real.check(command, { cwd: join(home, "work") });
    expect(run("cat shortcut/id_rsa")).toMatchObject({ locked: { place: "~/.ssh" } });
    expect(run("cat innocent.txt")).toMatchObject({ locked: { place: "~/.ssh" } });
    expect(run("ls shortcut")).toMatchObject({ locked: { place: "~/.ssh" } });
    expect(run("cat shortcut/new-file")).toMatchObject({ locked: { place: "~/.ssh" } });
    expect(run("cat notes.txt")).toBeNull();
  });

  it("also knows a home folder that is itself behind a link", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "trama-lock-")));
    mkdirSync(join(base, "real", ".aws"), { recursive: true });
    symlinkSync(join(base, "real"), join(base, "home"));
    const real = new SecretLock({ home: join(base, "home") });
    expect(real.check(`cat ${join(base, "real", ".aws", "credentials")}`, { cwd: base })).toMatchObject({ locked: { place: "~/.aws" } });
  });
});

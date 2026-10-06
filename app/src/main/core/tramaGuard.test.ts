import { describe, expect, it } from "vitest";
import { SecretLock } from "./secretLock";
import { debuggingRequested, protectedTramaPaths, shownPath, tramaCommandReach } from "./tramaGuard";

const HOME = "/Users/ada";
const DATA = `${HOME}/Library/Application Support/Trama/Desktop`;
const PROFILE = `${HOME}/Library/Application Support/Trama`;
const INSTALL = "/Applications/Trama.app";
const PROJECT = `${HOME}/dev/negozio`;
const lock = new SecretLock({ home: HOME, realpath: () => null });
const folders = protectedTramaPaths({ data: [DATA, PROFILE], install: [INSTALL] }, PROJECT).map((path) => ({ label: shownPath(path, HOME), path }));
const reaches = (command: string, cwd = PROJECT) => lock.reaches(command, { cwd }, folders);

describe("the Operator's commands never reach Trama by their words (issue #597)", () => {
  it("refuses the programs that drive the keyboard, the mouse or other apps by script", () => {
    for (const command of [
      `osascript -e 'tell application "System Events" to click button "Sì" of window 1 of process "Trama"'`,
      "/usr/bin/osascript -l JavaScript -e 'Application(\"Trama\").activate()'",
      "cliclick c:400,300",
      "xdotool click 1",
      "ydotool key 28:1",
      "shortcuts run Approva",
      "automator flusso.workflow",
      `python3 -c "import Quartz; Quartz.CGEventPost(0, e)"`,
      `swift -e 'AXUIElementPerformAction(el, "AXPress")'`,
      "pip install pyautogui && python3 clic.py",
      `sh -c "osascript -e 'beep'"`,
      `echo ok && bash -lc 'cliclick c:1,1'`,
    ]) {
      expect(tramaCommandReach(command), command).toBe("input");
    }
  });

  it("refuses starting, stopping, debugging or reconfiguring Trama, and jobs outside the sandbox", () => {
    expect(tramaCommandReach("open -a Trama")).toBe("launch");
    expect(tramaCommandReach("open -b dev.trama.app --args --remote-debugging-port=9222")).toBe("debugger");
    expect(tramaCommandReach("open /Applications/Trama.app")).toBe("launch");
    expect(tramaCommandReach("ELECTRON_RUN_AS_NODE=1 /Applications/Trama.app/Contents/MacOS/Trama -e 'x'")).toBe("launch");
    expect(tramaCommandReach("curl http://127.0.0.1:9229/json/version")).toBe("debugger");
    expect(tramaCommandReach("node -e \"require('playwright').chromium.connectOverCDP('http://localhost:9222')\"")).toBe("debugger");
    expect(tramaCommandReach("kill -USR1 123")).toBe("debugger");
    expect(tramaCommandReach("kill -s SIGUSR1 123")).toBe("debugger");
    expect(tramaCommandReach("lldb -p 4242", [4242])).toBe("debugger");
    expect(tramaCommandReach("killall Trama")).toBe("process");
    expect(tramaCommandReach("pkill -f Electron")).toBe("process");
    expect(tramaCommandReach("kill -9 4242", [4242, 4243])).toBe("process");
    expect(tramaCommandReach("defaults write dev.trama.app computerAccess -bool true")).toBe("settings");
    expect(tramaCommandReach("tccutil reset Accessibility")).toBe("permissions");
    expect(tramaCommandReach("launchctl submit -l x -- /bin/sh -c 'osascript'")).toBe("persistence");
    expect(tramaCommandReach("launchctl load ~/Library/LaunchAgents/x.plist")).toBe("persistence");
    expect(tramaCommandReach("crontab -l")).toBe("persistence");
  });

  it("lets the project's own work run", () => {
    for (const command of [
      "npm test",
      "git status && git log --oneline -5",
      "kill -9 5555",
      "pkill -f vite",
      "open http://localhost:3000",
      "node --inspect server.js",
      "defaults read com.apple.dock",
      `npx playwright screenshot http://localhost:5173 shot.png`,
      `grep -rn "Trama" src`,
    ]) {
      expect(tramaCommandReach(command, [4242]), command).toBeNull();
    }
  });

  it("refuses a path into Trama's data or installation, however it is written", () => {
    expect(reaches(`cat "${DATA}/settings.json"`)).toBe("~/Library/Application Support/Trama/Desktop");
    expect(reaches(`echo '{}' > "${DATA}/Projects/a.json"`)).not.toBeNull();
    expect(reaches(`cat ~/Library/Application\\ Support/Trama/Desktop/Projects/a.json`)).not.toBeNull();
    expect(reaches(`ls $HOME/Library/Application\\ Support/Trama`)).not.toBeNull();
    expect(reaches("cat Projects/a.json", DATA)).not.toBeNull();
    expect(reaches(`cd "${PROFILE}" && sqlite3 Cookies .dump`)).not.toBeNull();
    expect(reaches(`grep -r consent ~/Library/Application\\ Support`)).not.toBeNull();
    expect(reaches(`cat ~/Library/Application\\ Support/Tr*/Desktop/settings.json`)).not.toBeNull();
    expect(reaches(`cat "$X/Library/Application Support/Trama/Desktop/settings.json"`)).not.toBeNull();
    expect(reaches(`node ${INSTALL}/Contents/Resources/app/node_modules/playwright/cli.js screenshot`)).toBe("/Applications/Trama.app");
    expect(reaches("npm test")).toBeNull();
    expect(reaches(`cat ~/Library/Application\\ Support/Code/User/settings.json`)).toBeNull();
  });

  it("leaves open a project Trama keeps in its own data (the demo project), and nothing else there", () => {
    const demo = `${DATA}/Examples/Demo`;
    expect(lock.reaches("ls docs", { cwd: demo }, folders, demo)).toBeNull();
    expect(lock.reaches(`grep -r ordine .`, { cwd: demo }, folders, demo)).toBeNull();
    expect(lock.reaches(`cat ../../settings.json`, { cwd: demo }, folders, demo)).not.toBeNull();
    expect(lock.reaches(`grep -r x "${DATA}"`, { cwd: demo }, folders, demo)).not.toBeNull();
    // A project that holds Trama's data (the home folder) opens nothing of it.
    expect(lock.reaches(`cat "${DATA}/settings.json"`, { cwd: HOME }, folders, HOME)).not.toBeNull();
  });

  it("leaves Trama's code to the person who works on Trama with Trama", () => {
    const own = protectedTramaPaths({ data: [DATA], install: [`${HOME}/dev/trama/app`, INSTALL] }, `${HOME}/dev/trama`);
    expect(own).toEqual([DATA, INSTALL]);
    // The data stays out of reach even inside the project.
    expect(protectedTramaPaths({ data: [`${HOME}/dev/trama/.data`], install: [] }, `${HOME}/dev/trama`)).toEqual([`${HOME}/dev/trama/.data`]);
  });
});

describe("a packaged Trama never runs with a debugging port (issue #597)", () => {
  it("notices the switches and an inspector already open", () => {
    expect(debuggingRequested(["/Applications/Trama.app/Contents/MacOS/Trama", "--remote-debugging-port=9222"], undefined)).toBe(true);
    expect(debuggingRequested(["Trama", "--inspect=0"], undefined)).toBe(true);
    expect(debuggingRequested(["Trama", "--inspect-brk"], undefined)).toBe(true);
    expect(debuggingRequested(["Trama"], "ws://127.0.0.1:9229/x")).toBe(true);
    expect(debuggingRequested(["Trama", "--hidden"], undefined)).toBe(false);
  });
});

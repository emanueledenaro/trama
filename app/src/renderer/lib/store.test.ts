import { describe, expect, it } from "vitest";
import type { AppState } from "@shared/domain";
import { EMPTY_ONBOARDING, UNKNOWN_GITHUB_CLI } from "@shared/onboarding";
import { useUi } from "./store";

const state = (overrides: Partial<AppState> = {}): AppState =>
  ({
    recentProjects: [],
    project: null,
    loadingProject: null,
    providers: {},
    settings: { theme: "system", sidebarWidth: 256 },
    language: "it",
    onboarding: { ...EMPTY_ONBOARDING },
    gitHubCli: { ...UNKNOWN_GITHUB_CLI },
    started: true,
    ...overrides,
  }) as AppState;

const project = (id: string) => ({ id, name: id, isDemo: false, document: { goals: [] } }) as unknown as AppState["project"];

describe("the Benvenuto in the editor area (issue #354)", () => {
  it("opens on a step and closes back to the conversation", () => {
    useUi.getState().setApp(state({ project: project("a") }));
    useUi.getState().openWelcome("provider");
    expect(useUi.getState()).toMatchObject({ mainView: "welcome", welcomeStep: "provider" });
    useUi.getState().closeWelcome();
    expect(useUi.getState()).toMatchObject({ mainView: "dialog", welcomeStep: null });
  });

  it("is a tab of the editor next to the conversation, which the person closes (issue #354)", () => {
    useUi.getState().setApp(state({ project: project("a") }));
    useUi.getState().openWelcome();
    useUi.getState().openWelcome();
    expect(useUi.getState().editorTabs.filter((tab) => tab.kind === "welcome")).toHaveLength(1);
    useUi.getState().focusTab("conversation");
    expect(useUi.getState().mainView).toBe("dialog");
    useUi.getState().focusTab("welcome");
    expect(useUi.getState().mainView).toBe("welcome");
    useUi.getState().closeTab("welcome");
    expect(useUi.getState()).toMatchObject({ mainView: "dialog" });
    expect(useUi.getState().editorTabs.some((tab) => tab.kind === "welcome")).toBe(false);
  });

  it("gives way to the conversation when a project opens from it", () => {
    useUi.getState().setApp(state({ project: project("a") }));
    useUi.getState().openWelcome();
    useUi.getState().setApp(state({ project: project("b") }));
    expect(useUi.getState().mainView).toBe("dialog");
    expect(useUi.getState().editorTabs.some((tab) => tab.kind === "welcome")).toBe(false);
  });

  it("starts the clone again by itself once GitHub CLI is ready", () => {
    useUi.getState().setApp(state());
    useUi.getState().setCloneAfterGitHub(true);
    useUi.getState().setApp(state({ gitHubCli: { status: "signedOut", account: null, detail: null, checkedAt: "t" } }));
    expect(useUi.getState().dialog).toBeNull();
    useUi.getState().setApp(state({ gitHubCli: { status: "ready", account: "ada", detail: null, checkedAt: "t" } }));
    expect(useUi.getState()).toMatchObject({ dialog: "cloneProject", cloneAfterGitHub: false });
  });
});

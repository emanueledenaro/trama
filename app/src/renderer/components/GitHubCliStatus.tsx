import type { GitHubCliState } from "@shared/onboarding";
import { useT, withNodes } from "@/lib/i18n";

const command = <code className="font-mono text-foreground/90">gh auth login</code>;

/**
 * GitHub CLI's state in plain words (P10). "Not checked yet" and "checking" never read as "not connected": only a
 * check that found gh signed out or missing asks for gh auth login.
 */
export function GitHubCliDescription({ state }: { state: GitHubCliState }) {
  const t = useT();
  switch (state.status) {
    case "ready":
      return <>{state.account ? t("github.detail.readyAs", { account: state.account }) : t("github.detail.ready")}</>;
    case "unknown":
      return <>{t("github.detail.unknown")}</>;
    case "checking":
      return <>{t("guide.github.checking")}</>;
    case "error":
      return <>{state.detail ? t("github.detail.errorDetail", { detail: state.detail }) : t("github.detail.error")}</>;
    case "missing":
      return <>{withNodes(t("github.detail.missing"), { command })}</>;
    case "signedOut":
      return <>{withNodes(state.detail ? t("github.detail.signedOutDetail", { detail: state.detail }) : t("github.detail.signedOut"), { command })}</>;
  }
}

// Bundled fonts (issue #328): Newsreader with its opsz axis and italic for content, Inter for the interface,
// JetBrains Mono for code. Vite copies the files into dist, so they load offline under the same CSP.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LaunchIntro } from "./components/launch/LaunchIntro";
import { useUi } from "./lib/store";

/** The intro plays over the app while the state loads and never holds it back (B02). Mounted once per window. */
function Intro() {
  const ready = useUi((s) => s.app !== null);
  return <LaunchIntro ready={ready} />;
}

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Intro />
  </>,
);

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

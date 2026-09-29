// Bundled fonts (issue #328): Newsreader with its opsz axis and italic for content, Inter for the interface,
// JetBrains Mono for code. Vite copies the files into dist, so they load offline under the same CSP.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);

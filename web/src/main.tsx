import { createRoot } from "react-dom/client";
import App, { captureBootstrap } from "./App";

window.addEventListener("hashchange", () => {
  window.history.replaceState(null, "", window.location.pathname);
});

const boot = captureBootstrap();
createRoot(document.getElementById("root")!).render(<App boot={boot} />);

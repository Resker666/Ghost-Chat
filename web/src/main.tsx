import { createRoot } from "react-dom/client";
import App, { captureBootstrap } from "./App";

const boot = captureBootstrap();
createRoot(document.getElementById("root")!).render(<App boot={boot} />);
